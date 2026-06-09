# Mobile Shell Async Request Invalidation Design

## Context

Issue 84 asks for a shared mobile shell pattern that prevents stale async
completions from mutating UI or sending commands after a lifecycle boundary has
ended.

The current code already has most of the requested behavior:

- `useRequestId()` provides a small generation/request-id primitive.
- Browser action cleanup invalidates grouped browser requests and clears
  in-flight flags.
- Diffity and detected-open requests guard awaited continuations with current
  request checks.
- Workmux keyboard actions use a generation-based runner with explicit
  `invalidate()`.
- Shell blur, AppState inactive, source changes, and unmount paths already call
  invalidation hooks for browser actions, keyboard commands, reload requests,
  notification acknowledgements, and scrollback-related work.

The remaining gap is standardization. A future workflow should not need to
reverse-engineer several files to understand which lifecycle primitive to copy
or where stale guards must be placed.

## Scope

Finish issue 84 with a narrow standardization pass:

- Clarify the request lifecycle convention for mobile shell workflows.
- Keep the existing `useRequestId()` and generation-runner primitives.
- Avoid a broad refactor of unrelated async flows.
- Add an explicit status-cycle stale invalidation test.
- Keep xterm/WebView reload handling out of scope, as issue 84 excludes it.

## Lifecycle Convention

Mobile shell async workflows should follow this contract:

1. Starting async work obtains a token through `next()` or captures the current
   generation.
2. Every awaited continuation that can update UI, show an alert, clear in-flight
   state, or send a follow-up command checks that the token is still current.
3. Lifecycle boundaries call `invalidate()` or increment the generation before
   clearing visible state.
4. Cleanup boundaries include blur, AppState inactive, source or target change,
   modal close, and component unmount.
5. A stale completion may finish its promise, but it must not mutate UI, show
   errors, clear newer in-flight state, or execute follow-up shell commands.

`useRequestId()` remains the preferred React hook for modal/controller request
ids. Generation-based runners remain acceptable for serialized command queues
where a queued command can be superseded by a newer one.

## Implementation Shape

The finish pass should be small:

- Add concise documentation to the shared request-id helper or a nearby mobile
  shell lifecycle helper so the contract is visible at the primitive.
- Review browser action, Diffity, detected-open, and Workmux keyboard/status
  code for naming consistency around `invalidate`, `isCurrent`, and in-flight
  cleanup.
- Add a dedicated status-cycle stale invalidation test in the Workmux keyboard
  runner tests. This test should prove that a pending status-cycle command
  resolves as superseded and does not report a stale failure after invalidation.
- Avoid migrating Wispr automation, scrollback cleanup, agent notifications, or
  feature-request flows unless a direct inconsistency blocks the issue-84
  acceptance criteria.

## Tests

Focused test coverage should include:

- Existing Diffity stale completion tests remain passing.
- Existing detected-open stale request tests remain passing.
- Existing Workmux keyboard invalidation tests remain passing.
- New explicit status-cycle stale invalidation test passes.

Recommended verification command:

```sh
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/shell-modals.test.ts \
  test/integration/detected-open-actions.test.ts \
  test/integration/keyboard-actions.test.ts \
  test/integration/focused-active-request.test.ts
```

## Non-Goals

- Do not introduce a heavy state-management library.
- Do not replace every generation counter in the mobile app.
- Do not merge this with xterm/WebView reload controller work.
- Do not rewrite Workmux scrollback or Wispr automation lifecycle handling as
  part of this issue.

## Acceptance Criteria Mapping

- Stale async completions are suppressed after lifecycle cleanup through
  request-id and generation checks.
- Controllers expose explicit invalidation through `invalidate()` or grouped
  cleanup functions.
- Browser/Diffity and keyboard coverage already exists; the finish pass adds
  explicit status-cycle stale coverage.
- New workflows have a documented local convention to copy instead of inventing
  another ref protocol.
