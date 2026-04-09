export function getInitialSelectedKeyId(
	keys: Array<{ id: string; metadata: { isDefault?: boolean } }>,
	currentValue: string,
) {
	if (currentValue) return currentValue;
	return keys.find((key) => key.metadata.isDefault)?.id ?? keys[0]?.id ?? '';
}

export function getEmptyKeyPickerMessage() {
	return 'Open Security Center to add or manage a key';
}
