# @fressh/react-native-terminal

Native SSH terminal for React Native, in **one package / one `.so`**:

- **SSH** via russh (`fressh-ssh`)
- **VT engine** via `alacritty_terminal` — durable, parsed `Term` state
- **Native renderer** via alacritty's GLES2 renderer (`fressh-render`) — replaces
  the xterm.js WebView
- **Registry-owned sessions** (`fressh-core`) → tmux-style reattach, full
  scrollback on re-entry, no byte replay

Replaces both `@fressh/react-native-uniffi-russh` and
`@fressh/react-native-xtermjs-webview`.

> **Status: scaffold + renderer extraction proven.** The package is still
> mostly stubs, BUT the riskiest piece is done: the fork's `alacritty_renderer`
> crate (submodule at `rust/vendor/alacritty`) compiles on the host, and
> `fressh-render` consumes it via path-dep with a single shared
> `alacritty_terminal` (run `bun run cargo:build` in the dev shell). The full
> design, rationale, and rejected alternatives live in
> [`docs/projects/native-rendering-refactor.md`](../../docs/projects/native-rendering-refactor.md).
> Section references (§N) below point there.

## Architecture (the four planes, §10)

| Plane   | Path                                                  | Crosses JS?           |
| ------- | ----------------------------------------------------- | --------------------- |
| Control | JS `src/ssh.ts` → shim (uniffi/craby) → `fressh-core` | yes (rare, async)     |
| Event   | `fressh-core` → shim → JS (one-way sink)              | yes (rare)            |
| Render  | Nitro view ↔ `fressh-core` C-ABI                      | **never**             |
| Data    | SSH bytes → reader loop → `Term`                      | **never (pure Rust)** |

## Layout

```
react-native-terminal/
├── rust/                     # ONE cargo workspace (modularity lives here, §8)
│   ├── fressh-ssh/           # russh wrapper                        [agnostic]
│   ├── fressh-render/        # alacritty GLES2 renderer over Term   [agnostic]
│   ├── fressh-core/          # runtime + registry + sessions + C-ABI [THE boundary]
│   ├── shim-uniffi/          # thin binding shim — SHIPPED FIRST    [swappable]
│   ├── rustfmt.toml · clippy.toml · justfile   # lint/format setup
│   └── Cargo.toml            # workspace + [workspace.lints]
├── nitro/Terminal.nitro.ts   # native view spec (render plane only)
├── src/                      # TS public API (Terminal, ssh control plane)
├── cpp/ android/ ios/        # hand-authored umbrella native glue (§8)
└── ReactNativeTerminal.podspec · ubrn.config.yaml · package.json
```

### Deviation from the doc's directory tree (for review)

The doc (§10) drew `bindings/uniffi` + `bindings/craby` as a top-level sibling of
`rust/`. This scaffold instead keeps the binding shims **inside the cargo
workspace** as `rust/shim-uniffi` (and later `rust/shim-craby`), because they are
Rust crates and a single workspace is simpler to build and matches the existing
`react-native-uniffi-russh` "all Rust under `rust/`" convention. The swap-uniffi-
for-craby plan is unchanged. _If you'd rather mirror the doc's `bindings/` layout,
say so and I'll move them._

## alacritty renderer sourcing (decided, §6)

We consume **our fork** of alacritty as a **git submodule** at
`rust/vendor/alacritty` (branch `fressh`), and `fressh-render` path-deps into the
thin `alacritty_renderer` lib crate the fork adds. One pin (submodule SHA), local
source for free, and the fork branch _is_ the repeatable patch. To set up:

```sh
# after forking github.com/alacritty/alacritty -> EthanShoeDev/alacritty
git submodule add -b fressh https://github.com/EthanShoeDev/alacritty \
    packages/react-native-terminal/rust/vendor/alacritty
```

The fork's `fressh` branch lib-exposes `renderer/` + the measured subset it needs
(`gl`, `display::{SizeInfo, content::RenderableCell, color::Rgb}`,
`config::{Delta, font, RendererPreference}`) with **no winit/glutin** — the GL
context seam is ours. Update alacritty = rebase the branch on an upstream tag +
move the submodule pointer.

> Other open item: iOS GLES is deprecated-now → ANGLE→Metal later; v1 PoC is
> **Android-first**. (§5)

## Tooling

```sh
bun run cargo:fmt:fix     # cargo fmt --all
bun run cargo:lint:fix    # cargo clippy --workspace --fix -D warnings
bun run cargo:test        # cargo test --workspace
```

Lint levels are defined once in `rust/Cargo.toml` `[workspace.lints]` and
inherited per-crate via `[lints] workspace = true`.
