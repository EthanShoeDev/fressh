# Review Rubric

Use only the angles relevant to the target. Prefer deep evidence over many shallow categories.

## Core Correctness

- Does the implementation match the requested behavior and surrounding code patterns?
- Are edge cases, nulls, empty states, time zones, concurrency, retries, and errors handled?
- Could the change regress existing behavior outside the immediate happy path?
- Are assumptions backed by code, tests, docs, or runtime evidence?

## Security and Privacy

- Are auth, authorization, tenancy, permissions, and ownership checks preserved?
- Is user input validated before storage, rendering, queries, shell calls, or external API calls?
- Are secrets, tokens, cookies, keys, credentials, or private data exposed in logs, prompts, client bundles, tests, or errors?
- Are new public endpoints, webhooks, downloads, uploads, redirects, or callbacks protected?

## Data Integrity

- Are migrations reversible or safely deployable for the repo's database workflow?
- Do writes preserve invariants, constraints, idempotency, and transaction boundaries?
- Do backfills and transformations handle partial failure and re-runs?
- Are destructive changes guarded by verification and rollback paths?

## API and Contract Compatibility

- Did exported types, route behavior, serialized fields, event names, CLI flags, or response shapes change?
- Are old callers, feature flags, generated clients, docs, and tests updated?
- Are validation errors and status codes consistent with existing contracts?

## Performance and Scalability

- Did the change add expensive loops, repeated queries, N+1 calls, large payloads, blocking I/O, or unnecessary rendering?
- Are cache keys, invalidation, batching, pagination, and streaming behavior still correct?
- Does the code avoid doing heavy work on hot paths or per-render paths?

## Maintainability and Simplicity

- Is the diff smaller or clearer than the problem requires?
- Are there needless wrappers, speculative abstractions, duplicate branches, pass-through helpers, or dead code?
- Are names specific and local patterns followed?
- Is responsibility placed in the right layer or module?

## Tests and Verification

- Do tests cover the changed behavior and likely regressions?
- Are assertions meaningful, or only checking that code runs?
- Are tests deterministic and scoped to public behavior instead of implementation details?
- Are relevant lint, type, build, unit, integration, UI, or migration checks identified?

## UI and Framework Changes

- Does the UI fit existing interaction patterns, accessibility, responsive layout, loading states, and error states?
- Are client/server boundaries, hydration, caching, routing, and data fetching consistent with the framework?
- For React/Next changes, check unnecessary client components, unstable effects, over-fetching, and bundle impact.

## AI-Slop Signals

Run this pass when the code looks generated, overbuilt, or cleanup was requested:

- Duplicate logic that should be a helper or should be deleted.
- Single-use abstraction layers that hide simple code.
- Unused exports, dead branches, broad types, stub comments, or debug leftovers.
- Defensive code for states that cannot happen.
- Tests that mirror implementation without protecting behavior.

Prefer deletion and simplification, but preserve behavior unless the user explicitly asked for behavior changes.

## Documentation

- Update docs only when behavior, setup, operational workflow, public API, or developer ergonomics changed.
- Do not demand docs for tiny internal changes unless future maintainers would reasonably need them.
