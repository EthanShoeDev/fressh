const encoder = new TextEncoder();

export type TerminalInputPastePayload = {
	segments: Uint8Array<ArrayBuffer>[];
	historyText: string | null;
};

export function buildTextEntryPasteSegments(
	value: string,
): Uint8Array<ArrayBuffer>[] {
	if (!value) return [];
	return [encoder.encode(value), encoder.encode('\r')];
}

export function buildTextEntryPastePayload(
	value: string,
): TerminalInputPastePayload {
	const segments = buildTextEntryPasteSegments(value);
	return {
		segments,
		historyText: segments.length ? value : null,
	};
}

export function buildClipboardPasteSegments(
	value: string,
): Uint8Array<ArrayBuffer>[] {
	if (!value) return [];
	return [encoder.encode(value)];
}

export function buildClipboardPastePayload(
	value: string,
): TerminalInputPastePayload {
	return {
		segments: buildClipboardPasteSegments(value),
		historyText: null,
	};
}

export function buildCommanderExecuteSegments(
	value: string,
): Uint8Array<ArrayBuffer>[] {
	if (!value.trim()) return [];
	return [encoder.encode(value), encoder.encode('\r')];
}
