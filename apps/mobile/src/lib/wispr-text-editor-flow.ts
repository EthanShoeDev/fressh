import { type WisprAutomationState } from '@/lib/wispr-automation-state';

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

export type TextEntryWisprControl =
	| {
			type: 'switch';
			label: 'Wispr';
			enabled: boolean;
	  }
	| {
			type: 'setup-pill';
			label: 'Wispr disabled';
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

export function resolveTextEntryWisprControl({
	availability,
	autoStartEnabled,
	automationState,
}: {
	availability: WisprTextEditorAvailability;
	autoStartEnabled: boolean;
	automationState?: WisprAutomationState;
}): TextEntryWisprControl {
	if (automationState?.phase === 'failed') {
		return {
			type: 'setup-pill',
			label: 'Wispr disabled',
		};
	}

	if (availability.type === 'ready') {
		return {
			type: 'switch',
			label: 'Wispr',
			enabled: autoStartEnabled,
		};
	}

	return {
		type: 'setup-pill',
		label: 'Wispr disabled',
	};
}
