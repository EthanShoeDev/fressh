# Keyboard Configurator Workflow

This doc explains how the keyboard configurator in `~/react-ttyd` saves layouts
and generates code for the Fressh mobile app in this repo. The goal is to make
keyboard changes while working from `/home/muly/fressh`.

## Source of Truth

- Editor and layouts live in `/home/muly/react-ttyd`.
- Generated output lives in `apps/mobile/src/generated`.
- Do not hand edit generated files; always regenerate from `react-ttyd`.

## Quick Start (from this repo)

1) Start the configurator app (Next.js):
```
cd /home/muly/react-ttyd
pnpm install
pnpm dev
```

2) Open the configurator UI:
- `http://localhost:3000/keyboard-configurator`
- Settings: `http://localhost:3000/keyboard-configurator/settings`

3) Edit a layout and save:
- Layouts are stored as JSON in
  `/home/muly/react-ttyd/example/nextjs/data/keyboards/*.json`.
- Use the UI save action, or edit the JSON directly.

4) Generate code into this repo:
- In the UI, click "Generate Code", or call:
```
curl -X POST http://localhost:3000/api/keyboards/generate
```
- Output path defaults to `/home/muly/fressh/apps/mobile/src/generated`.
- Override with `KEYBOARD_CODEGEN_DIR` if needed.

5) Publish a preview update so the app picks up regenerated files:
```
cd /home/muly/fressh/apps/mobile
pnpm exec eas update --channel preview --message "Update keyboard layouts"
```
- Reopen the app to apply the update (preview flow, no Metro required).

## What To Edit (react-ttyd)

- Defaults + catalog: `example/nextjs/app/keyboard-configurator/configurator-context.tsx`
- Editor UI: `example/nextjs/app/keyboard-configurator/page.tsx`
- Settings UI: `example/nextjs/app/keyboard-configurator/settings/page.tsx`
- Runtime execution: `example/nextjs/lib/keyboard-runtime.ts`
- Codegen: `example/nextjs/app/api/keyboards/generate/route.ts`

## Actions and Special Keys

- Special key catalog and escape sequences must stay in sync:
  - Catalog: `configurator-context.tsx`
  - Codegen: `generate/route.ts` (SPECIAL_SEQUENCES)
- Action IDs must exist in both:
  - `example/nextjs/lib/keyboard-runtime.ts`
  - `apps/mobile/src/lib/keyboard-actions.ts`

## Rules and Pitfalls

- Grid must remain 4 rows x 10 columns.
- Macros referenced in the grid must exist in that keyboard’s macro list.
- Don’t edit `apps/mobile/src/generated/*` directly.
- If you add a new special key or action, wire it in both repos.

## Related Files in This Repo

- `apps/mobile/src/lib/keyboard-actions.ts` (action handling)
- `apps/mobile/src/generated/*` (generated layouts + metadata)
