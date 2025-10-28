import {IExecuteFunctions, INodeExecutionData} from "n8n-workflow";
import {SmbClientWrapper} from "./SmbClientWrapper";

interface Smb2Credentials {
	host: string;
	share: string;
	domain?: string;
	username: string;
	password: string;
	port?: number;           // samba-client may not support explicit port
	maxProtocol?: string;    // passed through
	// timeout options (if supported)
}

type SmbListEntry = {
	name: string;
	size: number;
	date?: string;
	time?: string;
	attributes: string[];
	isDirectory: boolean;
};

type SmbStat = {
	size?: number;
	createTime?: string;
	accessTime?: string;
	writeTime?: string;
	changeTime?: string;
	attributes?: string[];
	isDirectory?: boolean;
};
type Operation = 'stat' | 'list' | 'get' | 'put' | 'mkdir' | 'rmdir' | 'del';
type OpHandler = (ctx: IExecuteFunctions, i: number, client: SmbClientWrapper) => Promise<INodeExecutionData>;

export {
	SmbStat, SmbListEntry, Smb2Credentials, Operation
	, OpHandler
}
