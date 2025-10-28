import {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class Smb2Api implements ICredentialType {
	name = 'smb2Api';
	displayName = 'Smbclient (SMB2) API';
	properties: INodeProperties[] = [
		{
			displayName: 'Server',
			name: 'host',
			type: 'string',
			required: true,
			default: '',
		},
		{
			displayName: 'User Name',
			name: 'username',
			type: 'string',
			required: true,
			default: '',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: {
				password: true,
			},
			noDataExpression: true,
			required: true,
			default: '',
		},
		{
			displayName: 'Domain',
			name: 'domain',
			type: 'string',
			default: '',
		},
		{
			displayName: 'Port',
			name: 'port',
			type: 'number',
			default: 445,
		},
		{
			displayName: 'Share Name',
			name: 'share',
			type: 'string',
			required: true,
			default: '',
		},
		{
			displayName: 'Connect Timeout',
			name: 'connectTimeout',
			type: 'number',
			description: 'Connection timeout in ms',
			default: 15000,
		},
		{
			displayName: 'Request Timeout',
			name: 'requestTimeout',
			description: 'Request timeout in ms',
			type: 'number',
			default: 15000,
		},
	];
}
