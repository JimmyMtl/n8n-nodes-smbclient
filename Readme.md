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

> Be sure to have the samba-client package installed in your n8n instance/container.
> For example, in a Dockerfile based on n8n image, you can add:
> ```Dockerfile
> RUN apk add --no-cache samba-client
> ```
> This ensures that the samba-client is installed before n8n starts.
>
> Without this package, the SMB node will not function correctly.
>
> Make sure to rebuild your Docker image or restart your container after making these changes.
> You can verify the installation by running `smbclient --version` inside your n8n container.
>
> If the command returns the version of samba-client, the installation was successful.
>
> If you encounter any issues, refer to the samba-client documentation or seek help from the n8n community forums.
>
> Remember to keep your samba-client package updated to ensure compatibility and security.
>
> For Alpine-based images, use `apk add --no-cache samba-client`.
>
> For Debian/Ubuntu-based images, use `apt-get update && apt-get install -y smbclient`.
>
> For CentOS-based images, use `yum install -y samba-client`.
>
> Adjust the package manager commands based on your specific Linux distribution used in your n8n instance.
>
> Ensure that the samba-client version is compatible with your SMB server version to avoid connectivity issues.

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

## Running local (Development)

> Required podman and n8nio image setup

1. Run build
2. Launch a terminal to your podman container
3. Go to nodes folder

```shell
cd ~/.n8n/nodes
```

4. Update package.json in `~/.n8n/nodes` using `vim` and put the following line

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
>	  image: n8nio/n8n:1.118.0
>	    ports:
>	      - "5678:5678"
>	    volumes:
>	     - C:\_wksp\my-folder\n8n-nodes-smbclient:/opt/code-temp

6. Restart your pod and voilà
