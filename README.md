# pi-status-bar

A small [Pi](https://pi.dev) extension that replaces the default TUI footer with a theme-aware status bar showing git state and an AI-generated session summary.

## Features

- Sticky footer for Pi's interactive TUI.
- Current working folder, git branch, and pending change counts.
- AI-generated session title, refreshed as the conversation evolves.
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
/session-bar-refresh
```

Force-refresh git state and the AI session summary.

```text
/session-bar-toggle
```

Toggle the status bar for the current session.

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
