# n8n-nodes-smbclient

This is a n8n community node that lets you interact with Samba/SMB2 file shares in your n8n workflows using
samba-client linux package. It enables
reading, writing, and managing files on SMB2-compatible network shares.

[N8N](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

- [Installation](#installation)
- [Operations](#operations)
- [Credentials](#credentials)
- [Compatibility](#compatibility)
- [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community
nodes documentation.

## Operations

The node supports the following operations:

- Download a file from the SMB share.

- Upload a file to the SMB share.

- List the contents of a directory on the SMB share.

- Delete a file or folder from the SMB share.

- Rename or moves a file or folder on the SMB share.

## Credentials

You need the following credentials to connect to an SMB share:

- **Host**: The hostname or IP address of the SMB server
- **Share Name**: The name of the share to connect to
- **Username**: Username for authentication
- **Password**: Password for authentication
- **Domain**: (Optional) Domain name for Active Directory authentication

## Compatibility

- /!\ **Requires** samba-client apk package installed on image /!\
- **Requires** n8n version 1.0.0 or later
- Node.js v18.10 or later
- Compatible with SMB2/SMB3 protocol

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
* [SMB2 Protocol Documentation](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-smb/5606ad47-5ee0-437a-817e-70c366052962)
* [Samba Documentation](https://www.samba.org/samba/docs/)

## Error Handling

The node provides detailed error messages for common SMB issues:

- Access denied errors
- Network connectivity issues
- File/path not found
- Share not found
- Authentication failures
- Quota issues
- File sharing violations

## Running local

> Required podman and n8nio image setup

1. Update package.json with the following lines

```json
{
	//	...
	"n8n": {
		"n8nNodesApiVersion": 1,
		"credentials": [
			"dist/credentials/Smb2Api.credentials.js"
		],
		"nodes": [
			"dist/nodes/Smb2/Smb2.node.js"
		]
	}
	//...
}
```

2. Run build
3. Launch a terminal to your podman container
4. Go to nodes folder

```shell
cd ~/.n8n/nodes
```

5. Update package.json in `~/.n8n/nodes` using `vim` and put the following line

```json
{
	"name": "installed-nodes",
	"private": true,
	"dependencies": {
		"n8n-nodes-smbclient": "file:/opt/code-temp"
	}
}
```

> **Warning:** be sure to mount a volumes in your image, example with a docker-compose :
>  ```yaml
> services:
>	  n8n:
>	  image: n8nio/n8n:1.111.0
>	    ports:
>	      - "5678:5678"
>	    volumes:
>	     - C:\_wksp\my-folder\n8n-nodes-smbclient:/opt/code-temp

6. Restart your pod and voilà
