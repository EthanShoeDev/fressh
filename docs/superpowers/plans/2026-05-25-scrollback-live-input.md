# Scrollback Live Input Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every user-originated terminal input path exit tmux scrollback mode in one ordered operation before sending user payload bytes.

**Architecture:** Extract the scrollback input sequencing decision into a pure helper in `apps/mobile/src/lib/tmux-scrollback.ts`, then route shell UI sends through one `sendLiveInputSegments` callback in `apps/mobile/src/app/shell/detail.tsx`. Extract small terminal payload builders for Text paste, clipboard paste, and commander execution so tests can prove which actions append Enter without rendering the shell screen.

**Tech Stack:** Expo React Native, TypeScript, Node `node:test`, pnpm workspace scripts.

---

## File Structure

- Modify: `apps/mobile/src/lib/tmux-scrollback.ts`
  - Owns tmux scrollback policy and the pure send-plan helper.
- Modify: `apps/mobile/test/integration/tmux-scrollback.test.ts`
  - Verifies scrollback send-plan behavior independently from React state.
- Create: `apps/mobile/src/lib/terminal-input-payloads.ts`
  - Owns small byte-segment builders for user input actions that need semantic tests.
- Create: `apps/mobile/test/integration/terminal-input-payloads.test.ts`
  - Verifies Text paste appends Enter and clipboard paste does not.
- Modify: `apps/mobile/src/app/shell/detail.tsx`
  - Wires all user-originated shell input through the shared live-input helper.

## Scope Check

The approved spec covers one subsystem: user input routing while tmux scrollback is active. It does not require changes to touch-scroll gesture recognition, tmux copy-mode commands, Wispr automation, or UI layout. This is one implementation plan.

### Task 1: Add Pure Scrollback Send Planning

**Files:**
- Modify: `apps/mobile/src/lib/tmux-scrollback.ts`
- Modify: `apps/mobile/test/integration/tmux-scrollback.test.ts`

- [ ] **Step 1: Write failing tests for the send-plan helper**

Append these tests to `apps/mobile/test/integration/tmux-scrollback.test.ts`, and update the import list to include `buildTmuxScrollbackLiveInputSendPlan` and `isValidTmuxCancelKey`.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildTmuxScrollbackCopyModeCommand,
	buildTmuxScrollbackLiveInputSendPlan,
	buildTmuxSelectWindowCommand,
	getTmuxScrollbackControlFailurePolicy,
	getTmuxScrollbackLiveInputPolicy,
	isValidTmuxCancelKey,
} from '../../src/lib/tmux-scrollback';

const bytes = (values: number[]) => new Uint8Array(values);
const segmentValues = (segments: ReadonlyArray<Uint8Array<ArrayBuffer>>) =>
	segments.map((segment) => Array.from(segment));
```

```ts
void test('tmux cancel key validation accepts single non-escape keys only', () => {
	assert.equal(isValidTmuxCancelKey(bytes([0x71])), true);
	assert.equal(isValidTmuxCancelKey(bytes([0x1b])), false);
	assert.equal(isValidTmuxCancelKey(bytes([])), false);
	assert.equal(isValidTmuxCancelKey(bytes([0x71, 0x0d])), false);
});

void test('live input plan passes payload through when scrollback is inactive', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: false,
		cancelKey: bytes([0x71]),
		payloadSegments: [bytes([0x61, 0x62])],
		interSegmentDelayMs: 7,
		scrollbackExitDelayMs: 10,
	});

	assert.deepEqual(plan, {
		type: 'send',
		segments: [bytes([0x61, 0x62])],
		interSegmentDelayMs: 7,
		clearScrollback: false,
	});
});

void test('live input plan exits active scrollback before payload', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		cancelKey: bytes([0x71]),
		payloadSegments: [bytes([0x61, 0x62])],
		interSegmentDelayMs: 0,
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.equal(plan.interSegmentDelayMs, 10);
	assert.equal(plan.clearScrollback, true);
	assert.deepEqual(segmentValues(plan.segments), [[0x71], [0x61, 0x62]]);
});

void test('live input plan preserves multi-segment payload order after scrollback exit', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		cancelKey: bytes([0x71]),
		payloadSegments: [bytes([0x68, 0x69]), bytes([0x0d])],
		interSegmentDelayMs: 3,
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.equal(plan.interSegmentDelayMs, 10);
	assert.equal(plan.clearScrollback, true);
	assert.deepEqual(segmentValues(plan.segments), [[0x71], [0x68, 0x69], [0x0d]]);
});

