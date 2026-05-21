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

export type WisprAutoCloseDecision =
	| { type: 'none' }
	| { type: 'close-now' }
	| { type: 'close-after-start'; requestId: number };

export type WisprPendingAutoCloseRequest = {
	requestId: number;
	retryClose: boolean;
};

export type WisprPendingAutoCloseRequestResolution = {
	pendingRequests: WisprPendingAutoCloseRequest[];
	closeNow: boolean;
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

export function resolveWisprAutoCloseOnTextEntryClose({
	autoStartedRequestId,
	automationState,
	controlTapStartedRequestId,
	timedOutStartRequestId,
}: {
	autoStartedRequestId: number | null;
	automationState: WisprAutomationState;
	controlTapStartedRequestId?: number | null;
	timedOutStartRequestId?: number | null;
}): WisprAutoCloseDecision {
	const noClose = { type: 'none' } as const;
	if (autoStartedRequestId == null) return noClose;

	if (
		automationState.phase === 'waitingForBubble' &&
		controlTapStartedRequestId === autoStartedRequestId
	) {
		return {
			type: 'close-after-start',
			requestId: autoStartedRequestId,
		};
	}

	if (
		automationState.phase === 'failed' &&
		timedOutStartRequestId === autoStartedRequestId
	) {
		return {
			type: 'close-after-start',
			requestId: autoStartedRequestId,
		};
	}

	if (
		automationState.phase === 'idle' ||
		automationState.phase === 'recording'
	) {
		return {
			type: 'close-now',
		};
	}

	return noClose;
}

export function resolveWisprPendingAutoCloseRequests({
	pendingRequests,
	decision,
	retryClose,
}: {
	pendingRequests: readonly WisprPendingAutoCloseRequest[];
	decision: WisprAutoCloseDecision;
	retryClose: boolean;
}): WisprPendingAutoCloseRequestResolution {
	const closeAfterStartRequestId =
		decision.type === 'close-after-start' ? decision.requestId : null;
	const nextRequests = pendingRequests.filter(
		(request) => request.requestId !== closeAfterStartRequestId,
	);

	if (closeAfterStartRequestId != null) {
		nextRequests.push({
			requestId: closeAfterStartRequestId,
			retryClose,
		});
	}

	return {
		pendingRequests: nextRequests,
		closeNow: decision.type === 'close-now',
	};
}

export function canStartWisprTextEntryAutomation({
	closeInFlight,
	pendingRequests,
}: {
	closeInFlight: boolean;
	pendingRequests: readonly WisprPendingAutoCloseRequest[];
}): boolean {
	return !closeInFlight && pendingRequests.length === 0;
}
