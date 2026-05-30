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
