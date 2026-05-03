# Long-Press Key Alternatives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional drag/release long-press alternatives to terminal keyboard keys, demonstrated on the Review key with `$rloop-code-fix2` and `$rloop-code-fix3`.

**Architecture:** Extend the runtime shell config schema so keys may carry `longPress.options`, where each option is an executable keyboard item. Keep key execution centralized by accepting both normal slots and long-press options at the shell detail boundary. Keep popup hit-testing in a focused helper and let `TerminalKeyboard` own rendering, gesture state, and the subtle corner affordance.

**Tech Stack:** Expo React Native, TypeScript, Zod, Node `tsx --test`, runtime JSON shell config.

---

## File Structure

- Modify `apps/mobile/src/lib/shell-config.ts`: add `KeyboardLongPressOption`, `KeyboardLongPressConfig`, `KeyboardExecutableItem`, schema parsing, and validation for macro/action references inside long-press options.
- Create `apps/mobile/src/lib/keyboard-long-press.ts`: pure popup layout and drag/release hit-test helpers.
- Modify `apps/mobile/src/app/shell/components/TerminalKeyboard.tsx`: render corner affordance, show a compact horizontal popup above the key, track drag target, and execute the released option.
- Modify `apps/mobile/src/app/shell/detail.tsx`: allow `handleSlotPress` to run `KeyboardExecutableItem`, not only full grid slots.
- Modify `apps/mobile/config/shell-config.json`: add `$rloop-code-fix3` macro and long-press options on the Review key.
- Modify tests under `apps/mobile/test/integration`: schema/config/runtime helper coverage.

## Task 1: Schema Tests for Long-Press Options

**Files:**
- Modify: `apps/mobile/test/integration/shell-config-schema.test.ts`
- Modify: `apps/mobile/src/lib/shell-config.ts`

- [ ] **Step 1: Write failing schema tests**

Add these tests to `apps/mobile/test/integration/shell-config-schema.test.ts` after the existing unknown action test:

```ts
void test('runtime shell config accepts long-press macro options on a key', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	const keyboards = structuredClone(config.keyboards) as Record<string, unknown>[];
	const firstKeyboard = keyboards[0];
	assert.ok(firstKeyboard);
	const grid = structuredClone(firstKeyboard.grid) as unknown[][];
	grid[0]![0] = {
		type: 'macro',
		macroId: 'cmd_fix',
		label: 'Fix',
		icon: null,
		longPress: {
			options: [
				{
					type: 'macro',
					macroId: 'cmd_fix',
					label: 'fix',
					icon: null,
				},
				{
					type: 'macro',
					macroId: 'cmd_yes',
					label: 'yes',
					icon: null,
				},
			],
		},
	};
	firstKeyboard.grid = grid;
	config.keyboards = keyboards;

	const parsed = parseShellConfigData(config);
	const slot = parsed.keyboards[0]?.grid[0]?.[0];
	assert.equal(slot?.type, 'macro');
	assert.deepEqual(slot?.longPress, {
		options: [
			{ type: 'macro', macroId: 'cmd_fix', label: 'fix', icon: null },
			{ type: 'macro', macroId: 'cmd_yes', label: 'yes', icon: null },
		],
	});
});

void test('runtime shell config rejects missing macro references in long-press options', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	const keyboards = structuredClone(config.keyboards) as Record<string, unknown>[];
	const firstKeyboard = keyboards[0];
	assert.ok(firstKeyboard);
	const grid = structuredClone(firstKeyboard.grid) as unknown[][];
	grid[0]![0] = {
		type: 'macro',
		macroId: 'cmd_fix',
		label: 'Fix',
		icon: null,
		longPress: {
			options: [
				{
					type: 'macro',
					macroId: 'missing_long_press_macro',
					label: 'Missing',
					icon: null,
				},
			],
		},
	};
	firstKeyboard.grid = grid;
	config.keyboards = keyboards;

	assert.throws(
		() => parseShellConfigData(config),
		/missing_long_press_macro/,
	);
});

void test('runtime shell config rejects unknown action ids in long-press options', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	const keyboards = structuredClone(config.keyboards) as Record<string, unknown>[];
	const firstKeyboard = keyboards[0];
	assert.ok(firstKeyboard);
	const grid = structuredClone(firstKeyboard.grid) as unknown[][];
	grid[0]![0] = {
		type: 'action',
		actionId: 'PASTE_CLIPBOARD',
		label: 'Paste',
		icon: null,
		longPress: {
			options: [
				{
					type: 'action',
					actionId: 'NOT_A_REAL_ACTION',
					label: 'Broken',
					icon: null,
				},
			],
		},
	};
	firstKeyboard.grid = grid;
	config.keyboards = keyboards;

	assert.throws(() => parseShellConfigData(config), /NOT_A_REAL_ACTION/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/shell-config-schema.test.ts
```

