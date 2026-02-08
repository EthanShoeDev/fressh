# Repository Guidelines

## Project Structure & Module Organization
This is a pnpm + Turbo monorepo.
- `apps/mobile` - Expo React Native app (primary product).
- `apps/web` - Astro marketing/site.
- `packages/react-native-uniffi-russh` - RN TurboModule backed by Rust (UniFFI).
- `packages/react-native-xtermjs-webview` - WebView-based xterm.js renderer.
- `packages/assets` - shared assets (screenshots).
- Generated artifacts live in `src/generated`, `cpp/generated`, and package
  `src/generated` folders; avoid hand edits.

### Mobile App Identity
- Android package name for the mobile app (current branded build): `com.finalapp.vibe2`.

### Mobile Build/Debug Policy
- Use `preview` builds by default for Android development.
- Use local builds only: `cd apps/mobile && pnpm exec eas build --local --profile preview --platform android`.
- Use OTA for JS/assets only: `cd apps/mobile && pnpm exec eas update --channel preview --message "..."`
- Do not rely on Metro/dev-client for the normal mobile workflow.

## Build, Test, and Development Commands
- `pnpm install` (root) installs workspace deps.
- `pnpm exec turbo lint` runs fmt + lint + typecheck across packages and root
  checks (syncpack/jscpd).
- `pnpm exec turbo lint:check` is the CI-safe version (no auto-fix).
- `pnpm exec turbo fmt` / `pnpm exec turbo fmt:check` runs Prettier.
- `pnpm exec turbo test` runs package tests (includes mobile e2e).
- Mobile (preview default): `cd apps/mobile && pnpm exec eas build --local --profile preview --platform android`.
- Mobile OTA (preview): `cd apps/mobile && pnpm exec eas update --channel preview --message "..."`
- Web: `cd apps/web && pnpm run dev` for local site.
- Optional dev shells: `nix develop .#default` (or `.#android-emulator`).
- Docker: `just docker-build`.
- Preview builds + updates (EAS): see `docs/dev-builds.md`.

## Wireless ADB (Android Development)
adb connect 100.113.210.6:5555

## Coding Style & Naming Conventions
- Formatting is Prettier-based (`prettier.config.mjs` / per-package configs).
  Default style is tabs (width 2), single quotes, 80-char lines, semicolons on.
- ESLint configs are per-package; fix issues before committing.
- TypeScript/React naming: PascalCase components, camelCase functions/vars.
  Keep folders in kebab-case (see `packages/react-native-*`).

## Testing Guidelines
- Jest is configured for `@fressh/react-native-uniffi-russh`:
  `pnpm --filter @fressh/react-native-uniffi-russh test`.
- Mobile e2e uses Maestro in `apps/mobile/test/e2e/*.yml`:
  `pnpm --filter @fressh/mobile test:e2e` or `pnpm exec turbo test`.
- Rust unit tests live under `packages/react-native-uniffi-russh/rust/uniffi-russh`
  and run via `just test` or `cargo test`.
- No repo-wide test naming convention is enforced; prefer `*.test.ts` or `__tests__`
  for Jest when adding new tests.

## Commit & Pull Request Guidelines
- Commit history favors short, imperative subjects (e.g., "Fix ...", "Add ...").
  Release commits often use `chore(scope): release vX.Y.Z`.
- Keep commits scoped to a package when possible (monorepo-friendly diffs).
- PRs should describe the change, include testing notes, and ensure
  lint/typecheck/tests pass (CI uses `.github/workflows/check.yml`).
  Add screenshots for UI changes (mobile/web) and link relevant issues.
