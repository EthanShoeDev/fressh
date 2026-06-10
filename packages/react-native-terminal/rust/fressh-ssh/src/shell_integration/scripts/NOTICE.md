# Vendored shell-integration scripts

These scripts are vendored **verbatim** from Visual Studio Code
(`src/vs/workbench/contrib/terminal/common/scripts/`) and are licensed under the
MIT License, Copyright (c) 2015 - present Microsoft Corporation.

| file here         | upstream                       |
| ----------------- | ------------------------------ |
| `bash.sh`         | `shellIntegration-bash.sh`     |
| `zsh-rc.zsh`      | `shellIntegration-rc.zsh`      |
| `zsh-env.zsh`     | `shellIntegration-env.zsh`     |
| `zsh-profile.zsh` | `shellIntegration-profile.zsh` |
| `zsh-login.zsh`   | `shellIntegration-login.zsh`   |
| `fish.fish`       | `shellIntegration.fish`        |

They emit VS Code's `OSC 633` shell-integration protocol, which fressh's
`OscScanner` (`fressh-core/src/osc.rs`) parses. fressh delivers them per-session
via `shell_integration.rs` (a `sh -c` bootstrap that base64-materializes them into
a temp dir and execs the right interactive shell) instead of VS Code's on-host
server. See `docs/projects/terminal-semantic-events.md`.

Keep these in sync with upstream rather than diverging (see the OSC-633 decision in
the project doc). Do not edit the script bodies; adjust delivery in
`shell_integration.rs`.

## MIT License

Copyright (c) 2015 - present Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in the
Software without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
and to permit persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
