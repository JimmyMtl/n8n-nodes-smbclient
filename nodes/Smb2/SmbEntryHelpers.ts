import {debuglog} from "util";
import {IExecuteFunctions, INodeExecutionData, NodeOperationError} from "n8n-workflow";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {SmbClientWrapper} from "./SmbClientWrapper";
import {Operation, OpHandler, Smb2Credentials, SmbListEntry} from "./interfaces";
import fs from "node:fs/promises";

const debug = debuglog("n8n-nodes-smbclient");
const str = (ctx: IExecuteFunctions, i: number, name: string, def = ''): string =>
	ctx.getNodeParameter(name, i, def) as string;

const tmpFile = (prefix: 'get' | 'put') =>
	path.join(os.tmpdir(), `n8n-smb-${prefix}-${Date.now()}-${crypto.randomUUID()}`);

const toBinary = async (
	ctx: IExecuteFunctions,
	buf: Buffer,
	fileName: string,
	mime: string,
	outProp: string,
	extraJson: Record<string, unknown> = {},
): Promise<INodeExecutionData> => {
	const binary = await ctx.helpers.prepareBinaryData(buf, fileName, mime);
	return {json: {fileName, ...extraJson}, binary: {[outProp]: binary}};
};

const buildClient = async (ctx: IExecuteFunctions): Promise<SmbClientWrapper> => {
	const smbclientPath = str(ctx, 0, 'smbclientPath', 'smbclient');
	const {host, username, password, domain, share} = (await ctx.getCredentials('smb2Api')) as unknown as Smb2Credentials;
	debug(
		"Connecting to //%s/%s as (%s\\%s)",
		host,
		share,
		domain ?? "",
		username,
	);
	return new SmbClientWrapper({host, username, password, domain, share}, smbclientPath, ctx.getNode());
};

/* ---------- Handlers (take ctx instead of this) ---------- */
const handleStat: OpHandler = async (ctx, i, client) => {
	const remotePath = str(ctx, i, 'remotePath');
	const stat = await client.stat(remotePath);
	return {json: {remotePath, ...stat}};
};

const handleList: OpHandler = async (ctx, i, client) => {
	const directory = str(ctx, i, 'directory', '/');
	const entries = await client.list(directory);
	const filtered = entries.filter(
		(e: SmbListEntry) =>
			e &&
			e.name !== '.' &&
			e.name !== '..' &&
			!/blocks available/i.test(e?.date || '') &&
			!/^\d+$/.test(e.name),
	);
	return {json: {directory, entries: filtered}};
};

const handleGet: OpHandler = async (ctx, i, client) => {
	const remotePath = str(ctx, i, 'remotePath');
	const outProp = str(ctx, i, 'outBinaryPropertyName', 'data');
	const outFile = str(ctx, i, 'outFileName') || path.basename(remotePath);
	const outMime = str(ctx, i, 'outMimeType', 'application/octet-stream');

	const tmp = tmpFile('get');
	await client.get(remotePath, tmp);
	const buf = await fs.readFile(tmp);
	await fs.unlink(tmp).catch(() => {
	});
	return toBinary(ctx, buf, outFile, outMime, outProp, {remotePath});
};

const handlePut: OpHandler = async (ctx, i, client) => {
	const remotePath = str(ctx, i, 'remotePath');
	const source = str(ctx, i, 'putSource', 'binary'); // 'binary' | 'text'

	const tmp = tmpFile('put');
	if (source === 'binary') {
		const binProp = str(ctx, i, 'binaryPropertyName', 'data');
		const item = ctx.getInputData()[i];
		if (!item.binary || !item.binary[binProp]) {
			throw new NodeOperationError(ctx.getNode(), `Binary property "${binProp}" not found on item ${i}`);
		}
		const buffer = await ctx.helpers.getBinaryDataBuffer(i, binProp);
		await fs.writeFile(tmp, buffer);
	} else {
		const text = str(ctx, i, 'textContent', '');
		await fs.writeFile(tmp, text, 'utf8');
	}

	await client.put(tmp, remotePath);
	await fs.unlink(tmp).catch(() => {
	});
	return {json: {remotePath, uploaded: true}};
};

const handleMkdir: OpHandler = async (ctx, i, client) => {
	const directory = str(ctx, i, 'directory');
	await client.mkdir(directory);
	return {json: {directory, created: true}};
};

const handleRmdir: OpHandler = async (ctx, i, client) => {
	const directory = str(ctx, i, 'directory');
	await client.rmdir(directory);
	return {json: {directory, removed: true}};
};

const handleDel: OpHandler = async (ctx, i, client) => {
	const remotePath = str(ctx, i, 'remotePath');
	await client.del(remotePath);
	return {json: {remotePath, deleted: true}};
};

const handlers: Record<Operation, OpHandler> = {
	stat: handleStat,
	list: handleList,
	get: handleGet,
	put: handlePut,
	mkdir: handleMkdir,
	rmdir: handleRmdir,
	del: handleDel,
};

export {handlers, buildClient}
