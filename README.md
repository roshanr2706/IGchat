# IGchat

A lightweight, Discord-style desktop client for Instagram DMs and group chats, built with Electron + Svelte 5.

> **Status:** Talks to your real Instagram account through a hidden window running Instagram's own web app (you log in on Instagram's own page; IGchat never sees your password). `npm run dev:mock` runs the UI against a fake in-memory backend instead.
>
> Third-party Instagram clients are against Instagram's Terms of Use. This is a personal-use tool; use it at your own risk.

## Develop

```bash
npm install
npm run dev        # run the app with hot reload
npm test           # unit + component tests
npm run typecheck  # tsc (main/preload/shared) + svelte-check (renderer)
npm run build      # production bundle in out/
npm run dist       # Windows installer via electron-builder
```

On a fresh clone, if npm's script policy blocks Electron's postinstall, the `electron` binary is missing and `npm run dev` fails. Run this once to fetch it:

```bash
node node_modules/electron/install.js
```

`npm run dist:linux` builds the Linux AppImage and `.deb` instead (run it on Linux).

`npm run dev:mock` uses the built-in mock backend: 30 fake conversations, an incoming message every ~20 seconds, and any message containing `[fail]` fails so you can try the retry flow.

## Releases

Pushing a version tag builds the installers on GitHub Actions and publishes them as a GitHub Release ([`.github/workflows/release.yml`](.github/workflows/release.yml)):

```bash
git tag v0.2.0
git push origin v0.2.0
```

The workflow runs the typecheck and tests, then builds the Windows installer (`.exe`) and the Linux `.deb` and AppImage, and attaches them to a release with notes generated from the commits. The tag sets the version, so `package.json` doesn't need bumping first. The `.exe` isn't code-signed, so Windows SmartScreen warns on first run (**More info → Run anyway**).

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl+K` | Quick switcher |
| `Alt+↑` / `Alt+↓` | Previous / next conversation |
| `Ctrl+B` | Collapse sidebar to avatars |
| `Ctrl+I` | Toggle details panel |
| `Ctrl+,` | Settings |
| `Ctrl+Shift+T` | Cycle theme |
| `↑` (empty composer) | Edit your last message |
| `Enter` / `Shift+Enter` | Send / new line |
| `Esc` | Close overlay · cancel reply · cancel edit |
| `Shift`+click Unsend | Unsend without confirmation |

## Themes

Built in: System, Light, Dark, Catppuccin Latte / Frappé / Macchiato / Mocha, Nord, Dracula, Gruvbox Dark — plus an optional accent override.

Custom themes are JSON files in the themes folder (Settings → **Open themes folder**, i.e. `%APPDATA%/igchat/themes`). Every token is required and must be a `#rrggbb` color:

```json
{
  "id": "ocean",
  "name": "Ocean",
  "appearance": "dark",
  "tokens": {
    "bg-base": "#0f1c2e",
    "bg-sidebar": "#0b1624",
    "bg-titlebar": "#08111c",
    "bg-elevated": "#0b1624",
    "bg-hover": "#16283f",
    "bg-active": "#1d3350",
    "bg-input": "#16283f",
    "text-normal": "#d6e4f0",
    "text-muted": "#8aa1b8",
    "text-header": "#ffffff",
    "text-link": "#4fc3f7",
    "accent": "#29b6f6",
    "accent-text": "#08111c",
    "border": "#08111c",
    "danger": "#ef5350",
    "mention-bg": "#1d3350",
    "scrollbar": "#1d3350"
  }
}
```

Click **Reload custom themes** after adding or editing a file. Invalid files are listed with the reason.

## Architecture

- `src/main` — Electron main process. `ChatService` is the backend contract; `MockChatService` implements it today. `handlers.ts` + `ipc.ts` expose it over a typed, whitelisted IPC contract (`src/shared/ipc.ts`).
- `src/preload` — sandboxed bridge exposing `window.ig`.
- `src/renderer` — Svelte 5 UI. Talks only through `lib/api.ts`; state lives in rune-based stores under `stores/`; every color is a theme token CSS variable.
