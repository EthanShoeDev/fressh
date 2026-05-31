import assert from 'node:assert/strict';
import test from 'node:test';

import {
	handleBrowserActionsModalClose,
	handleBrowserActionsModalModeToggle,
	handleBrowserActionsModalRowLongPress,
	handleBrowserActionsModalRowPress,
	handleBrowserActionsModalShow,
	type BrowserActionsModalCallbacks,
} from '../../src/app/shell/components/browser-actions-modal-controller';
import {
	BROWSER_ACTION_ROWS,
	type BrowserActionMenuMode,
	type BrowserActionRow,
} from '../../src/lib/browser-actions';
import { type HostBrowserUrlSlot } from '../../src/lib/host-browser-actions';

type ControllerState = {
	menuMode: BrowserActionMenuMode;
	longPressedRowId: string | null;
	calls: string[];
};

function createState(): ControllerState {
	return {
		menuMode: 'open',
		longPressedRowId: null,
		calls: [],
	};
}

function setMenuMode(
	state: ControllerState,
	value:
		| BrowserActionMenuMode
		| ((current: BrowserActionMenuMode) => BrowserActionMenuMode),
) {
	state.menuMode = typeof value === 'function' ? value(state.menuMode) : value;
}

function createCallbacks(
	state: ControllerState,
	onClose?: () => void,
): BrowserActionsModalCallbacks {
	return {
		onClose:
			onClose ??
			(() => {
				state.calls.push('close');
			}),
		onOpenDiff: () => {
			state.calls.push('diff');
		},
		onOpenGitHubIssues: () => {
			state.calls.push('github-issues');
		},
		onOpenGitHubPulls: () => {
			state.calls.push('github-pulls');
		},
		onOpenDetectedAuto: () => {
			state.calls.push('open-detected-auto');
			return true;
		},
		onOpenDetectedPick: () => {
			state.calls.push('open-detected-pick');
			return true;
		},
		onOpenUrlSlot: (slot: HostBrowserUrlSlot) => {
			state.calls.push(`open:${slot}`);
		},
		onEditUrlSlot: (slot: HostBrowserUrlSlot) => {
			state.calls.push(`edit:${slot}`);
		},
	};
}

function row(id: BrowserActionRow['id']): BrowserActionRow {
	const actionRow = BROWSER_ACTION_ROWS.find((item) => item.id === id);
	assert.ok(actionRow);
	return actionRow;
}

void test('browser actions modal controller toggles between open and set mode', () => {
	const state = createState();

	handleBrowserActionsModalModeToggle({
		setMenuMode: (value) => setMenuMode(state, value),
	});
	assert.equal(state.menuMode, 'set');

	handleBrowserActionsModalModeToggle({
		setMenuMode: (value) => setMenuMode(state, value),
	});
	assert.equal(state.menuMode, 'open');
});

void test('browser actions modal controller edits URL rows in set mode', () => {
	const state = createState();
	state.menuMode = 'set';

	handleBrowserActionsModalRowPress({
		row: row('url-window'),
		menuMode: state.menuMode,
		longPressedRowId: state.longPressedRowId,
		setLongPressedRowId: (rowId) => {
			state.longPressedRowId = rowId;
		},
		callbacks: createCallbacks(state),
	});

	assert.deepEqual(state.calls, ['close', 'edit:window-url']);
});

void test('browser actions modal controller keeps static rows open in set mode', () => {
	const cases: readonly {
		id: BrowserActionRow['id'];
		expectedCalls: string[];
	}[] = [
		{ id: 'diff', expectedCalls: ['close', 'diff'] },
		{ id: 'github-issues', expectedCalls: ['close', 'github-issues'] },
		{ id: 'github-pulls', expectedCalls: ['close', 'github-pulls'] },
		{
			id: 'open-detected-auto',
			expectedCalls: ['open-detected-auto', 'close'],
		},
		{
			id: 'open-detected-pick',
			expectedCalls: ['open-detected-pick', 'close'],
		},
	];

	for (const testCase of cases) {
		const state = createState();
		state.menuMode = 'set';

		handleBrowserActionsModalRowPress({
			row: row(testCase.id),
			menuMode: state.menuMode,
			longPressedRowId: state.longPressedRowId,
			setLongPressedRowId: (rowId) => {
				state.longPressedRowId = rowId;
			},
			callbacks: createCallbacks(state),
		});

		assert.deepEqual(state.calls, testCase.expectedCalls);
	}
});

void test('browser actions modal controller keeps detected row open when rejected', () => {
	const state = createState();
	const callbacks = {
		...createCallbacks(state),
		onOpenDetectedAuto: () => {
			state.calls.push('open-detected-auto:busy');
			return false;
		},
	};

	handleBrowserActionsModalRowPress({
		row: row('open-detected-auto'),
		menuMode: state.menuMode,
		longPressedRowId: state.longPressedRowId,
		setLongPressedRowId: (rowId) => {
			state.longPressedRowId = rowId;
		},
		callbacks,
	});

	assert.deepEqual(state.calls, ['open-detected-auto:busy']);
});

void test('browser actions modal controller suppresses tap after URL long press', () => {
	const state = createState();
	const urlRow = row('url-window');
	const callbacks = createCallbacks(state, () => {
		handleBrowserActionsModalClose({
			setMenuMode: (value) => setMenuMode(state, value),
			onClose: () => {
				state.calls.push('close');
			},
		});
	});

	handleBrowserActionsModalRowLongPress({
		row: urlRow,
		setLongPressedRowId: (rowId) => {
			state.longPressedRowId = rowId;
		},
		callbacks,
	});
	handleBrowserActionsModalRowPress({
		row: urlRow,
		menuMode: state.menuMode,
		longPressedRowId: state.longPressedRowId,
		setLongPressedRowId: (rowId) => {
			state.longPressedRowId = rowId;
		},
		callbacks,
	});

	assert.equal(state.longPressedRowId, null);
	assert.deepEqual(state.calls, ['close', 'edit:window-url']);
});

void test('browser actions modal controller resets mode before close while preserving long-press suppression', () => {
	const state = createState();
	state.menuMode = 'set';
	state.longPressedRowId = 'url-window';

	handleBrowserActionsModalClose({
		setMenuMode: (value) => setMenuMode(state, value),
		onClose: () => {
			state.calls.push(
				`close:${state.menuMode}:${state.longPressedRowId ?? 'none'}`,
			);
		},
	});

	assert.equal(state.menuMode, 'open');
	assert.equal(state.longPressedRowId, 'url-window');
	assert.deepEqual(state.calls, ['close:open:url-window']);
});

void test('browser actions modal controller resets mode when shown', () => {
	const state = createState();
	state.menuMode = 'set';
	state.longPressedRowId = 'url-window';

	handleBrowserActionsModalShow({
		setMenuMode: (value) => setMenuMode(state, value),
		setLongPressedRowId: (rowId) => {
			state.longPressedRowId = rowId;
		},
	});

	assert.equal(state.menuMode, 'open');
	assert.equal(state.longPressedRowId, null);
});
