import {
	IExecuteFunctions,
	INode,
	ITriggerFunctions,
	NodeApiError,
	NodeOperationError,
} from 'n8n-workflow';
import { spawn } from 'node:child_process';
import { Smb2Credentials, SmbListEntry, SmbStat } from './interfaces';
import { debuglog } from 'util';

const debug = debuglog('n8n-nodes-smbclient');

// smbclient's exit code is unreliable — it can exit non-zero even when the
// requested command actually succeeded (notably `del`/`rename` against some
// Windows servers, which complete the operation but still return a failure
// status). The reliable signal is whether its output contains a genuine
// NT_STATUS_* error code. We therefore key success/failure off this pattern
// rather than the exit code. Excluded: NT_STATUS_OK (success) and the benign
// end-of-listing markers emitted during normal `ls`/`del` wildcard expansion.
const SMB_FAILURE_RE = /NT_STATUS_(?!OK\b|NO_MORE_FILES\b|NO_MORE_ENTRIES\b)[A-Z0-9_]+/;

// smbclient also prints NT_STATUS_* lines to stderr that carry a status code but
// do NOT mean the requested operation failed. The main offender is the VFS
// "shadow copy" probe that many Samba builds run on `allinfo`, e.g.:
//   NT_STATUS_INVALID_DEVICE_REQUEST getting shadow copy data for \file.txt
// These benign lines must be stripped before failure detection, otherwise a
// perfectly good `stat` would be reported as an error.
const BENIGN_WARNING_RE = /^.*NT_STATUS_\w+\s+getting shadow copy data.*$/gim;
const stripBenignWarnings = (s: string): string => s.replace(BENIGN_WARNING_RE, '');

const SMB_ERROR_HINTS: Array<[RegExp, string]> = [
	[/EACCES/i, 'Access Denied - Check your permissions for this file/folder'],
	[/ENOENT/i, 'File/Path Not Found'],
	[/ENOTDIR/i, 'Not a directory'],
	[/ETIMEOUT/i, 'Connection timed out'],
	[/ECONNREFUSED/i, 'Could not connect to SMB server - Connection refused'],
	[/LOGON failure/i, 'Logon Failure - Check your username, password, and domain'],
	[/bad network name/i, 'Bad Network Name - The specified share does not exist on the server'],
	// etc.
];

export function getReadableError(error: any): string {
	const msg = error?.message ?? String(error);
	for (const [re, friendly] of SMB_ERROR_HINTS) {
		if (re.test(msg)) {
			return `${friendly} (${msg})`;
		}
	}
	return msg;
}

const redactCmd = (s: string): string => {
	if (!s) return s;
	s = s.replace(/-U\s+\S+/g, '-U ***');
	s = s.replace(/-A\s+\S+/g, '-A ***');
	s = s.replace(/\/\/[^/\s]+\/\S+/g, '//***');
	return s;
};
const maskSecrets = (value: string, secrets: Array<string | undefined>): string => {
	let result = value;
	for (const secret of secrets) {
		if (secret) {
			result = result.split(secret).join('***');
		}
	}
	return result;
};

export class SmbClientWrapper {
	constructor(
		private auth: Smb2Credentials,
		private smbclientPath: string = 'smbclient',
		private node: INode,
	) {}

	private buildBaseArgs(): string[] {
		const { host, username, password, domain, share } = this.auth;

		// Anonymous if no username supplied
		let userPart = '%';
		if (username) {
			if (!domain) {
				userPart = `${username}%${password ?? ''}`;
			} else {
				userPart = `${domain}/${username}%${password ?? ''}`;
			}
		}
		const hostPart = `\\\\${host}\\${share}`;
		return [hostPart, '-U', userPart, '-g'];
	}

	private fail(safeCmd: string, detail: string): never {
		const { username, password, domain } = this.auth;
		const safeErr = maskSecrets((detail || '').trim() || 'smbclient command failed', [
			username,
			password,
			domain,
		]);
		// The message must be passed as a string (or via options.message); passing a
		// `{ message }` object as the second arg leaves NodeOperationError.message empty.
		throw new NodeOperationError(this.node, `smbclient failed. cmd="${safeCmd}" stderr="${safeErr}"`);
	}