Expected: FAIL because `longPress` is not allowed on keyboard slots yet.

- [ ] **Step 3: Add long-press types and schema**

In `apps/mobile/src/lib/shell-config.ts`, replace the `KeyboardSlot` type area with these definitions:

```ts
export type KeyboardLongPressOption =
	| { type: 'text'; text: string; label: string; icon: string | null }
	| { type: 'bytes'; bytes: readonly number[]; label: string; icon: string | null }
	| { type: 'macro'; macroId: string; label: string; icon: string | null }
	| { type: 'action'; actionId: ActionId; label: string; icon: string | null };

export type KeyboardLongPressConfig = {
	options: readonly KeyboardLongPressOption[];
};

type KeyboardSlotBase = {
	label: string;
	icon: string | null;
	span?: number;
	longPress?: KeyboardLongPressConfig;
};

export type KeyboardSlot =
	| ({ type: 'text'; text: string } & KeyboardSlotBase)
	| ({ type: 'bytes'; bytes: readonly number[] } & KeyboardSlotBase)
	| ({ type: 'modifier'; modifier: ModifierKey } & KeyboardSlotBase)
	| ({ type: 'macro'; macroId: string } & KeyboardSlotBase)
	| ({ type: 'action'; actionId: ActionId } & KeyboardSlotBase);

export type KeyboardExecutableItem = KeyboardSlot | KeyboardLongPressOption;
```

Then replace the keyboard slot schema block with a shared option schema plus full slot schema:

```ts
const keyboardLongPressOptionSchema: z.ZodType<KeyboardLongPressOption> =
	z.discriminatedUnion('type', [
		z.object({
			type: z.literal('text'),
			text: z.string(),
			label: z.string(),
			icon: iconSchema,
		}),
		z.object({
			type: z.literal('bytes'),
			bytes: z.array(z.number().int().min(0).max(255)),
			label: z.string(),
			icon: iconSchema,
		}),
		z.object({
			type: z.literal('macro'),
			macroId: z.string().min(1),
			label: z.string(),
			icon: iconSchema,
		}),
		z.object({
			type: z.literal('action'),
			actionId: z.string().min(1),
			label: z.string(),
			icon: iconSchema,
		}),
	]);

const keyboardLongPressConfigSchema: z.ZodType<KeyboardLongPressConfig> =
	z.object({
		options: z.array(keyboardLongPressOptionSchema).min(1),
	});

const longPressSchema = keyboardLongPressConfigSchema.optional();

const keyboardSlotSchema: z.ZodType<KeyboardSlot> = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('text'),
		text: z.string(),
		label: z.string(),
		icon: iconSchema,
		span: spanSchema,
		longPress: longPressSchema,
	}),
	z.object({
		type: z.literal('bytes'),
		bytes: z.array(z.number().int().min(0).max(255)),
		label: z.string(),
		icon: iconSchema,
		span: spanSchema,
		longPress: longPressSchema,
	}),
	z.object({
		type: z.literal('modifier'),
		modifier: modifierKeySchema,
		label: z.string(),
		icon: iconSchema,
		span: spanSchema,
		longPress: longPressSchema,
	}),
	z.object({
		type: z.literal('macro'),
		macroId: z.string().min(1),
		label: z.string(),
		icon: iconSchema,
		span: spanSchema,
		longPress: longPressSchema,
	}),
	z.object({
		type: z.literal('action'),
		actionId: z.string().min(1),
		label: z.string(),
		icon: iconSchema,
		span: spanSchema,
		longPress: longPressSchema,
	}),
]);
```

Add this helper above `const shellConfigSchema`:

