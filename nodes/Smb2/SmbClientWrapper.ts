import {
	IExecuteFunctions,
	INode, ITriggerFunctions, NodeApiError,
	NodeOperationError
} from "n8n-workflow";
import {promisify} from "node:util";
import {execFile} from "node:child_process";
import {Smb2Credentials, SmbListEntry, SmbStat} from "./interfaces";
import {debuglog} from "util";

const debug = debuglog("n8n-nodes-smbclient");
// Refaire une map d’erreurs si besoin
const SMB_ERROR_HINTS: Array<[RegExp, string]> = [
	[/EACCES/i, "Access Denied - Check your permissions for this file/folder"],
	[/ENOENT/i, "File/Path Not Found"],
	[/ENOTDIR/i, "Not a directory"],
	[/ETIMEOUT/i, "Connection timed out"],
	[/ECONNREFUSED/i, "Could not connect to SMB server - Connection refused"],
	[/LOGON failure/i, "Logon Failure - Check your username, password, and domain"],
	[/bad network name/i, "Bad Network Name - The specified share does not exist on the server"],
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


const execFileAsync = promisify(execFile);
const redactCmd = (s: string): string => {
	if (!s) return s;
	s = s.replace(/-U\s+(\S=)/g, '-U ***');
	s = s.replace(/-A\s=\S+/g, '-A ***');
	s = s.replace(/\/\/[^/\s]+\/\S+/g, '//***');
	return s;
}

export class SmbClientWrapper {
	constructor(
		private auth: Smb2Credentials,
		private smbclientPath: string = 'smbclient',
		private node: INode
	) {
	}


	private buildBaseArgs(): string[] {
		const {host, username, password, domain, share} = this.auth;

// Anonymous if no username supplied
		let userPart = '%';
		if (username) {
			if (!domain) {
				userPart = `${username}%${password ?? ''}`
			} else {
				userPart = `${domain}/${username}%${password ?? ''}`
			}
		}
		const hostPart = `\\\\${host}\\${share}`;
		return [hostPart, '-U', userPart, '-g'];
	}

	private async runOne(cmd: string): Promise<string> {
		const args = [...this.buildBaseArgs(), '-c', cmd];

		try {
			const {stdout, stderr} = await execFileAsync(this.smbclientPath, args, {
				maxBuffer: 10 * 1024 * 1024,
			});
// smbclient sometimes prints warnings to stderr; detect real errors
			if (stderr && /NT_STATUS|Error|failed/i.test(stderr)) {
				const {username, password} = this.auth;
				const safeCmd = redactCmd([this.smbclientPath, ...args].join(' ')).replace(username, '***').replace(password, '***');
				throw new NodeOperationError(this.node, {
					message: `smbclient failed. cmd="${safeCmd}" stderr="${stderr.trim()}"`
				});
			}
			return stdout ?? '';
		} catch (err) {

			const {username, password} = this.auth;
			const safeCmd = redactCmd(err?.cmd || [this.smbclientPath, ...args].join(' ')).replace(username, '***').replace(password, '***');
			const msg = (err?.stderr?.trim?.() || err?.message || 'smbclient command failed').replace(username, '***').replace(password, '***');
			throw new NodeOperationError(this.node, {
				message: `smbclient failed. cmd="${safeCmd}" stderr="${String(msg)}`
			})
		}

	}

	async stat(remotePath: string): Promise<SmbStat> {
		const out = await this.runOne(`allinfo "${remotePath}"`);
		const info = new Map<string, string>();
		for (const line of out.split('\n')) {
			const [k, v] = line.split('|');
			if (k && v !== undefined) info.set(k.trim().toUpperCase(), v.trim());
		}
		const attrs = (info.get('ATTRIBUTES') ?? '').split('').filter(Boolean);
		return {
			size: info.get('SIZE') ? Number(info.get('SIZE')) : undefined,
			createTime: info.get('CREATE_TIME') ?? undefined,
			accessTime: info.get('ACCESS_TIME') ?? undefined,
			writeTime: info.get('WRITE_TIME') ?? undefined,
			changeTime: info.get('CHANGE_TIME') ?? undefined,
			attributes: attrs,
			isDirectory: attrs.includes('D'),
		};
	}

	async list(dir: string): Promise<SmbListEntry[]> {
		const out = await this.runOne(`ls "${dir}"`);

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

				// Alternate pattern seen on some builds: attr|size|date|time|name
				if (parts.length >= 5 && /^\d+$/.test(parts[1])) {
					const attr = parts[0] ?? '';
					const size = Number(parts[1]) || 0;
					const date = parts[2];
					const time = parts[3];
					const name = parts.slice(4).join('|'); // keep any extra pipes in name
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

// No persistent connection to close for smbclient CLI, but keep API parity.
	async close(): Promise<void> {
		/* no-op */
	}
}

export async function connectToSmbServer(
	this: IExecuteFunctions | ITriggerFunctions
): Promise<{ client: SmbClientWrapper }> {
	try {
		const credentials = (await this.getCredentials("smb2Api")) as unknown as Smb2Credentials;

		debug(
			"Connecting to //%s/%s as (%s\\%s)",
			credentials.host,
			credentials.share,
			credentials.domain ?? "",
			credentials.username,
		);
		const smbclientPath = this.getNodeParameter('smbclientPath', 0, 'smbclient') as string;
		const client = new SmbClientWrapper(credentials, smbclientPath, this.getNode());

		// Optionnel: tester existence ou list root pour vérifier la connexion
		await client.list("");  // ou client.exists(".");

		return {client};
	} catch (error: any) {
		debug("Connect error: %O", error);
		const readableError = getReadableError(error);
		throw new NodeApiError(this.getNode(), error, {message: `Failed to connect to SMB server: ${readableError}`});
	}
}
