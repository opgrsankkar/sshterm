# sshterm

Desktop SSH terminal manager built with Electron + React + TypeScript.

`sshterm` reads your SSH config, organizes hosts into folders/spaces, opens interactive terminal tabs, and lets you manage host metadata directly from the UI.

## Features

- Use your existing SSH config file (default: `~/.ssh/config`).
- Open multiple SSH sessions in tabs (PTY-backed).
- Sidebar host browser with:
	- Favorites
	- Folders/directories
	- Space-based views
	- Unassigned hosts
- Drag-and-drop host assignment and folder moves.
- Host editor (add/update/delete host entries).
- Host reachability checks (`ping`) in the background.
- Host key change flow: detect warning, offer “Accept and Reconnect”.
- Configurable terminal scrollback.

## Keyboard Shortcuts

- `Cmd/Ctrl + ,` → Open Preferences
- `Cmd/Ctrl + Shift + ,` → Open active device settings
- `Cmd/Ctrl + S` → Toggle sidebar

## How sshterm maps SSH config to UI

The app uses special managed comments in your SSH config:

- `# x-sshterm-group: Global/Team/Foo` → Assign host to folder
- `# x-sshterm-favorites: true` → Mark host as favorite
- Managed folder/space block:
	- `# x-sshterm-managed-dirs:start`
	- `# x-sshterm-space: <SpaceName>` (optional)
	- `# x-sshterm-dir: Global/Path`
	- `# x-sshterm-managed-dirs:end`

Example:

```sshconfig
Host edge-router
	HostName 10.10.10.1
	User admin

# x-sshterm-group: Global/Lab/Network
# x-sshterm-favorites: true
Host core-switch
	HostName 10.10.10.2
	User admin

# x-sshterm-managed-dirs:start
# x-sshterm-dir: Global/Lab
# x-sshterm-space: Network
# x-sshterm-dir: Global/Lab/Network
# x-sshterm-managed-dirs:end
```

## Requirements

- Node.js 20+
- npm 10+
- OpenSSH available in PATH (the app prefers `/usr/bin/ssh` on macOS)
- A valid SSH config file

## Local Development

Install dependencies:

```bash
npm install
```

Run in dev mode:

```bash
npm run dev
```

Useful checks:

```bash
npm run lint
npm run typecheck
npm run build
```

## Build / Package

Create distributables:

```bash
npm run build:mac
npm run build:win
npm run build:linux
```

Build unpacked output only:

```bash
npm run build:unpack
```

## Project Structure

- `src/main` — Electron main process (IPC, SSH session management, config parsing)
- `src/preload` — secure renderer bridge APIs
- `src/renderer` — React UI
- `src/shared` — shared TypeScript types

## First GitHub Publish Checklist

Before your first public release, confirm these project metadata values are updated:

- `package.json`: `description`, `author`, `homepage`
- `electron-builder.yml`: `appId`, `publish.url`, maintainer fields/icons
- `dev-app-update.yml`: updater URL

Current defaults include placeholder values (for example `example.com` / `https://example.com/auto-updates`) and should be replaced for production publishing.

## License

Add your preferred license file (`LICENSE`) before publishing publicly.
