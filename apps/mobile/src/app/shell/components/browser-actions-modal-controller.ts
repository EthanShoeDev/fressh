import {
	getBrowserActionPressIntent,
	getNextBrowserActionMenuMode,
	isBrowserActionUrlRow,
	type BrowserActionMenuMode,
	type BrowserActionRow,
} from '@/lib/browser-actions';
import { type HostBrowserUrlSlot } from '@/lib/host-browser-actions';

type SetValue<Value> = (value: Value | ((current: Value) => Value)) => void;

export type BrowserActionsModalCallbacks = {
	onClose: () => void;
	onOpenDiff: () => void;
	onOpenGitHubIssues: () => void;
	onOpenGitHubPulls: () => void;
	onOpenDetectedAuto: () => void;
	onOpenDetectedPick: () => void;
	onOpenUrlSlot: (slot: HostBrowserUrlSlot) => void;
	onEditUrlSlot: (slot: HostBrowserUrlSlot) => void;
};

export function resetBrowserActionsModalState({
	setMenuMode,
	setLongPressedRowId,
}: {
	setMenuMode: SetValue<BrowserActionMenuMode>;
	setLongPressedRowId: (rowId: string | null) => void;
}) {
	setLongPressedRowId(null);
	setMenuMode('open');
}

export const handleBrowserActionsModalShow = resetBrowserActionsModalState;

export function handleBrowserActionsModalClose({
	setMenuMode,
	onClose,
}: {
	setMenuMode: SetValue<BrowserActionMenuMode>;
	onClose: () => void;
}) {
	setMenuMode('open');
	onClose();
}

export function handleBrowserActionsModalModeToggle({
	setMenuMode,
}: {
	setMenuMode: SetValue<BrowserActionMenuMode>;
}) {
	setMenuMode(getNextBrowserActionMenuMode);
}

export function handleBrowserActionsModalRowPress({
	row,
	menuMode,
	longPressedRowId,
	setLongPressedRowId,
	callbacks,
}: {
	row: BrowserActionRow;
	menuMode: BrowserActionMenuMode;
	longPressedRowId: string | null;
	setLongPressedRowId: (rowId: string | null) => void;
	callbacks: BrowserActionsModalCallbacks;
}) {
	if (longPressedRowId === row.id) {
		setLongPressedRowId(null);
		return;
	}

	const intent = getBrowserActionPressIntent(row, menuMode);
	switch (intent.type) {
		case 'open-diff':
			runAndClose(callbacks, callbacks.onOpenDiff);
			return;
		case 'open-github-issues':
			runAndClose(callbacks, callbacks.onOpenGitHubIssues);
			return;
		case 'open-github-pulls':
			runAndClose(callbacks, callbacks.onOpenGitHubPulls);
			return;
		case 'open-detected-auto':
			runAndClose(callbacks, callbacks.onOpenDetectedAuto);
			return;
		case 'open-detected-pick':
			runAndClose(callbacks, callbacks.onOpenDetectedPick);
			return;
		case 'open-url-slot':
			runAndClose(callbacks, () => callbacks.onOpenUrlSlot(intent.slot));
			return;
		case 'edit-url-slot':
			runAndClose(callbacks, () => callbacks.onEditUrlSlot(intent.slot));
			return;
	}
}

export function handleBrowserActionsModalRowLongPress({
	row,
	setLongPressedRowId,
	callbacks,
}: {
	row: BrowserActionRow;
	setLongPressedRowId: (rowId: string | null) => void;
	callbacks: BrowserActionsModalCallbacks;
}) {
	if (!isBrowserActionUrlRow(row)) return;
	setLongPressedRowId(row.id);
	runAndClose(callbacks, () => callbacks.onEditUrlSlot(row.slot));
}

function runAndClose(
	callbacks: BrowserActionsModalCallbacks,
	callback: () => void,
) {
	callbacks.onClose();
	callback();
}