```ts
function validateExecutableItemReferences({
	item,
	macroIds,
	path,
	ctx,
	keyboardId,
}: {
	item: KeyboardExecutableItem;
	macroIds: Set<string>;
	path: (string | number)[];
	ctx: z.RefinementCtx;
	keyboardId: string;
}) {
	if (item.type === 'macro' && !macroIds.has(item.macroId)) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: [...path, 'macroId'],
			message: `Keyboard ${keyboardId} references missing macro ${item.macroId}`,
		});
	}
	if (item.type === 'action' && !supportedActionIds.has(item.actionId)) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: [...path, 'actionId'],
			message: `Unsupported actionId ${item.actionId}`,
		});
	}
}
```

In the existing grid validation loop, replace the direct macro/action checks with:

```ts
validateExecutableItemReferences({
	item: slot,
	macroIds,
	path: ['keyboards', keyboardIndex, 'grid', rowIndex, colIndex],
	ctx,
	keyboardId: keyboard.id,
});

for (const [optionIndex, option] of (
	slot.longPress?.options ?? []
).entries()) {
	validateExecutableItemReferences({
		item: option,
		macroIds,
		path: [
			'keyboards',
			keyboardIndex,
			'grid',
			rowIndex,
			colIndex,
			'longPress',
			'options',
			optionIndex,
		],
		ctx,
		keyboardId: keyboard.id,
	});
}
```

- [ ] **Step 4: Run schema tests**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/shell-config-schema.test.ts
```

Expected: PASS, including the three new long-press tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/shell-config.ts apps/mobile/test/integration/shell-config-schema.test.ts
git commit -m "feat(mobile): add long press shell config schema"
```

## Task 2: Popup Geometry Helper

**Files:**
- Create: `apps/mobile/src/lib/keyboard-long-press.ts`
- Create: `apps/mobile/test/integration/keyboard-long-press.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `apps/mobile/test/integration/keyboard-long-press.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	getLongPressOptionIndexAtPoint,
	getLongPressPopupLayout,
} from '../../src/lib/keyboard-long-press';

void test('long press popup centers above the anchor and clamps to keyboard bounds', () => {
	assert.deepEqual(
		getLongPressPopupLayout({
			keyboardWidth: 320,
			anchorX: 140,
			anchorY: 200,
			anchorWidth: 40,
			optionCount: 2,
		}),
		{
			left: 74,
			top: 146,
			width: 172,
			height: 44,
			optionWidth: 86,
		},
	);

	assert.equal(
		getLongPressPopupLayout({
			keyboardWidth: 180,
			anchorX: 4,
			anchorY: 200,
			anchorWidth: 40,
			optionCount: 2,
		}).left,
		6,
	);
});

