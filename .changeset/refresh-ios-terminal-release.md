---
'@fressh/mobile': minor
---

First release cut by the new CI pipeline (changesets → GitHub Actions `eas build --local` → GitHub Release). Highlights since 0.0.4:

- **iOS support**: the SSH terminal now runs on iOS — russh control plane plus an ANGLE→Metal render plane for the alacritty-based terminal.
- **Commands tab**: preset manager and a one-off command runner (russh exec) for firing quick commands at a host without opening a shell.
- **Smarter terminal surface**: context bar, paged toolbar/presets, automatic OSC 633 shell integration (global and per-host settings), and a git-aware status badge with a diff view.
- **Theming**: new multi-theme system (Phosphor, Graphite, Aurora, Monolith) plus a "Native" theme built from platform controls, with switchable JS/native tab bar.
- **Quality**: resilient SSH key storage, readable connect errors, keyboard-safe connect form and bottom sheets, host/session rename, and full-width shell terminal.
