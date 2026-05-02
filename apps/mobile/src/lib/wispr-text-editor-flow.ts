export type WisprTextEditorAvailability =
	| { type: 'ready' }
	| {
			type: 'setup-required';
			reason: 'service-disabled';
			message: string;
			openAccessibilitySettings: false;
	  };

export type WisprTextEditorStatus = {
	serviceEnabled: boolean;
	serviceConnected: boolean;
};

export function resolveWisprTextEditorAvailability(
	status: WisprTextEditorStatus,
): WisprTextEditorAvailability {
	if (status.serviceEnabled && status.serviceConnected) {
		return { type: 'ready' };
	}

	return {
		type: 'setup-required',
		reason: 'service-disabled',
		message: 'Wispr automation is disabled. Text entry is still available.',
		openAccessibilitySettings: false,
	};
}
