# sshterm

Local browser-based SSH terminal manager built with React, TypeScript, and Node.js. The app runs in a browser. Electron is no longer part of the runtime.

`sshterm` reads your existing SSH config, organizes hosts into folders and spaces, and opens interactive PTY-backed SSH sessions in a browser. The Node service binds only to `127.0.0.1`; it does not expose SSH access to the network.

## Features

- Use your existing SSH config file. The default is `~/.ssh/config`.
- Open multiple SSH sessions in browser tabs.
- Browse favorites, folders, spaces, and unassigned hosts.
- Drag hosts between folders and spaces.
- Add, update, and delete SSH host entries.
- Check host reachability with the system `ping` command.
- Detect changed host keys and remove the old `known_hosts` entry after confirmation.
- Configure terminal scrollback.

## How it works

The React client runs in a normal browser. A local Node service handles the operations that browsers cannot perform:

- Spawning OpenSSH inside a PTY
- Reading and writing the SSH config
- Running reachability checks
- Updating `known_hosts`

Host and settings operations use a local HTTP API. Terminal input and output use a WebSocket. In production, the service listens on `127.0.0.1:2222` and Caddy exposes it at `http://sshterm.test`.

## Requirements

- Node.js 20.19 or newer
- npm 10 or newer
- OpenSSH available in `PATH`. On macOS, the service prefers `/usr/bin/ssh`.
- A valid SSH config file
- Caddy, if you want to use `http://sshterm.test` instead of a port URL

`node-pty` is a native dependency. If npm cannot use a prebuilt binary on your platform, you will also need the usual C/C++ build tools and Python required by `node-gyp`.

## Development

Install dependencies:

```bash
npm install
```

Start the Node service and Vite development server:

```bash
npm run dev
```

Open `http://127.0.0.1:5173`. Vite serves the React client on port `5173` and proxies API and WebSocket requests to the development service on port `4174`.

Useful checks:

```bash
npm run lint
npm run typecheck
npm run build
```

## Production run

Build and start the Node service:

```bash
npm run build
npm start
```

Open `http://127.0.0.1:4173`.

For a runtime-only installation, omit development dependencies after building:

```bash
npm prune --omit=dev
```

Run `npm install` again when you need the development tools.

## Run at login on macOS

The repository includes [a LaunchAgent definition](deploy/com.sshterm.local-server.plist) for this Mac. It runs the production build on `127.0.0.1:2222`, starts when the user logs in, and restarts after a crash. The runtime files live under `~/Library/Application Support/sshterm-server` because macOS restricts background access to the `Documents` folder.

Build the app before loading the agent:

```bash
npm install
npm run build
npm prune --omit=dev
mkdir -p ~/Library/LaunchAgents ~/Library/Logs/sshterm-server
mkdir -p ~/Library/Application\ Support/sshterm-server
ditto dist ~/Library/Application\ Support/sshterm-server/dist
ditto node_modules ~/Library/Application\ Support/sshterm-server/node_modules
cp package.json package-lock.json ~/Library/Application\ Support/sshterm-server/
cp deploy/com.sshterm.local-server.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sshterm.local-server.plist
```

Open `http://127.0.0.1:2222` after the agent starts. This is the backend's browser entrypoint when Caddy is not in use.

## Use sshterm.test

Caddy provides the local hostname and forwards requests to the Node service. The checked-in configuration is [deploy/Caddyfile](deploy/Caddyfile). `.test` is intentional. `.local` is reserved for Bonjour and can resolve through mDNS instead of `/etc/hosts`.

Install Caddy with Homebrew:

```bash
brew install caddy
```

Map the hostname to loopback:

```bash
sudo sh -c 'printf "\n127.0.0.1 sshterm.test\n" >> /etc/hosts'
```

Install and validate the Caddy configuration:

```bash
cp deploy/Caddyfile /opt/homebrew/etc/Caddyfile
caddy validate --config /opt/homebrew/etc/Caddyfile
brew services start caddy
```

Open `http://sshterm.test`. Caddy listens on port `80` and proxies to `127.0.0.1:2222`. The Node service explicitly allows `sshterm.test` as a browser host and origin for this local proxy.

When the browser build or server code changes, rebuild and copy the complete `dist` directory to the runtime location, then restart the LaunchAgent:

```bash
npm run build
ditto dist ~/Library/Application\ Support/sshterm-server/dist
launchctl kickstart -k gui/$(id -u)/com.sshterm.local-server
```

Caddy does not need a restart when only the application build changes.

Inspect or restart the service:

```bash
launchctl print gui/$(id -u)/com.sshterm.local-server
launchctl kickstart -k gui/$(id -u)/com.sshterm.local-server
```

Stop and remove it:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.sshterm.local-server.plist
rm ~/Library/LaunchAgents/com.sshterm.local-server.plist
```

The checked-in plist uses `/opt/homebrew/bin/node` and this Mac's 1Password SSH agent socket. Update those paths if Node or the SSH agent changes. A LaunchAgent runs after login, not at the macOS login screen. It pauses while the laptop sleeps and continues after wake.

## Settings

The service stores settings in:

```text
~/.config/sshterm/settings.json
```

Set `XDG_CONFIG_HOME` to change the base config directory. These environment variables provide more direct overrides:

- `SSHTERM_CONFIG` sets the initial SSH config path.
- `SSHTERM_SETTINGS_PATH` sets the settings file path.
- `PORT` changes the production HTTP port. The service still binds to `127.0.0.1`.

## Keyboard shortcuts

- `Cmd/Ctrl + ,` opens preferences.
- `Cmd/Ctrl + Shift + ,` opens settings for the active device.
- `Cmd/Ctrl + S` toggles the sidebar.
- `Cmd/Ctrl + T` opens host search.
- `Cmd/Ctrl + F` searches the current terminal.
- `Cmd/Ctrl + Shift + F` searches all terminal tabs.

Browsers reserve some shortcuts, including tab switching and window closing. Those combinations may not reach the app. The matching controls remain available in the UI.

## SSH config metadata

The app uses managed comments in your SSH config:

- `# x-sshterm-group: Global/Team/Foo` assigns a host to a folder.
- `# x-sshterm-favorites: true` marks a host as a favorite.
- A managed folder and space block records empty folders and space roots.

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

## Project structure

- `src/renderer` contains the React browser UI and browser API adapter.
- `src/server` contains the local HTTP and WebSocket service.
- `src/main` contains the operating-system SSH, PTY, config, and reachability services.
- `src/shared` contains shared API and model types.

## Security boundary

This is a single-user local app. The Node service binds to `127.0.0.1` and rejects unknown browser hosts and origins. `sshterm.test` is allowed only for the local Caddy proxy. Do not remove these checks or expose the service through a public interface. A remotely hosted version would need authentication, TLS, per-user SSH configuration, credential isolation, and access controls for target hosts.

## License

See [LICENSE.md](LICENSE.md).
