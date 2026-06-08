# Mobile Shell Async Request Invalidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish issue 84 with a narrow standardization pass for mobile shell async request invalidation.

**Architecture:** Keep the existing `useRequestId()` hook and Workmux keyboard generation runner. Add explicit status-cycle stale coverage, document the lifecycle contract at the shared request primitive, and avoid broad migration of unrelated async flows.

**Tech Stack:** Expo React Native mobile app, TypeScript, Node `tsx --test`, pnpm workspace filters.

---

## File Structure

- Modify `apps/mobile/test/integration/keyboard-actions.test.ts`
  - Owns integration coverage for keyboard action dispatch and the Workmux keyboard command runner.
  - Add an explicit status-cycle stale invalidation test near the existing Workmux runner invalidation test.
- Modify `apps/mobile/src/lib/request-id.ts`
  - Owns the shared request-id hook used by shell modal/controller workflows.
  - Add a concise lifecycle contract comment directly above `RequestIdHandle`.
- Reference `docs/superpowers/specs/2026-06-08-mobile-shell-async-invalidation-design.md`
  - Confirms scope and issue-84 acceptance mapping.

## Task 1: Add Explicit Status-Cycle Stale Coverage

**Files:**
- Modify: `apps/mobile/test/integration/keyboard-actions.test.ts`
- Test: `apps/mobile/test/integration/keyboard-actions.test.ts`

- [ ] **Step 1: Insert the status-cycle stale invalidation test**

Add this test immediately after the existing test named `Workmux keyboard command runner invalidates pending commands and stale failures`:

```ts
void test('Workmux status cycle suppresses stale failures after invalidation', async () => {
	const commandBlock = deferred<void>();
	const calls: string[] = [];
	const failures: string[] = [];
	const runner = createWorkmuxKeyboardCommandRunner({
		isTmuxEnabled: () => true,
		getSessionName: () => 'main',
		runWorkmuxCommand: async (argv) => {
			calls.push(argv.join(' '));
			await commandBlock.promise;
			throw new Error('mdev: command not found');
		},
		showFailure: (message) => failures.push(message),
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	const result = runner.run({ type: 'status-cycle' });
	await Promise.resolve();
	runner.invalidate();
	commandBlock.resolve(undefined);

	assert.deepEqual(await result, { status: 'superseded' });
	assert.deepEqual(calls, ['tmux nav cycle main:']);
	assert.deepEqual(failures, []);
});
```

- [ ] **Step 2: Run the narrow keyboard test**

Run:

```sh
pnpm --filter @fressh/mobile exec tsx --test test/integration/keyboard-actions.test.ts
```

Expected: PASS. This is characterization coverage for behavior the runner should already have; if it fails, the failure should identify a mismatch in status-cycle argv construction or stale failure suppression.

- [ ] **Step 3: Fix only if the new test fails**

If the failure shows stale status-cycle errors are still reported, modify the `execute` catch block in `apps/mobile/src/lib/keyboard-actions.ts` so stale generations return `superseded` without calling `showFailure`:

```ts
		} catch (error) {
			if (commandGeneration === generation) {
				showFailure(
					formatWorkmuxKeyboardCommandFailureMessage({
						errorMessage: getErrorMessage(error),
					}) || WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
				);
				return { status: 'handled' };
			}
			return { status: 'superseded' };
		}
```

If the failure shows the expected command string is wrong, update only the assertion in the new test to match the actual `buildWorkmuxStatusCycleArgv('main')` output from `apps/mobile/src/lib/workmux-app-commands.ts`.

- [ ] **Step 4: Run the keyboard test again**

Run:

```sh
pnpm --filter @fressh/mobile exec tsx --test test/integration/keyboard-actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the status-cycle coverage**

Run:

```sh
git add apps/mobile/test/integration/keyboard-actions.test.ts apps/mobile/src/lib/keyboard-actions.ts
git commit -m "test: cover stale Workmux status cycle invalidation"
```

Expected: commit succeeds. If `apps/mobile/src/lib/keyboard-actions.ts` was not changed, `git add` will leave it unstaged and the commit should include only the test file.

## Task 2: Document the Shared Request Lifecycle Contract

**Files:**
- Modify: `apps/mobile/src/lib/request-id.ts`
- Test: `apps/mobile/test/integration/focused-active-request.test.ts`

- [ ] **Step 1: Add the lifecycle contract comment**

Replace the top of `apps/mobile/src/lib/request-id.ts` with this content:

```ts
import { useCallback, useMemo, useRef } from 'react';

