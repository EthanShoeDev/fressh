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
