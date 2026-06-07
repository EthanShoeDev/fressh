import {
	type TextEntryHistoryEntry,
	type TextEntryHistoryState,
} from '@/lib/text-entry-history';

const DRAG_THRESHOLD_PX = 2;

export type TextEntryCurrentPinAction =
	| { type: 'none' }
	| { type: 'pin-text'; text: string }
	| { type: 'pin-entry'; id: string }
	| { type: 'unpin-entry'; id: string };

export function getCurrentTextPinAction({
	value,
	currentHistoryEntry,
}: {
	value: string;
	currentHistoryEntry: TextEntryHistoryEntry | undefined;
}): TextEntryCurrentPinAction {
	if (value.length === 0) return { type: 'none' };
	if (!currentHistoryEntry) return { type: 'pin-text', text: value };
	if (currentHistoryEntry.pinned) {
		return { type: 'unpin-entry', id: currentHistoryEntry.id };
	}
	return { type: 'pin-entry', id: currentHistoryEntry.id };
}

export function recordAcceptedTextEntryHistoryPaste({
	accepted,
	historyText,
	recordPaste,
}: {
	accepted: boolean;
	historyText: string | null;
	recordPaste: (text: string) => TextEntryHistoryState;
}): TextEntryHistoryState | undefined {
	if (!accepted || historyText === null) return undefined;
	return recordPaste(historyText);
}

export function shouldStartTextEntryModalPanResponder() {
	return false;
}

export function shouldTextEntryModalClaimDragMove({
	dx,
	dy,
}: {
	dx: number;
	dy: number;
}) {
	return Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX;
}