void test('long press hit testing returns selected option or null outside popup', () => {
	const layout = {
		left: 74,
		top: 146,
		width: 172,
		height: 44,
		optionWidth: 86,
	};

	assert.equal(
		getLongPressOptionIndexAtPoint({ layout, localX: 80, localY: 160 }),
		0,
	);
	assert.equal(
		getLongPressOptionIndexAtPoint({ layout, localX: 180, localY: 160 }),
		1,
	);
	assert.equal(
		getLongPressOptionIndexAtPoint({ layout, localX: 180, localY: 220 }),
		null,
	);
	assert.equal(
		getLongPressOptionIndexAtPoint({ layout, localX: 260, localY: 160 }),
		null,
	);
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/keyboard-long-press.test.ts
```

Expected: FAIL because `src/lib/keyboard-long-press.ts` does not exist.

- [ ] **Step 3: Implement helper**

Create `apps/mobile/src/lib/keyboard-long-press.ts`:

```ts
export type LongPressPopupLayout = {
	left: number;
	top: number;
	width: number;
	height: number;
	optionWidth: number;
};

const horizontalMargin = 6;
const optionWidth = 86;
const popupHeight = 44;
const popupGap = 6;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

export function getLongPressPopupLayout({
	keyboardWidth,
	anchorX,
	anchorY,
	anchorWidth,
	optionCount,
}: {
	keyboardWidth: number;
	anchorX: number;
	anchorY: number;
	anchorWidth: number;
	optionCount: number;
}): LongPressPopupLayout {
	const width = Math.max(optionWidth, optionCount * optionWidth);
	const centeredLeft = anchorX + anchorWidth / 2 - width / 2;
	const maxLeft = Math.max(horizontalMargin, keyboardWidth - width - horizontalMargin);

	return {
		left: clamp(centeredLeft, horizontalMargin, maxLeft),
		top: Math.max(horizontalMargin, anchorY - popupHeight - popupGap),
		width,
		height: popupHeight,
		optionWidth,
	};
}

export function getLongPressOptionIndexAtPoint({
	layout,
	localX,
	localY,
}: {
	layout: LongPressPopupLayout;
	localX: number;
	localY: number;
}): number | null {
	if (
		localX < layout.left ||
		localX >= layout.left + layout.width ||
		localY < layout.top ||
		localY >= layout.top + layout.height
	) {
		return null;
	}

	const index = Math.floor((localX - layout.left) / layout.optionWidth);
	const optionCount = Math.floor(layout.width / layout.optionWidth);
	return index >= 0 && index < optionCount ? index : null;
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/keyboard-long-press.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/keyboard-long-press.ts apps/mobile/test/integration/keyboard-long-press.test.ts
git commit -m "feat(mobile): add long press keyboard geometry"
```

## Task 3: Review Key Config Tests and Runtime Config

**Files:**
- Modify: `apps/mobile/test/integration/keyboard-config.test.ts`
- Modify: `apps/mobile/config/shell-config.json`

- [ ] **Step 1: Write failing Review config test**

Replace the existing test named `phone base keyboard review key runs $rloop-code-fix2 and keeps the Review label` with:

```ts
void test('phone base keyboard review key taps code fix 2 and long-presses code fix 2 or 3', () => {
	const config = getBundledShellConfig();
	const phoneBaseKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'phone_base',
	);
	assert.ok(phoneBaseKeyboard);

	const phoneBaseMacros = config.macrosByKeyboardId[phoneBaseKeyboard.id];
	assert.ok(phoneBaseMacros);

	const reviewMacro = phoneBaseMacros.find(
		(macro) => macro.id === 'cmd_rloop_code_fix',
	);
	const reviewMacro3 = phoneBaseMacros.find(
		(macro) => macro.id === 'cmd_rloop_code_fix_3',
	);

	assert.deepEqual(reviewMacro, {
		id: 'cmd_rloop_code_fix',
		name: 'Command: rloop code fix 2',
		label: '$rloop-code-fix2',
		category: 'Commands',
		script:
			'{\n  "type": "command",\n  "value": "$rloop-code-fix2",\n  "enter": true\n}',
	});
	assert.deepEqual(reviewMacro3, {
		id: 'cmd_rloop_code_fix_3',
		name: 'Command: rloop code fix 3',
		label: '$rloop-code-fix3',
		category: 'Commands',
		script:
			'{\n  "type": "command",\n  "value": "$rloop-code-fix3",\n  "enter": true\n}',
	});

	const thirdRow = phoneBaseKeyboard.grid[2];
	assert.ok(thirdRow);
	assert.deepEqual(thirdRow[6], {
		type: 'macro',
		macroId: 'cmd_rloop_code_fix',
		label: 'Review',
		icon: null,
		longPress: {
			options: [
				{
					type: 'macro',
					macroId: 'cmd_rloop_code_fix',
					label: '$rloop-code-fix2',
					icon: null,
				},
				{
					type: 'macro',
					macroId: 'cmd_rloop_code_fix_3',
					label: '$rloop-code-fix3',
					icon: null,
				},
			],
		},
	});
});
```

- [ ] **Step 2: Run config tests to verify they fail**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/keyboard-config.test.ts
```

Expected: FAIL because the third macro and `longPress` config are not present.

- [ ] **Step 3: Update shell config JSON**

In `apps/mobile/config/shell-config.json`:

1. Update metadata:
   - If `version` already starts with `2026-05-03.`, increment the suffix.
   - Otherwise set `version` to `2026-05-03.1`.
   - Set `updatedAt` to the current UTC ISO timestamp.

2. Change the Review key at `phone_base.grid[2][6]` from:

```json
{
  "type": "macro",
  "macroId": "cmd_rloop_code_fix",
  "label": "Review",
  "icon": null
}
```

to:

```json
{
  "type": "macro",
  "macroId": "cmd_rloop_code_fix",
  "label": "Review",
  "icon": null,
  "longPress": {
    "options": [
      {
        "type": "macro",
        "macroId": "cmd_rloop_code_fix",
        "label": "$rloop-code-fix2",
        "icon": null
      },
      {
        "type": "macro",
        "macroId": "cmd_rloop_code_fix_3",
        "label": "$rloop-code-fix3",
        "icon": null
      }
    ]
  }
}
```

3. Change the existing `cmd_rloop_code_fix` macro object to:

```json
{
  "id": "cmd_rloop_code_fix",
  "name": "Command: rloop code fix 2",
  "label": "$rloop-code-fix2",
  "category": "Commands",
  "script": "{\n  \"type\": \"command\",\n  \"value\": \"$rloop-code-fix2\",\n  \"enter\": true\n}"
}
```

4. Insert this macro immediately after `cmd_rloop_code_fix`:

```json
{
  "id": "cmd_rloop_code_fix_3",
  "name": "Command: rloop code fix 3",
  "label": "$rloop-code-fix3",
  "category": "Commands",
  "script": "{\n  \"type\": \"command\",\n  \"value\": \"$rloop-code-fix3\",\n  \"enter\": true\n}"
}
```

- [ ] **Step 4: Run config tests**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/keyboard-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Validate shell config**

Run:

```bash
pnpm --dir apps/mobile validate:shell-config
```

Expected: PASS with the new config version.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/config/shell-config.json apps/mobile/test/integration/keyboard-config.test.ts
git commit -m "feat(mobile): configure review long press actions"
```

## Task 4: Widen the Execution Type Boundary

**Files:**
- Modify: `apps/mobile/src/lib/keyboard-runtime.ts`
- Modify: `apps/mobile/src/app/shell/detail.tsx`

- [ ] **Step 1: Run focused baseline checks**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/keyboard-runtime.test.ts
pnpm --dir apps/mobile typecheck
```

Expected: PASS before the type-boundary refactor. This task is a type cleanup that makes the execution API express the new schema shape; runtime behavior is already covered by the existing macro runner tests and the config tests from Task 3.

- [ ] **Step 2: Update runtime item type**

In `apps/mobile/src/lib/keyboard-runtime.ts`, change the import to:

```ts
import {
	type KeyboardExecutableItem,
	type MacroDef,
} from '@/lib/shell-config';
```

Change `runSlotItem` signature to:

```ts
export function runSlotItem(
	item: KeyboardExecutableItem,
	macros: MacroDef[],
	{
		sendBytes,
		sendText,
		runSteps,
		onAction,
	}: {
		sendBytes: (bytes: Uint8Array<ArrayBuffer>) => void;
		sendText: (value: string) => void;
		runSteps?: (steps: MacroStep[]) => void;
		onAction: (actionId: ActionId) => void;
	},
)
```

Do not add a `modifier` case to long-press options; modifiers are normal key slots only.

- [ ] **Step 3: Update shell detail execution type**

In `apps/mobile/src/app/shell/detail.tsx`, import `KeyboardExecutableItem` from `@/lib/shell-config`.

Change:

```ts
const handleSlotPress = useCallback(
	(slot: KeyboardSlot) => {
```

to:

```ts
const handleSlotPress = useCallback(
	(slot: KeyboardExecutableItem) => {
```

Keep the existing `modifier` case. It remains reachable for normal key slots and unreachable for long-press options.

- [ ] **Step 4: Run runtime test and typecheck**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/keyboard-runtime.test.ts
pnpm --dir apps/mobile typecheck
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/keyboard-runtime.ts apps/mobile/src/app/shell/detail.tsx
git commit -m "feat(mobile): execute long press keyboard options"
```

## Task 5: Render Long-Press Popup in Terminal Keyboard

**Files:**
- Modify: `apps/mobile/src/app/shell/components/TerminalKeyboard.tsx`

- [ ] **Step 1: Add implementation**

In `TerminalKeyboard.tsx`, make these focused changes:

1. Update imports:

```ts
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Pressable,
	type GestureResponderEvent,
	type LayoutChangeEvent,
	Text,
	View,
} from 'react-native';
import {
	getLongPressOptionIndexAtPoint,
	getLongPressPopupLayout,
	type LongPressPopupLayout,
} from '@/lib/keyboard-long-press';
import {
	type KeyboardDefinition,
	type KeyboardExecutableItem,
	type KeyboardLongPressOption,
	type KeyboardSlot,
	type ModifierKey,
} from '@/lib/shell-config';
```

2. Change prop type:

```ts
onSlotPress: (slot: KeyboardExecutableItem) => void;
```

3. Add state and refs near the repeat refs:

```ts
const keyboardRootRef = useRef<View | null>(null);
const keyboardRootWindowRef = useRef({ x: 0, y: 0 });
const keyboardWidthRef = useRef(0);
const suppressNextPressRef = useRef(false);
const activeLongPressSlotRef = useRef<KeyboardSlot | null>(null);
const [longPressPopup, setLongPressPopup] = useState<{
	slot: KeyboardSlot;
	options: readonly KeyboardLongPressOption[];
	layout: LongPressPopupLayout;
	highlightedIndex: number | null;
} | null>(null);
```

4. Add helpers before the `if (!keyboard)` branch:

```ts
const closeLongPressPopup = useCallback(() => {
	activeLongPressSlotRef.current = null;
	setLongPressPopup(null);
}, []);

const updateKeyboardRootMetrics = useCallback(() => {
	keyboardRootRef.current?.measureInWindow((x, y, width) => {
		keyboardRootWindowRef.current = { x, y };
		keyboardWidthRef.current = width;
	});
}, []);

const handleKeyboardLayout = useCallback(
	(_event: LayoutChangeEvent) => {
		updateKeyboardRootMetrics();
	},
	[updateKeyboardRootMetrics],
);

const getLocalPoint = useCallback((event: GestureResponderEvent) => {
	return {
		localX: event.nativeEvent.pageX - keyboardRootWindowRef.current.x,
		localY: event.nativeEvent.pageY - keyboardRootWindowRef.current.y,
	};
}, []);

const updateLongPressHighlight = useCallback(
	(event: GestureResponderEvent) => {
		setLongPressPopup((current) => {
			if (!current) return current;
			const { localX, localY } = getLocalPoint(event);
			const highlightedIndex = getLongPressOptionIndexAtPoint({
				layout: current.layout,
				localX,
				localY,
			});
			if (highlightedIndex === current.highlightedIndex) return current;
			return { ...current, highlightedIndex };
		});
	},
	[getLocalPoint],
);

const openLongPressPopup = useCallback(
	(slot: KeyboardSlot, keyRef: React.RefObject<View | null>) => {
		const options = slot.longPress?.options;
		if (!options?.length) return;

		clearRepeat();
		suppressNextPressRef.current = true;
		activeLongPressSlotRef.current = slot;
		updateKeyboardRootMetrics();
		keyRef.current?.measureInWindow((x, y, width) => {
			const root = keyboardRootWindowRef.current;
			const layout = getLongPressPopupLayout({
				keyboardWidth: keyboardWidthRef.current,
				anchorX: x - root.x,
				anchorY: y - root.y,
				anchorWidth: width,
				optionCount: options.length,
			});
			setLongPressPopup({
				slot,
				options,
				layout,
				highlightedIndex: null,
			});
		});
	},
	[clearRepeat, updateKeyboardRootMetrics],
);

const releaseLongPressPopup = useCallback(
	(event: GestureResponderEvent) => {
		const current = longPressPopup;
		if (!current) return false;
		const { localX, localY } = getLocalPoint(event);
		const optionIndex = getLongPressOptionIndexAtPoint({
			layout: current.layout,
			localX,
			localY,
		});
		closeLongPressPopup();
		if (optionIndex == null) return true;
		const option = current.options[optionIndex];
		if (option) onSlotPress(option);
		return true;
	},
	[closeLongPressPopup, getLocalPoint, longPressPopup, onSlotPress],
);
```

5. Inside the row cell loop, create a key ref before rendering each `Pressable`:

```ts
const keyRef = React.createRef<View>();
const hasLongPressOptions = Boolean(slot.longPress?.options.length);
```

6. Update each key `Pressable` to include:

```tsx
ref={keyRef}
onPress={
	isRepeatable || hasLongPressOptions
		? undefined
		: isSelectionCopySlot
			? onCopySelection
			: () => onSlotPress(slot)
}
onLongPress={
	hasLongPressOptions ? () => openLongPressPopup(slot, keyRef) : undefined
}
onPressIn={isRepeatable ? () => startRepeat(slot) : undefined}
onPressOut={(event) => {
	if (releaseLongPressPopup(event)) return;
	if (isRepeatable) clearRepeat();
	if (hasLongPressOptions) {
		if (suppressNextPressRef.current) {
			suppressNextPressRef.current = false;
			return;
		}
		if (isSelectionCopySlot) {
			onCopySelection();
			return;
		}
		onSlotPress(slot);
	}
}}
onTouchMove={hasLongPressOptions ? updateLongPressHighlight : undefined}
```

7. Inside the key content, after the label, render the corner mark:

```tsx
{hasLongPressOptions ? (
	<View
		style={{
			position: 'absolute',
			top: 4,
			right: 4,
			width: 5,
			height: 5,
			borderRadius: 3,
			backgroundColor: theme.colors.textSecondary,
			opacity: 0.75,
		}}
	/>
) : null}
```

8. Change the root return `<View>` to:

```tsx
<View
	ref={keyboardRootRef}
	onLayout={handleKeyboardLayout}
	style={{
		borderTopWidth: 1,
		borderColor: theme.colors.border,
		padding: 6,
		position: 'relative',
	}}
>
```

9. Render the popup after `{rows}` and before the closing root `</View>`:

```tsx
{longPressPopup ? (
	<View
		pointerEvents="none"
		style={{
			position: 'absolute',
			left: longPressPopup.layout.left,
			top: longPressPopup.layout.top,
			width: longPressPopup.layout.width,
			height: longPressPopup.layout.height,
			flexDirection: 'row',
			borderRadius: 8,
			borderWidth: 1,
			borderColor: theme.colors.borderStrong,
			backgroundColor: theme.colors.surface,
			overflow: 'hidden',
			shadowColor: '#000',
			shadowOpacity: 0.25,
			shadowRadius: 8,
			shadowOffset: { width: 0, height: 3 },
			elevation: 6,
		}}
	>
		{longPressPopup.options.map((option, index) => {
			const OptionIcon = resolveLucideIcon(option.icon);
			const highlighted = longPressPopup.highlightedIndex === index;
			return (
				<View
					key={`${option.type}-${option.label}-${index.toString()}`}
					style={{
						width: longPressPopup.layout.optionWidth,
						alignItems: 'center',
						justifyContent: 'center',
						paddingHorizontal: 6,
						backgroundColor: highlighted
							? theme.colors.primary
							: 'transparent',
					}}
				>
					{OptionIcon ? (
						<OptionIcon color={theme.colors.textPrimary} size={16} />
					) : null}
					<Text
						numberOfLines={1}
						style={{
							color: theme.colors.textPrimary,
							fontSize: 10,
							lineHeight: 12,
							marginTop: OptionIcon ? 2 : 0,
						}}
					>
						{option.label}
					</Text>
				</View>
			);
		})}
	</View>
) : null}
```

- [ ] **Step 2: Run focused checks**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/keyboard-long-press.test.ts
pnpm --dir apps/mobile typecheck
```

Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/app/shell/components/TerminalKeyboard.tsx
git commit -m "feat(mobile): show long press keyboard popup"
```

## Task 6: Full Verification and Runtime Config Publish

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run required shell config validation**

Run:

```bash
pnpm --dir apps/mobile validate:shell-config
```

Expected: PASS with the new config version.

- [ ] **Step 2: Run focused integration tests**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/shell-config-schema.test.ts test/integration/keyboard-config.test.ts test/integration/keyboard-runtime.test.ts test/integration/keyboard-long-press.test.ts
```

Expected: PASS with zero failures.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --dir apps/mobile typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect diff**

Run:

```bash
git diff --stat HEAD
git diff -- apps/mobile/src/lib/shell-config.ts apps/mobile/src/lib/keyboard-long-press.ts apps/mobile/src/app/shell/components/TerminalKeyboard.tsx apps/mobile/src/app/shell/detail.tsx apps/mobile/config/shell-config.json apps/mobile/test/integration
```

Expected: only long-press schema, popup UI, Review key config, and related tests changed.

- [ ] **Step 5: Commit any final verification fixes**

If Step 1-4 required small fixes, commit them:

```bash
git add apps/mobile/src apps/mobile/config/shell-config.json apps/mobile/test/integration
git commit -m "fix(mobile): finalize long press keyboard options"
```

If there are no changes after Step 1-4, do not create an empty commit.

- [ ] **Step 6: Push dev runtime config branch**

Run:

```bash
git status --short --branch
git push origin dev
```

Expected: branch is `dev`, working tree is clean, and push updates `origin/dev`.

- [ ] **Step 7: Device smoke test**

On the connected Android device:

1. Open the shell Configure modal.
2. Tap `Reload config`.
3. Confirm the alert says it loaded the new config version from GitHub.
4. Long press `Review`.
5. Drag to `$rloop-code-fix3` and release.
6. Confirm `$rloop-code-fix3` is submitted with enter.
7. Tap `Review`.
8. Confirm `$rloop-code-fix2` is still submitted with enter.
