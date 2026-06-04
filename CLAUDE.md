# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An [n8n](https://n8n.io/) community node package that lets workflows interact with SMB2/SMB3 file shares. Unlike most SMB libraries, this implementation **shells out to the `smbclient` CLI** (the Samba `samba-client` package) rather than speaking the SMB protocol in JS. The `smbclient` binary must be installed in the n8n runtime/container — without it the node fails at runtime.

## Commands

```bash
npm run build      # rimraf dist + tsc compile + gulp copies icons into dist/
npm run dev        # tsc --watch
npm run lint       # eslint on nodes, credentials, package.json (n8n-nodes-base rules)
npm run lintfix    # eslint --fix
npm run format     # prettier --write on nodes and credentials
```

There is **no test suite** and no test runner configured. Verification is manual against a live SMB server / n8n instance (see "Local development" below).

Package manager is **pnpm** (see `pnpm-lock.yaml`), though npm scripts work too.

## Architecture

The build entrypoints n8n loads are declared in `package.json` under the `n8n` key — they point at compiled files in `dist/`, so you must `npm run build` before n8n can see changes.

Source is split into two halves:

- **`credentials/Smb2Api.credentials.ts`** — the `smb2Api` credential type (host, share, username, password, domain, port, timeouts). Note: several credential fields (`port`, timeouts, `maxProtocol`) are collected in the UI but **not actually passed to `smbclient`** — `buildBaseArgs()` only uses host/share/username/password/domain. Be aware of this gap when touching connection logic.

- **`nodes/Smb2/`** — the node itself, in three layers:
  - **`Smb2.node.ts`** — n8n node definition (all UI properties, operation list) and `execute()`. `execute()` looks up a handler from the `handlers` map by operation name, builds one client, then loops over input items calling the handler per item. The client is closed in a `finally` (currently a no-op, see below).
  - **`SmbEntryHelpers.ts`** — one `OpHandler` function per operation (`handleStat`, `handleList`, `handleGet`, etc.) plus the `handlers` map and `buildClient`. Handlers translate n8n params ↔ `SmbClientWrapper` calls. File transfers (`get`/`put`) go through a **temp file** in `os.tmpdir()` (n8n binary data ⇄ disk ⇄ smbclient), cleaned up after.
  - **`SmbClientWrapper.ts`** — the only place that spawns a process. Each method (`stat`, `list`, `get`, `put`, `mkdir`, `rmdir`, `del`, `rename`) builds an `smbclient` invocation and runs it via `runOne()` → `execFile`. Every command is a **separate process**; there is no persistent connection, so `close()` is intentionally a no-op (kept for API parity).

### Key cross-cutting concerns

- **`smbclient` invocation shape**: `runOne()` runs `smbclient \\\\host\\share -U user%pass -g -c "<cmd>"`. The `-g` flag forces machine-parseable (pipe-delimited) output. Anonymous access uses `-U %` when no username is given.
- **Output parsing is fragile by nature** — `list()` parses `smbclient` text output and handles *multiple* formats (pipe-delimited and space-aligned columns) plus footer/artifact filtering, because output varies across Samba builds. If list parsing breaks, this is the place to look, and add a new format branch rather than rewriting.
- **Secret redaction**: `runOne()` never lets raw credentials reach error messages or logs. `redactCmd()` strips `-U`/`-A` args and host paths; `maskSecrets()` replaces username/password/domain substrings with `***`. **Any new code that surfaces command strings or stderr must route through these helpers.**
- **Error mapping**: `getReadableError()` + the `SMB_ERROR_HINTS` regex table translate raw errno/NT_STATUS strings into friendly messages. Errors are thrown as `NodeOperationError` / `NodeApiError`.
- **Debug logging** uses Node's `debuglog('n8n-nodes-smbclient')` — enable with `NODE_DEBUG=n8n-nodes-smbclient`.

### Adding a new operation

1. Add the value to the `Operation` union in `interfaces.ts`.
2. Add a method on `SmbClientWrapper` that builds the `smbclient -c` command (quote/escape paths; reuse `escapeSmbArg`).
3. Add an `OpHandler` in `SmbEntryHelpers.ts` and register it in the `handlers` map.
4. Add the operation to the `options` list and any UI params (with `displayOptions.show`) in `Smb2.node.ts`.

## Local development

Build, then mount this repo into an n8n container and reference it from `~/.n8n/nodes/package.json` as `"n8n-nodes-smbclient": "file:/opt/code-temp"`, then restart. Full steps and a docker-compose volume example are in `Readme.md` ("Running local"). Verify the binary with `smbclient --version` inside the container.

## Conventions

- Tabs for indentation, single quotes, semicolons, 100-char width (`.prettierrc.js` / `.editorconfig`).
- Lint enforces `eslint-plugin-n8n-nodes-base` community-node rules — run `npm run lint` before publishing; `prepublishOnly` also runs a stricter lint config.
- Some inline comments are in French (legacy); match the surrounding language when editing nearby, otherwise prefer English.