	private runOne(cmd: string): Promise<string> {
		const args = [...this.buildBaseArgs(), '-c', cmd];

		const { username, password, domain } = this.auth;

		const rawCmd = [this.smbclientPath, ...args].join(' ');
		const safeCmd = maskSecrets(redactCmd(rawCmd), [username, password, domain]);

		// We stream stdout/stderr through `spawn` rather than buffering with
		// `execFile`'s fixed `maxBuffer`: large directory listings (e.g. 160k+
		// files) easily exceed any sane cap and would otherwise fail with
		// ERR_CHILD_PROCESS_STDIO_MAXBUFFER. Output is bounded only by heap.
		return new Promise<string>((resolve, reject) => {
			const child = spawn(this.smbclientPath, args, { windowsHide: true });

			const outChunks: Buffer[] = [];
			const errChunks: Buffer[] = [];
			let spawnError: Error | undefined;

			child.stdout.on('data', (c: Buffer) => outChunks.push(c));
			child.stderr.on('data', (c: Buffer) => errChunks.push(c));
			child.on('error', (e: Error) => {
				spawnError = e;
			});

			child.on('close', (code: number | null, signal: string | null) => {
				const stdout = Buffer.concat(outChunks).toString('utf8');
				const stderr = Buffer.concat(errChunks).toString('utf8');

				// smbclient's exit code is unreliable (it can exit non-zero on
				// success), so we do NOT key failure off `code`. We only fail when
				// the process could not run at all (spawn error or it was killed by a
				// signal) or when its output contains a real NT_STATUS_* error.
				const couldNotRun = !!spawnError || signal != null;
				const diagnostics = stripBenignWarnings(`${stdout}\n${stderr}`);
				try {
					if (couldNotRun || SMB_FAILURE_RE.test(diagnostics)) {
						this.fail(
							safeCmd,
							stripBenignWarnings(stderr).trim() ||
								stdout.trim() ||
								spawnError?.message ||
								`smbclient exited (code=${code}, signal=${signal})`,
						);
					}
					resolve(stdout);
				} catch (err) {
					reject(err);
				}
			});
		});
	}

	async stat(remotePath: string): Promise<SmbStat> {
		const out = await this.runOne(`allinfo "${remotePath}"`);

		// `allinfo` output is colon-delimited "key: value" (NOT pipe-delimited —
		// the `-g` flag has no effect on it), e.g.:
		//   altname:      SOMEFI~1.PDF
		//   create_time:  Thu Sep  4 14:39:03 2025 CEST
		//   attributes:   A (20)
		//   stream:       [::$DATA], 2058 bytes
		// Time values contain colons, so we split on the FIRST colon only.
		const info = new Map<string, string>();
		for (const line of out.split('\n')) {
			const idx = line.indexOf(':');
			if (idx === -1) continue;
			const key = line.slice(0, idx).trim().toUpperCase();
			const value = line.slice(idx + 1).trim();
			if (key) info.set(key, value);
		}

		// "A (20)" -> letter flags only ("A"); drop the trailing "(hex)" annotation.
		const attrs = (info.get('ATTRIBUTES') ?? '')
			.split('(')[0]
			.trim()
			.split('')
			.filter((c) => /[A-Za-z]/.test(c));

		// There is no `size` key — the byte count lives in the stream line, e.g.
		// "[::$DATA], 2058 bytes" (absent for directories).
		const sizeMatch = (info.get('STREAM') ?? '').match(/(\d+)\s*bytes/i);

		return {
			size: sizeMatch ? Number(sizeMatch[1]) : undefined,
			createTime: info.get('CREATE_TIME') ?? undefined,
			accessTime: info.get('ACCESS_TIME') ?? undefined,
			writeTime: info.get('WRITE_TIME') ?? undefined,
			changeTime: info.get('CHANGE_TIME') ?? undefined,
			attributes: attrs,
			isDirectory: attrs.includes('D'),
		};
	}

	async list(dir: string): Promise<SmbListEntry[]> {
		const normalizedDir = (dir ?? '').trim();
		const safeDir = this.escapeSmbArg(normalizedDir);

		const command =
			normalizedDir && normalizedDir !== '/' && normalizedDir !== '.'
				? `cd "${safeDir}"; ls`
				: 'ls';

		const out = await this.runOne(command);

		const lines = out
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);

