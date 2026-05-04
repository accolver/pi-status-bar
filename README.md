# pi-status-bar

A small [Pi](https://pi.dev) extension that replaces the default TUI footer with a theme-aware status bar showing git state and an AI-generated session summary.

## Features

- Sticky footer for Pi's interactive TUI.
- Current working folder, git branch, git worktree marker, and pending change counts.
- AI-generated session title, refreshed as the conversation evolves.
- Manual session title override with `ctrl+r` or `/session-bar-title`.
- Resume-friendly session names via `pi.setSessionName(...)`.
- Theme-aware colors using Pi theme tokens.
- No background timers in non-TUI/print mode.

## Install

From GitHub:

```bash
pi install git:github.com/accolver/pi-status-bar
```

After install, restart Pi or run:

```text
/reload
```

## Commands

```text
/session-bar-title
```

Set the session title manually. Once set, AI title refreshes stop overwriting it.

```text
/session-bar-refresh
```

Force-refresh git state and the AI session summary. Manual titles are preserved.

```text
/session-bar-toggle
```

Toggle the status bar for the current session.

## Shortcut

Press `ctrl+r` to enter a manual session title. To change the shortcut, set `PI_STATUS_BAR_TITLE_SHORTCUT` or edit `options.manualTitleShortcut` in `extensions/status-bar.ts`.

## How it works

The extension uses Pi's extension APIs:

- `ctx.ui.setFooter(...)` for the sticky TUI footer.
- `pi.exec(...)` for read-only git status checks.
- `complete(...)` with the currently selected Pi model for short summaries.
- `pi.setSessionName(...)` so `/resume` shows the generated session title.
- `pi.appendEntry(...)` to persist summary metadata without adding it to LLM context.

## Package metadata

This repo is packaged for Pi with:

```json
{
  "keywords": ["pi-package", "pi-extension"],
  "pi": {
    "extensions": ["./extensions/status-bar.ts"]
  }
}
```

## License

MIT
