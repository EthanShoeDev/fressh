# Future project: replace the Astro marketing site with TanStack Start

**Status:** NOT STARTED — decided in principle (2026-06-08). The current `apps/web`
is a tiny static Astro site; we want to rebuild it as a TanStack Start (React +
Vite + TanStack Router) app so the web surface is React/TSX like the rest of the
stack and stops being a one-off paradigm.

**Scope:** `apps/web` only — its pages, layout, styles, build, and Vercel
deployment. Nothing in `apps/mobile`, the renderer, SSH, or terminal is touched.
`@fressh/assets` (the shared image/badge package the site imports from) stays as-is.

**Reference:** TanStack Start docs — <https://tanstack.com/start>. No clone exists
under `docs/cloned-repos-as-docs/` yet; clone `tanstack/router` (Start lives in that
repo) there if a deep reference is needed.

## Why replace Astro

The Astro app is small and works, so this is about coherence, not firefighting:

- **One language/paradigm across the repo.** Everything else we write is React +
  TypeScript (the mobile app is React Native). Astro's `.astro` component format is
  a separate mental model and toolchain that nobody else in the repo uses. Moving
  to React/TSX means shared idioms, shared mental model, and the *option* to share
  small presentational components or constants with the mobile app later.
- **It unblocks real linting.** Our oxlint config (react / react-perf / jsx-a11y /
  typescript, plus knip) applies fully and natively to `.tsx` — including
  `no-unused-vars` and `consistent-type-imports`, which oxlint **silently skips on
  `.astro`** because it can't see the template. Today the Astro app is a coverage
  blind spot we've decided not to paper over (see
  [improve-linting.md](improve-linting.md)). TanStack Start removes the blind spot
  instead of working around it.
- **Room to grow into dynamic.** Astro is excellent for zero-JS static output but
  pivots awkwardly the moment you want server logic. TanStack Start has first-class
  server functions / SSR, so future needs (a contact form, download/stars counts, a
  changelog feed, gated docs) are a natural extension rather than a re-platform.
- **Ecosystem alignment.** TanStack Router/Query (and Effect, which mobile already
  uses) are the direction the codebase is already leaning.

The honest counter-argument is below under Risks — for a static landing page Astro's
zero-JS output is a genuine strength we're trading away.

## What the current app actually is (migration surface)

Deliberately tiny — this is a half-day port, not a rewrite:

- `src/pages/index.astro` — the landing page: app icon, "coming soon" badge,
  headline/copy, store badges (App Store / Google Play), GitHub + npm links, two
  Android screenshots. All images imported from `@fressh/assets`. Sets OG/Twitter
  meta via a `head` slot.
- `src/pages/privacy.astro` — a static privacy page.
- `src/layouts/layout.astro` — the HTML shell: `<head>` (favicon, viewport, title,
  injected per-page head), `global.css` import, and `@vercel/analytics/astro`.
- `src/styles/global.css` — Tailwind v4, pulled in via `@tailwindcss/vite`.
- Deploys to **Vercel** via the `@astrojs/vercel` adapter.

## Target shape in TanStack Start

- **Routes** (file-based, TanStack Router): `routes/__root.tsx` replaces
  `layout.astro` (the `<html>`/`<head>`/`<body>` shell + global.css import +
  Vercel Analytics via `@vercel/analytics/react`). `routes/index.tsx` and
  `routes/privacy.tsx` replace the two pages.
- **`<head>` / SEO meta** via each route's `head`/`meta` route options (TanStack
  Router's `head` management) — port the OG/Twitter tags from `index.astro` there.
- **Styles unchanged.** Tailwind v4 via `@tailwindcss/vite` works the same in
  Start's Vite config — `global.css` ports over verbatim.
- **Assets unchanged.** `@fressh/assets` imports are resolved by Vite exactly as
  Astro did; `import icon from '@fressh/assets/…'` keeps working.
- **Rendering: prerender these routes to static.** The site is fully static, so
  use Start's prerendering/SSG so we keep static-host performance and don't pay for
  SSR we don't need. (Revisit if/when a route needs a server function.)
- **Deploy: Vercel.** Use Start's Vercel target/preset in place of
  `@astrojs/vercel`. Keep the same Vercel project.
- **Naming.** Keep the directory `apps/web` and package `@fressh/web` to avoid
  workspace churn. Note there's a **stale `apps/start/src/seo/cookie-trackers/**/*.js`
  entry in `oxlint.config.ts` `ignorePatterns`** — a leftover from an earlier
  direction; delete it (or repurpose) as part of this work rather than naming the
  new app `apps/start` to match a dead reference.

## Risks & tradeoffs

- **We give up Astro's zero-JS output.** A static Astro page ships ~no client JS;
  a TanStack Start page hydrates a React runtime. For a one-screen marketing site
  this is an acceptable, small cost — but it *is* a regression in shipped bytes.
  Mitigate: prerender to static HTML, and keep client interactivity to zero (the
  current pages have none), so hydration is minimal. If we truly want zero-JS, that
  argues for *keeping* Astro — so this tradeoff should be a conscious yes.
- **SEO/meta parity.** The OG/Twitter/description tags must come through Start's
  head management with identical output; verify the rendered `<head>` matches the
  current site before cutover (it's a public landing page — meta regressions hurt).
- **Vercel deploy parity.** Confirm Start's Vercel target produces an equivalent
  deploy (build output, analytics, redirects) before deleting the Astro app.
- **Dependency churn.** Drops `astro`, `@astrojs/vercel`, `@vercel/analytics/astro`,
  `sharp` (Astro's image pipeline); adds `@tanstack/react-start`,
  `@tanstack/react-router`, `react`/`react-dom`. Net roughly even; update the
  catalog and run knip after.

## Phasing

- **v0:** scaffold TanStack Start in a fresh `apps/web` (or alongside, then swap),
  port `global.css` + `@fressh/assets` wiring, get a blank prerendered route
  deploying to a Vercel preview.
- **v1:** port `index.tsx` (incl. OG/Twitter meta) and `privacy.tsx` to pixel-parity
  with the Astro pages; wire Vercel Analytics.
- **v2:** verify rendered `<head>`/SEO parity and Vercel deploy parity, cut the
  production domain over, delete the Astro app + `@astrojs/*` deps, remove the stale
  `apps/start` oxlint ignore entry, run knip.

## How this relates to the other future docs

- **[improve-linting.md](improve-linting.md):** the direct motivator for the
  *linting* angle. That doc records the decision **not** to set up Astro linting (the
  `.astro` frontmatter/script extraction works but the template is a blind spot, and
  `no-unused-vars`/`consistent-type-imports` are skipped). This project makes that
  decision moot by removing Astro — once `apps/web` is `.tsx`, the full oxlint React
  stack and knip cover it natively.
- Independent of the terminal/SSH/renderer projects
  ([terminal-semantic-events.md](../complete/terminal-semantic-events.md),
  [git-diff-integration.md](git-diff-integration.md),
  [ai-integration.md](ai-integration.md)) and the mobile theme work
  ([native-ui-theme-or-themes.md](native-ui-theme-or-themes.md)). Ships on its own.