		const parsed = lines.map((line) => {
			// ---------- Case 1: pipe-delimited ----------
			if (line.includes('|')) {
				const parts = line.split('|');

				// Try common pattern: name|size|date|time|attr
				if (parts.length >= 5 && /^\d+$/.test(parts[1])) {
					const name = parts[0];
					const size = Number(parts[1]) || 0;
					const date = parts[2];
					const time = parts[3];
					const attr = parts[4] ?? '';
					const attributes = attr.split('').filter(Boolean);
					return {
						name,
						size,
						date,
						time,
						attributes,
						isDirectory: attributes.includes('D'),
					} as SmbListEntry;
				}

				// Fallback if unexpected pipe layout: treat whole line as name
				return {
					name: line,
					size: 0,
					attributes: [],
					isDirectory: false,
				} as SmbListEntry;
			}

			// ---------- Case 2: space-aligned columns (your example) ----------
			// Example:
			// 11100 MY FILE_NAME R-1234.pdf                         A    2058  Thu Sep  4 14:39:03 2025
			const compact = line.replace(/\s+/g, ' ').trim();
			const tokens = compact.split(' ');

			// We expect: ... <ATTR> <SIZE> <Wkd> <Mon> <dd> <hh:mm:ss> <yyyy>
			if (tokens.length >= 8) {
				const year = tokens[tokens.length - 1];
				const time = tokens[tokens.length - 2];
				const day = tokens[tokens.length - 3];
				const month = tokens[tokens.length - 4];
				const weekday = tokens[tokens.length - 5];
				const sizeStr = tokens[tokens.length - 6];
				const attr = tokens[tokens.length - 7];

				const name = tokens.slice(0, tokens.length - 7).join(' ');
				const size = Number(sizeStr) || 0;
				const attributes = (attr ?? '').split('').filter(Boolean);

				return {
					name,
					size,
					date: `${weekday} ${month} ${day} ${time} ${year}`,
					time,
					attributes,
					isDirectory: attributes.includes('D'),
				} as SmbListEntry;
			}

			// Minimal fallback
			return {
				name: line,
				size: 0,
				attributes: [],
				isDirectory: false,
			} as SmbListEntry;
		});

		return parsed.filter((entry) => {
			if (!entry) return false;

			// Skip . and ..
			if (entry.name === '.' || entry.name === '..') return false;

			// Skip smbclient footer lines like "blocks available"
			if (/blocks available/i.test(entry.date || '') || /blocks available/i.test(entry.name)) {
				return false;
			}

			// Skip stray numeric-only names (these are usually size/blocks artifacts)
			if (/^\d+$/.test(entry.name)) {
				return false;
			}

			return true;
		});
	}

	async get(remotePath: string, localPath: string): Promise<void> {
		await this.runOne(`get "${remotePath}" "${localPath}"`);
	}

	async put(localPath: string, remotePath: string): Promise<void> {
		await this.runOne(`put "${localPath}" "${remotePath}"`);
	}

	async mkdir(remoteDir: string): Promise<void> {
		await this.runOne(`mkdir "${remoteDir}"`);
	}

	async rmdir(remoteDir: string): Promise<void> {
		await this.runOne(`rmdir "${remoteDir}"`);
	}

	async del(remotePath: string): Promise<void> {
		await this.runOne(`del "${remotePath}"`);
	}

	async rename(oldPath: string, newPath: string): Promise<void> {
		await this.runOne(`rename "${oldPath}" "${newPath}"`);
	}

	// No persistent connection to close for smbclient CLI, but keep API parity.
	async close(): Promise<void> {
		/* no-op */
	}

	private escapeSmbArg(value: string): string {
		return String(value).replace(/"/g, '\\"');
	}
}

export async function connectToSmbServer(
	this: IExecuteFunctions | ITriggerFunctions,
): Promise<{ client: SmbClientWrapper }> {
	try {
		const credentials = (await this.getCredentials('smb2Api')) as unknown as Smb2Credentials;

		debug(
			'Connecting to //%s/%s as (%s\\%s)',
			credentials.host,
			credentials.share,
			credentials.domain ?? '',
			credentials.username,
		);
		const smbclientPath = this.getNodeParameter('smbclientPath', 0, 'smbclient') as string;
		const client = new SmbClientWrapper(credentials, smbclientPath, this.getNode());

		// Optionnel: tester existence ou list root pour vérifier la connexion
		await client.list(''); // ou client.exists(".");

		return { client };
	} catch (error: any) {
		debug('Connect error: %O', error);
		const readableError = getReadableError(error);
		throw new NodeApiError(this.getNode(), error, {
			message: `Failed to connect to SMB server: ${readableError}`,
		});
	}
}