void test('live input plan blocks active scrollback when cancel key is invalid', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		cancelKey: bytes([0x1b]),
		payloadSegments: [bytes([0x61])],
		scrollbackExitDelayMs: 10,
	});

	assert.deepEqual(plan, {
		type: 'block',
		reason: 'invalid-cancel-key',
	});
});

void test('live input plan can treat the payload as only a scrollback exit key', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		cancelKey: bytes([0x71]),
		payloadSegments: [bytes([0x71])],
		dropPayloadAfterExit: true,
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.equal(plan.clearScrollback, true);
	assert.deepEqual(segmentValues(plan.segments), [[0x71]]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/tmux-scrollback.test.ts
```

Expected: FAIL with TypeScript errors that `buildTmuxScrollbackLiveInputSendPlan` and `isValidTmuxCancelKey` are not exported by `../../src/lib/tmux-scrollback`.

- [ ] **Step 3: Implement the pure helper**

Add this code to `apps/mobile/src/lib/tmux-scrollback.ts` after `getTmuxScrollbackControlFailurePolicy`.

```ts
export type TmuxScrollbackLiveInputSendPlan =
	| {
			type: 'send';
			segments: Uint8Array<ArrayBuffer>[];
			interSegmentDelayMs?: number;
			clearScrollback: boolean;
	  }
	| {
			type: 'block';
			reason: 'invalid-cancel-key';
	  };

export function isValidTmuxCancelKey(
	cancelKey: Uint8Array<ArrayBuffer>,
): boolean {
	return cancelKey.length === 1 && cancelKey[0] !== 0x1b;
}

export function buildTmuxScrollbackLiveInputSendPlan({
	scrollbackActive,
	cancelKey,
	payloadSegments,
	interSegmentDelayMs,
	scrollbackExitDelayMs,
	dropPayloadAfterExit = false,
}: {
	scrollbackActive: boolean;
	cancelKey: Uint8Array<ArrayBuffer>;
	payloadSegments: Uint8Array<ArrayBuffer>[];
	interSegmentDelayMs?: number;
	scrollbackExitDelayMs: number;
	dropPayloadAfterExit?: boolean;
}): TmuxScrollbackLiveInputSendPlan {
	const nonEmptyPayloadSegments = payloadSegments.filter(
		(segment) => segment.length > 0,
	);

	if (!scrollbackActive) {
		return {
			type: 'send',
			segments: nonEmptyPayloadSegments,
			interSegmentDelayMs,
			clearScrollback: false,
		};
	}

	if (!isValidTmuxCancelKey(cancelKey)) {
		return {
			type: 'block',
			reason: 'invalid-cancel-key',
		};
	}

	return {
		type: 'send',
		segments: dropPayloadAfterExit
			? [cancelKey]
			: [cancelKey, ...nonEmptyPayloadSegments],
		interSegmentDelayMs: scrollbackExitDelayMs,
		clearScrollback: true,
	};
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/tmux-scrollback.test.ts
```

Expected: PASS for all tests in `tmux-scrollback.test.ts`.

- [ ] **Step 5: Commit Task 1**

```bash
git add apps/mobile/src/lib/tmux-scrollback.ts apps/mobile/test/integration/tmux-scrollback.test.ts
git commit -m "Add tmux scrollback live input planner"
```

### Task 2: Add Tested Payload Builders

**Files:**
- Create: `apps/mobile/src/lib/terminal-input-payloads.ts`
- Create: `apps/mobile/test/integration/terminal-input-payloads.test.ts`

- [ ] **Step 1: Write failing tests for terminal payload semantics**

Create `apps/mobile/test/integration/terminal-input-payloads.test.ts`.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildClipboardPasteSegments,
	buildCommanderExecuteSegments,
	buildTextEntryPasteSegments,
} from '../../src/lib/terminal-input-payloads';

const decoder = new TextDecoder();
const decodeSegments = (segments: Uint8Array[]) =>
	segments.map((segment) => decoder.decode(segment));

void test('text entry paste appends Enter', () => {
	assert.deepEqual(decodeSegments(buildTextEntryPasteSegments('echo hi')), [
		'echo hi',
		'\r',
	]);
});

void test('text entry paste returns no payload for empty text', () => {
	assert.deepEqual(buildTextEntryPasteSegments(''), []);
});

void test('clipboard paste does not append Enter', () => {
	assert.deepEqual(decodeSegments(buildClipboardPasteSegments('echo hi')), [
		'echo hi',
	]);
});

void test('clipboard paste returns no payload for empty text', () => {
	assert.deepEqual(buildClipboardPasteSegments(''), []);
});

void test('commander execute appends Enter', () => {
	assert.deepEqual(decodeSegments(buildCommanderExecuteSegments('pwd')), [
		'pwd',
		'\r',
	]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/terminal-input-payloads.test.ts
```

Expected: FAIL with a module resolution error for `../../src/lib/terminal-input-payloads`.

- [ ] **Step 3: Implement payload builders**

Create `apps/mobile/src/lib/terminal-input-payloads.ts`.

```ts
const encoder = new TextEncoder();

export function buildTextEntryPasteSegments(
	value: string,
): Uint8Array<ArrayBuffer>[] {
	if (!value) return [];
	return [encoder.encode(value), encoder.encode('\r')];
}

export function buildClipboardPasteSegments(
	value: string,
): Uint8Array<ArrayBuffer>[] {
	if (!value) return [];
	return [encoder.encode(value)];
}

export function buildCommanderExecuteSegments(
	value: string,
): Uint8Array<ArrayBuffer>[] {
	if (!value.trim()) return [];
	return [encoder.encode(value), encoder.encode('\r')];
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/terminal-input-payloads.test.ts
```

Expected: PASS for all tests in `terminal-input-payloads.test.ts`.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/mobile/src/lib/terminal-input-payloads.ts apps/mobile/test/integration/terminal-input-payloads.test.ts
git commit -m "Add terminal input payload builders"
```

### Task 3: Route Shell UI Input Through One Live-Input Helper

**Files:**
- Modify: `apps/mobile/src/app/shell/detail.tsx`

- [ ] **Step 1: Update imports**

In `apps/mobile/src/app/shell/detail.tsx`, extend the existing tmux scrollback import and add the payload builder import.

```ts
import {
	buildTmuxScrollbackCopyModeCommand,
	buildTmuxScrollbackLiveInputSendPlan,
	buildTmuxSelectWindowCommand,
	getTmuxScrollbackControlFailurePolicy,
	isValidTmuxCancelKey,
	runTmuxControlCommand,
} from '@/lib/tmux-scrollback';
import {
	buildClipboardPasteSegments,
	buildCommanderExecuteSegments,
	buildTextEntryPasteSegments,
} from '@/lib/terminal-input-payloads';
```

Remove `getTmuxScrollbackLiveInputPolicy` from the tmux scrollback import.

- [ ] **Step 2: Remove local helper code that becomes redundant**

Delete the local `isValidCancelKey`, `concatBytes`, `containsMarker`, and `isLargePayload` definitions from `apps/mobile/src/app/shell/detail.tsx`.

Delete exactly this local cancel-key helper:

```ts
const isValidCancelKey = (cancelKey: Uint8Array) =>
	cancelKey.length === 1 && cancelKey[0] !== 0x1b;
```

Delete the local byte-concatenation and large-payload helpers:

```ts
const concatBytes = (a: Uint8Array, b: Uint8Array) => {
	const merged = new Uint8Array(a.length + b.length);
	merged.set(a, 0);
	merged.set(b, a.length);
	return merged;
};

const containsMarker = (bytes: Uint8Array, marker: number[]) => {
	if (bytes.length < marker.length) return false;
	for (let i = 0; i <= bytes.length - marker.length; i += 1) {
		let matched = true;
		for (let j = 0; j < marker.length; j += 1) {
			if (bytes[i + j] !== marker[j]) {
				matched = false;
				break;
			}
		}
		if (matched) return true;
	}
	return false;
};

const isLargePayload = (bytes: Uint8Array) => {
	if (bytes.length > 32) return true;
	for (let i = 0; i < bytes.length; i += 1) {
		if (bytes[i] === 10 || bytes[i] === 13) return true;
	}
	const pasteStart = [0x1b, 0x5b, 0x32, 0x30, 0x30, 0x7e];
	const pasteEnd = [0x1b, 0x5b, 0x32, 0x30, 0x31, 0x7e];
	return containsMarker(bytes, pasteStart) || containsMarker(bytes, pasteEnd);
};
```

- [ ] **Step 3: Replace direct cancel-key validation call sites**

Replace every `isValidCancelKey(cancelKeyBytes)` call in `apps/mobile/src/app/shell/detail.tsx` with:

```ts
isValidTmuxCancelKey(cancelKeyBytes)
```

This affects the tmux control failure path and Jump to Live path. Both should keep their current behavior: send the cancel key and clear scrollback state.

- [ ] **Step 4: Add the shared live-input segment helper**

Replace the current `sendInputEnsuringLive` callback with this `sendLiveInputSegments` callback after `clearScrollbackState`.

```ts
	const sendLiveInputSegments = useCallback(
		(
			payloadSegments: Uint8Array<ArrayBuffer>[],
			opts?: {
				interSegmentDelayMs?: number;
				dropPayloadAfterExit?: boolean;
			},
		) => {
			const plan = buildTmuxScrollbackLiveInputSendPlan({
				scrollbackActive: scrollbackActiveRef.current,
				cancelKey: cancelKeyBytes,
				payloadSegments,
				interSegmentDelayMs: opts?.interSegmentDelayMs,
				scrollbackExitDelayMs: touchEnterDelayMs,
				dropPayloadAfterExit: opts?.dropPayloadAfterExit ?? false,
			});

			if (plan.type === 'block') {
				logger.warn(
					'cancelKey invalid; blocking input until Jump to live is used',
				);
				return;
			}

			if (plan.clearScrollback) {
				clearScrollbackState();
			}
			if (!plan.segments.length) return;

			void sendBytesQueued(plan.segments, {
				interSegmentDelayMs: plan.interSegmentDelayMs,
			});
		},
		[cancelKeyBytes, clearScrollbackState, sendBytesQueued],
	);
```

- [ ] **Step 5: Route raw byte sends through the shared helper**

Replace the current `sendBytesRaw` callback with this version.

```ts
	const sendBytesRaw = useCallback(
		(bytes: Uint8Array<ArrayBuffer>) => {
			const isScrollbackExitKey =
				bytes.length === exitKeyBytes.length &&
				bytes.length === 1 &&
				bytes[0] === exitKeyBytes[0];
			sendLiveInputSegments([bytes], {
				dropPayloadAfterExit: isScrollbackExitKey,
			});
		},
		[exitKeyBytes, sendLiveInputSegments],
	);
```

Keep `sendTextRaw` as a thin wrapper over `sendBytesRaw`.

```ts
	const sendTextRaw = useCallback(
		(value: string) => {
			sendBytesRaw(encoder.encode(value));
		},
		[sendBytesRaw],
	);
```

- [ ] **Step 6: Route clipboard paste through payload builders**

Replace `handlePasteClipboard` with this version.

```ts
	const handlePasteClipboard = useCallback(async () => {
		try {
			const text = await Clipboard.getStringAsync();
			const segments = buildClipboardPasteSegments(text);
			if (segments.length) {
				sendLiveInputSegments(segments);
			}
			if (selectionModeEnabled) {
				exitSelectionMode();
			}
		} catch (error) {
			logger.warn('clipboard read failed', error);
		}
	}, [exitSelectionMode, selectionModeEnabled, sendLiveInputSegments]);
```

- [ ] **Step 7: Route Text modal paste through payload builders**

Replace `handlePasteTextEntry` with this version.

```ts
	const handlePasteTextEntry = useCallback(
		async (value: string) => {
			const segments = buildTextEntryPasteSegments(value);
			if (!segments.length) return;
			if (selectionModeEnabled) {
				exitSelectionMode();
			}
			sendLiveInputSegments(segments, {
				interSegmentDelayMs: touchEnterDelayMs,
			});
		},
		[exitSelectionMode, selectionModeEnabled, sendLiveInputSegments],
	);
```

The function can remain `async` because `TextEntryModal` accepts a non-awaited callback and existing call sites do not rely on the return value.

- [ ] **Step 8: Route WebView typing input through `sendBytesRaw`**

In `handleWebViewInput`, keep scroll events on the direct ordered path and replace the typing send with `sendBytesRaw(bytes)`.

```ts
			if (input.kind === 'scroll') {
				if (selectionModeEnabled) return;
				void sendBytesOrdered(bytes);
				return;
			}
			if (selectionModeEnabled) exitSelectionMode();
			sendBytesRaw(bytes);
```

Update the dependency array for `handleWebViewInput` to include `sendBytesRaw` instead of `sendInputEnsuringLive`.

```ts
		[
			shell,
			sendBytesOrdered,
			sendBytesRaw,
			selectionModeEnabled,
			exitSelectionMode,
		],
```

- [ ] **Step 9: Route commander Execute through one ordered segment batch**

In the `TerminalCommanderModal` props, replace the current `onExecuteCommand` body with:

```ts
					onExecuteCommand={(value) => {
						const segments = buildCommanderExecuteSegments(value);
						if (!segments.length) return;
						sendLiveInputSegments(segments, {
							interSegmentDelayMs: touchEnterDelayMs,
						});
					}}
```

Keep `onPasteText` as text-only, but route it through the shared helper by using `sendTextRaw`.

```ts
					onPasteText={(value) => {
						if (!value.trim()) return;
						sendTextRaw(value);
					}}
```

- [ ] **Step 10: Run focused integration tests**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- test/integration/tmux-scrollback.test.ts test/integration/terminal-input-payloads.test.ts
```

Expected: PASS for both focused test files.

- [ ] **Step 11: Run mobile typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 12: Commit Task 3**

```bash
git add apps/mobile/src/app/shell/detail.tsx
git commit -m "Route shell input through scrollback live guard"
```

### Task 4: Final Verification

**Files:**
- Verify: `apps/mobile/src/lib/tmux-scrollback.ts`
- Verify: `apps/mobile/src/lib/terminal-input-payloads.ts`
- Verify: `apps/mobile/src/app/shell/detail.tsx`

- [ ] **Step 1: Run mobile integration tests**

Run:

```bash
pnpm --filter @fressh/mobile test:integration
```

Expected: PASS for all integration tests.

- [ ] **Step 2: Run mobile lint check**

Run:

```bash
pnpm --filter @fressh/mobile lint:check
```

Expected: PASS with no ESLint errors.

- [ ] **Step 3: Run mobile typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Manual Android preview verification**

Use an Android preview build for `com.finalapp.vibe2`. Verify these flows:

```text
1. Open a tmux-enabled shell on an Android tablet-sized device.
2. Touch-scroll the terminal until the jump-to-live button appears.
3. Tap Text, type: echo scrollback_text_modal_probe
4. Tap Paste.
5. Confirm the jump-to-live button disappears.
6. Confirm echo scrollback_text_modal_probe is submitted at the live prompt.
7. Touch-scroll again, tap the clipboard Paste key with clipboard text: echo clipboard_probe
8. Confirm the text is inserted without automatically pressing Enter.
9. Touch-scroll again, press a normal keyboard text key.
10. Confirm the app exits scrollback and sends that key to the live prompt.
11. Touch-scroll again, run a commander Execute action.
12. Confirm the command text and Enter are sent in order.
```

- [ ] **Step 5: Commit any verification-driven fixes**

If formatting or lint fixes changed files, commit them with:

```bash
git add apps/mobile/src/lib/tmux-scrollback.ts apps/mobile/src/lib/terminal-input-payloads.ts apps/mobile/src/app/shell/detail.tsx apps/mobile/test/integration/tmux-scrollback.test.ts apps/mobile/test/integration/terminal-input-payloads.test.ts
git commit -m "Fix scrollback live input verification issues"
```

If no files changed after verification, do not create an empty commit.

## Self-Review

- Spec coverage: Task 1 covers centralized scrollback sequencing and fail-closed invalid cancel-key behavior. Task 2 covers Text paste plus Enter and clipboard paste without Enter. Task 3 routes keyboard input, clipboard paste, Text paste, commander input, command presets, macros, and WebView typing through the shared guard while preserving scroll gesture messages. Task 4 covers automated and manual Android preview verification.
- Placeholder scan: The plan contains concrete paths, commands, code snippets, expected failures, expected passes, and commit commands.
- Type consistency: The plan consistently uses `buildTmuxScrollbackLiveInputSendPlan`, `isValidTmuxCancelKey`, `sendLiveInputSegments`, `buildTextEntryPasteSegments`, `buildClipboardPasteSegments`, and `buildCommanderExecuteSegments`.
