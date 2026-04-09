export function getInitialSelectedKeyId(params: {
	keys?: { id: string; metadata: { isDefault?: boolean } }[];
	currentValue: string;
	hasLoadedKeys: boolean;
}) {
	const { keys, currentValue, hasLoadedKeys } = params;

	if (!hasLoadedKeys) return currentValue;

	if (keys?.some((key) => key.id === currentValue)) return currentValue;

	return keys?.find((key) => key.metadata.isDefault)?.id ?? keys?.[0]?.id ?? '';
}

export function getKeyPickerViewState(params: {
	keys?: { id: string; metadata: { isDefault?: boolean; label?: string } }[];
	currentValue: string;
	hasLoadedKeys: boolean;
}) {
	const selectedId = getInitialSelectedKeyId(params);

	if (!params.hasLoadedKeys) {
		return {
			selectedId,
			display: params.currentValue || 'Loading...',
			showEmptyState: false,
		};
	}

	const selectedKey = params.keys?.find((key) => key.id === selectedId);

	return {
		selectedId,
		display: selectedKey ? (selectedKey.metadata.label ?? selectedKey.id) : 'None',
		showEmptyState: !selectedKey,
	};
}

export function getEmptyKeyPickerMessage() {
	return 'Open Security Center to add or manage a key';
}
