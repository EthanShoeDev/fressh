import { type TextEntryHistoryEntry } from '@/lib/text-entry-history';

export type TextEntryHistoryCursorDirection = 'previous' | 'next';

export function getTextEntryHistoryCursorIndex(
	cycleEntries: readonly TextEntryHistoryEntry[],
	selectedEntryId: string | null | undefined,
): number {
	if (!selectedEntryId) return -1;
	return cycleEntries.findIndex((entry) => entry.id === selectedEntryId);
}

export function getTextEntryHistoryCursorLabel(
	cycleEntries: readonly TextEntryHistoryEntry[],
	selectedEntryId: string | null | undefined,
): string {
	const selectedIndex = getTextEntryHistoryCursorIndex(
		cycleEntries,
		selectedEntryId,
	);
	if (cycleEntries.length === 0) return '0/0';
	return `${selectedIndex >= 0 ? selectedIndex + 1 : 0}/${cycleEntries.length}`;
}

export function getTextEntryHistoryCursorEntry(
	cycleEntries: readonly TextEntryHistoryEntry[],
	selectedEntryId: string | null | undefined,
	direction: TextEntryHistoryCursorDirection,
): TextEntryHistoryEntry | undefined {
	if (cycleEntries.length === 0) return undefined;
	const selectedIndex = getTextEntryHistoryCursorIndex(
		cycleEntries,
		selectedEntryId,
	);
	const nextIndex =
		selectedIndex < 0
			? direction === 'previous'
				? 0
				: cycleEntries.length - 1
			: direction === 'previous'
				? (selectedIndex + 1) % cycleEntries.length
				: (selectedIndex - 1 + cycleEntries.length) % cycleEntries.length;
	return cycleEntries[nextIndex];
}
