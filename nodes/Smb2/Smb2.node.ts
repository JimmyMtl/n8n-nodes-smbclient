import type {
	IExecuteFunctions, INodeExecutionData,
	INodeType,
	INodeTypeDescription
} from 'n8n-workflow';
import {Operation} from "./interfaces";
import {buildClient, handlers} from "./SmbEntryHelpers";
import { NodeOperationError } from 'n8n-workflow';
export class Smb2 implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SMB2 using smbclient',
		name: 'smb2',
		icon: 'file:smb2.svg',
		group: ['transform'],
		version: 1,
		description: 'Interact with SMB shares using the smbclient CLI',
		defaults: {
			name: 'Smbclient (SMB2) API',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'smb2Api',
				required: true,
			},
		],
		properties: [
			/* Connection */
			{
				displayName: 'Smbclient Path',
				name: 'smbclientPath',
				type: 'string',
				default: 'smbclient',
				description: 'Custom path to smbclient binary, if not in PATH',
			},

			/* Operation */
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Delete File', value: 'del', description: 'Delete a file',
						action: 'Delete a file'
					},
					{
						name: 'Get File', value: 'get', description: 'Download a file from SMB',
						action: 'Get a file'
					},
					{
						name: 'List Directory', value: 'list', description: 'List a directory',
						action: 'List a directory'
					},
					{
						name: 'Make Directory', value: 'mkdir', description: 'Create a directory',
						action: 'Create a directory'
					},
					{
						name: 'Remove Directory', value: 'rmdir', description: 'Remove a directory',
						action: 'Remove a directory'
					},
					{
						name: 'Stat', value: 'stat', description: 'Get file/folder metadata',
						action: 'Get file folder metadata'
					},
					{
						name: 'Upload File', value: 'put', description: 'Upload a file',
						action: 'Upload a file'
					}
				],
				default: 'list',
			},

			/* Common path(s) */
			{
				displayName: 'Remote Path',
				name: 'remotePath',
				type: 'string',
				default: '/',
				displayOptions: {
					show: {
						operation: ['stat', 'get', 'put', 'del'],
					},
				},
			},
			{
				displayName: 'Directory',
				name: 'directory',
				type: 'string',
				default: '/',
				displayOptions: {
					show: {
						operation: ['list', 'mkdir', 'rmdir'],
					},
				},
			},

			/* Put options */
			{
				displayName: 'Source',
				name: 'putSource',
				type: 'options',
				options: [
					{name: 'Binary Property', value: 'binary'},
					{name: 'Text', value: 'text'},
				],
				default: 'binary',
				displayOptions: {show: {operation: ['put']}},
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				displayOptions: {
					show: {operation: ['put'], putSource: ['binary']},
				},
			},
			{
				displayName: 'Text Content',
				name: 'textContent',
				type: 'string',
				typeOptions: {rows: 4},
				default: '',
				displayOptions: {
					show: {operation: ['put'], putSource: ['text']},
				},
			},

			/* Get options */
			{
				displayName: 'Binary Property (Output)',
				name: 'outBinaryPropertyName',
				type: 'string',
				default: 'data',
				displayOptions: {show: {operation: ['get']}},
			},
			{
				displayName: 'File Name (Output)',
				name: 'outFileName',
				type: 'string',
				default: '',
				placeholder: 'example.txt',
				displayOptions: {show: {operation: ['get']}},
			},
			{
				displayName: 'MIME Type (Output)',
				name: 'outMimeType',
				type: 'string',
				default: 'application/octet-stream',
				displayOptions: {show: {operation: ['get']}},
			},
		],
	};

	async execute(this: IExecuteFunctions) {
		const op = this.getNodeParameter('operation', 0) as Operation;
		const handler = handlers[op];
		if (!handler) {
			throw new NodeOperationError(this.getNode(), `Unsupported operation: ${op}`);
		}

		const items = this.getInputData();
		const client = await buildClient(this);

		const out: INodeExecutionData[] = [];
		try {
			for (let i = 0; i < items.length; i++) {
				out.push(await handler(this, i, client));
			}
		} catch (err) {
			console.error(err)
			throw new NodeOperationError(this.getNode(), (err as Error)?.message || 'SMB operation failed');
		} finally {
			await client.close().catch(() => {
			});
		}

		return this.prepareOutputData(out);
	}
}
