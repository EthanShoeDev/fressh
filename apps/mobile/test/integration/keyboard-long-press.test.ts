import assert from 'node:assert/strict';
import test from 'node:test';
import {
	getLongPressKeyboardBoundedOptionIndex,
	getLongPressMoveState,
	getLongPressOptionIndexAtPoint,
	getLongPressPopupLayout,
	getLongPressReleaseDecision,
	getLongPressTrackedOptionIndex,
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

void test('keyboard-bounded lane hit testing clamps x and rejects y outside keyboard', () => {
	const layout = {
		left: 74,
		top: 146,
		width: 172,
		height: 44,
		optionWidth: 86,
	};
	const keyboardBounds = { left: 0, top: 100, width: 320, height: 180 };

	assert.equal(
		getLongPressKeyboardBoundedOptionIndex({
			layout,
			keyboardBounds,
			localX: 180,
			localY: 240,
		}),
		1,
	);
	assert.equal(
		getLongPressKeyboardBoundedOptionIndex({
			layout,
			keyboardBounds,
			localX: 20,
			localY: 240,
		}),
		0,
	);
	assert.equal(
		getLongPressKeyboardBoundedOptionIndex({
			layout,
			keyboardBounds,
			localX: 319,
			localY: 240,
		}),
		1,
	);
	assert.equal(
		getLongPressKeyboardBoundedOptionIndex({
			layout,
			keyboardBounds,
			localX: 180,
			localY: 90,
		}),
		null,
	);
	assert.equal(
		getLongPressKeyboardBoundedOptionIndex({
			layout,
			keyboardBounds,
			localX: 180,
			localY: 280,
		}),
		null,
	);
});

void test('keyboard-bounded lane hit testing rejects x outside keyboard', () => {
	const layout = {
		left: 74,
		top: 146,
		width: 172,
		height: 44,
		optionWidth: 86,
	};
	const keyboardBounds = { left: 0, top: 100, width: 320, height: 180 };

	assert.equal(
		getLongPressKeyboardBoundedOptionIndex({
			layout,
			keyboardBounds,
			localX: -1,
			localY: 240,
		}),
		null,
	);
	assert.equal(
		getLongPressKeyboardBoundedOptionIndex({
			layout,
			keyboardBounds,
			localX: 320,
			localY: 240,
		}),
		null,
	);
	assert.equal(
		getLongPressKeyboardBoundedOptionIndex({
			layout,
			keyboardBounds,
			localX: 319,
			localY: 240,
		}),
		1,
	);
});

void test('long press tracking selects by horizontal lane inside keyboard bounds', () => {
	const layout = {
		left: 74,
		top: 146,
		width: 172,
		height: 44,
		optionWidth: 86,
	};
	const keyboardBounds = { left: 0, top: 100, width: 320, height: 180 };

	assert.equal(
		getLongPressTrackedOptionIndex({
			layout,
			keyboardBounds,
			localX: 180,
			localY: 160,
			previousIndex: null,
		}),
		1,
	);
	assert.equal(
		getLongPressTrackedOptionIndex({
			layout,
			keyboardBounds,
			localX: 180,
			localY: 240,
			previousIndex: 1,
		}),
		1,
	);
	assert.equal(
		getLongPressTrackedOptionIndex({
			layout,
			keyboardBounds,
			localX: 20,
			localY: 240,
			previousIndex: 1,
		}),
		0,
	);
	assert.equal(
		getLongPressTrackedOptionIndex({
			layout,
			keyboardBounds,
			localX: 260,
			localY: 240,
			previousIndex: 1,
		}),
		1,
	);
	assert.equal(
		getLongPressTrackedOptionIndex({
			layout,
			keyboardBounds,
			localX: 180,
			localY: 90,
			previousIndex: 1,
		}),
		null,
	);
	assert.equal(
		getLongPressTrackedOptionIndex({
			layout,
			keyboardBounds,
			localX: 180,
			localY: 300,
			previousIndex: 1,
		}),
		null,
	);
});

void test('long press release decision keeps tap, option, and cancel paths distinct', () => {
	const layout = {
		left: 74,
		top: 146,
		width: 172,
		height: 44,
		optionWidth: 86,
	};
	const keyboardBounds = { left: 0, top: 100, width: 320, height: 180 };

	assert.deepEqual(
		getLongPressReleaseDecision({
			longPressFired: false,
			movedBeyondTapSlop: false,
			startPageX: 100,
			startPageY: 200,
			releasePageX: 104,
			releasePageY: 203,
			tapSlopPx: 8,
			rootX: 0,
			rootY: 0,
			popupLayout: null,
		}),
		{ type: 'tap' },
	);

	assert.deepEqual(
		getLongPressReleaseDecision({
			longPressFired: false,
			movedBeyondTapSlop: true,
			startPageX: 100,
			startPageY: 200,
			releasePageX: 120,
			releasePageY: 203,
			tapSlopPx: 8,
			rootX: 0,
			rootY: 0,
			popupLayout: null,
		}),
		{ type: 'cancel' },
	);

	assert.deepEqual(
		getLongPressReleaseDecision({
			longPressFired: true,
			movedBeyondTapSlop: false,
			startPageX: 100,
			startPageY: 200,
			releasePageX: 180,
			releasePageY: 160,
			tapSlopPx: 8,
			rootX: 0,
			rootY: 0,
			popupLayout: layout,
			keyboardBounds,
			highlightedIndex: null,
		}),
		{ type: 'option', optionIndex: 1 },
	);

	assert.deepEqual(
		getLongPressReleaseDecision({
			longPressFired: true,
			movedBeyondTapSlop: false,
			startPageX: 100,
			startPageY: 200,
			releasePageX: 180,
			releasePageY: 220,
			tapSlopPx: 8,
			rootX: 0,
			rootY: 0,
			popupLayout: layout,
			keyboardBounds,
			highlightedIndex: null,
		}),
		{ type: 'option', optionIndex: 1 },
	);
});

void test('long press release without keyboard bounds preserves highlighted lane fallback', () => {
	const layout = {
		left: 74,
		top: 146,
		width: 172,
		height: 44,
		optionWidth: 86,
	};

	assert.deepEqual(
		getLongPressReleaseDecision({
			longPressFired: true,
			movedBeyondTapSlop: false,
			startPageX: 100,
			startPageY: 200,
			releasePageX: 180,
			releasePageY: 220,
			tapSlopPx: 8,
			rootX: 0,
			rootY: 0,
			popupLayout: layout,
			highlightedIndex: 1,
		}),
		{ type: 'option', optionIndex: 1 },
	);
});

void test('long press release selects by horizontal lane inside keyboard bounds', () => {
	const layout = {
		left: 74,
		top: 146,
		width: 172,
		height: 44,
		optionWidth: 86,
	};
	const keyboardBounds = { left: 0, top: 100, width: 320, height: 180 };

	assert.deepEqual(
		getLongPressReleaseDecision({
			longPressFired: true,
			movedBeyondTapSlop: false,
			startPageX: 100,
			startPageY: 200,
			releasePageX: 180,
			releasePageY: 240,
			tapSlopPx: 8,
			rootX: 0,
			rootY: 0,
			popupLayout: layout,
			keyboardBounds,
			highlightedIndex: 1,
		}),
		{ type: 'option', optionIndex: 1 },
	);

	assert.deepEqual(
		getLongPressReleaseDecision({
			longPressFired: true,
			movedBeyondTapSlop: false,
			startPageX: 100,
			startPageY: 200,
			releasePageX: 20,
			releasePageY: 240,
			tapSlopPx: 8,
			rootX: 0,
			rootY: 0,
			popupLayout: layout,
			keyboardBounds,
			highlightedIndex: 1,
		}),
		{ type: 'option', optionIndex: 0 },
	);

	assert.deepEqual(
		getLongPressReleaseDecision({
			longPressFired: true,
			movedBeyondTapSlop: false,
			startPageX: 100,
			startPageY: 200,
			releasePageX: 400,
			releasePageY: 240,
			tapSlopPx: 8,
			rootX: 0,
			rootY: 0,
			popupLayout: layout,
			keyboardBounds,
			highlightedIndex: 1,
		}),
		{ type: 'cancel' },
	);

	assert.deepEqual(
		getLongPressReleaseDecision({
			longPressFired: true,
			movedBeyondTapSlop: false,
			startPageX: 100,
			startPageY: 200,
			releasePageX: 180,
			releasePageY: 300,
			tapSlopPx: 8,
			rootX: 0,
			rootY: 0,
			popupLayout: layout,
			keyboardBounds,
			highlightedIndex: 1,
		}),
		{ type: 'cancel' },
	);
});

void test('long press movement before popup preserves timer but cancels tap', () => {
	assert.deepEqual(
		getLongPressMoveState({
			longPressFired: false,
			movedBeyondTapSlop: false,
			startPageX: 100,
			startPageY: 200,
			currentPageX: 102,
			currentPageY: 204,
			tapSlopPx: 8,
		}),
		{ movedBeyondTapSlop: false, keepLongPressTimer: true },
	);

	assert.deepEqual(
		getLongPressMoveState({
			longPressFired: false,
			movedBeyondTapSlop: false,
			startPageX: 100,
			startPageY: 200,
			currentPageX: 100,
			currentPageY: 160,
			tapSlopPx: 8,
		}),
		{ movedBeyondTapSlop: true, keepLongPressTimer: true },
	);

	assert.deepEqual(
		getLongPressMoveState({
			longPressFired: true,
			movedBeyondTapSlop: true,
			startPageX: 100,
			startPageY: 200,
			currentPageX: 100,
			currentPageY: 160,
			tapSlopPx: 8,
		}),
		{ movedBeyondTapSlop: true, keepLongPressTimer: false },
	);
});