/**
 * Shared request lifecycle primitive for mobile shell controllers.
 *
 * Call `next()` when async work starts, guard each awaited continuation with
 * `isCurrent(id)`, and call `invalidate()` on blur, AppState inactive,
 * source/target change, modal close, or unmount before clearing visible state.
 * A stale completion may finish its promise, but must not mutate UI, show
 * alerts, clear newer in-flight state, or send follow-up shell commands.
 */
export type RequestIdHandle = {
	next: () => number;
	isCurrent: (id: number) => boolean;
	invalidate: () => void;
};

export function useRequestId(): RequestIdHandle {
	const ref = useRef(0);
	const next = useCallback(() => {
		ref.current += 1;
		return ref.current;
	}, []);
	const isCurrent = useCallback((id: number) => id === ref.current, []);
	const invalidate = useCallback(() => {
		ref.current += 1;
	}, []);
	return useMemo(
		() => ({ next, isCurrent, invalidate }),
		[next, isCurrent, invalidate],
	);
}
```

- [ ] **Step 2: Run the nearest lifecycle helper test**

Run:

```sh
pnpm --filter @fressh/mobile exec tsx --test test/integration/focused-active-request.test.ts
```

Expected: PASS. This confirms nearby lifecycle helper tests still run after the request-id documentation change.

- [ ] **Step 3: Commit the lifecycle contract documentation**

Run:

```sh
git add apps/mobile/src/lib/request-id.ts
git commit -m "docs: document mobile shell request lifecycle"
```

Expected: commit succeeds with only `apps/mobile/src/lib/request-id.ts` changed.

## Task 3: Verify Issue-84 Focused Coverage

**Files:**
- Reference: `docs/superpowers/specs/2026-06-08-mobile-shell-async-invalidation-design.md`
- Test: `apps/mobile/test/integration/shell-modals.test.ts`
- Test: `apps/mobile/test/integration/detected-open-actions.test.ts`
- Test: `apps/mobile/test/integration/keyboard-actions.test.ts`
- Test: `apps/mobile/test/integration/focused-active-request.test.ts`

- [ ] **Step 1: Run the focused issue-84 verification command**

Run:

```sh
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/shell-modals.test.ts \
  test/integration/detected-open-actions.test.ts \
  test/integration/keyboard-actions.test.ts \
  test/integration/focused-active-request.test.ts
```

Expected: PASS.

- [ ] **Step 2: Inspect the final diff**

Run:

```sh
git status --short
git log --oneline -4
```

Expected: `git status --short` prints no output. `git log --oneline -4` includes commit subjects ending with `docs: document mobile shell request lifecycle`, `test: cover stale Workmux status cycle invalidation`, `docs: plan mobile shell async invalidation`, and `docs: design mobile shell async invalidation`.

- [ ] **Step 3: Confirm issue-84 acceptance mapping**

Use this checklist against `docs/superpowers/specs/2026-06-08-mobile-shell-async-invalidation-design.md`:

```text
[x] Browser/Diffity stale completion coverage exists in shell-modals tests.
[x] Detected-open stale request coverage exists in detected-open-actions tests.
[x] Workmux keyboard stale invalidation coverage exists in keyboard-actions tests.
[x] Workmux status-cycle stale invalidation coverage exists in keyboard-actions tests.
[x] Shared request lifecycle convention is documented at useRequestId().
[x] No xterm/WebView reload work was added.
[x] No broad Wispr, scrollback, agent notification, or feature-request migration was added.
```

- [ ] **Step 4: Leave the workspace clean**

Run:

```sh
git status --short
```

Expected: no output.

## Self-Review Notes

- Spec coverage: Task 1 covers explicit status-cycle stale coverage; Task 2 covers the documented lifecycle convention; Task 3 covers focused verification and non-goal boundaries.
- Placeholder scan: no reserved markers or unspecified implementation steps remain.
- Type consistency: the plan uses existing `RequestIdHandle`, `createWorkmuxKeyboardCommandRunner`, `invalidate()`, and `status-cycle` names exactly as they exist in the codebase.
