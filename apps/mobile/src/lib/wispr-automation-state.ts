export type WisprAutomationFailureReason =
	| 'service-disabled'
	| 'bubble-not-found'
	| 'tap-failed'
	| 'unsupported-platform';

export type WisprAutomationState =
	| { phase: 'idle' }
	| { phase: 'openingTextEntry' }
	| { phase: 'waitingForBubble'; textBeforeStart: string }
	| { phase: 'recording'; textBeforeStart: string }
	| {
			phase: 'failed';
			reason: WisprAutomationFailureReason;
			message: string;
	  };

export type WisprAutomationEvent =
	| { type: 'press' }
	| { type: 'textEntryFocused'; textBeforeStart: string }
	| { type: 'wisprTapSucceeded' }
	| { type: 'textChanged'; value: string }
	| {
			type: 'failed';
			reason: WisprAutomationFailureReason;
			message: string;
	  }
	| { type: 'reset' };

export function reduceWisprAutomationState(
	state: WisprAutomationState,
	event: WisprAutomationEvent,
): WisprAutomationState {
	if (event.type === 'reset') return { phase: 'idle' };
	if (event.type === 'failed') {
		return {
			phase: 'failed',
			reason: event.reason,
			message: event.message,
		};
	}

	switch (state.phase) {
		case 'idle':
			if (event.type === 'press') return { phase: 'openingTextEntry' };
			return state;

		case 'failed':
			if (event.type === 'press') return { phase: 'openingTextEntry' };
			return state;

		case 'openingTextEntry':
			if (event.type === 'textEntryFocused') {
				return {
					phase: 'waitingForBubble',
					textBeforeStart: event.textBeforeStart,
				};
			}
			return state;

		case 'waitingForBubble':
			if (event.type === 'wisprTapSucceeded') {
				return {
					phase: 'recording',
					textBeforeStart: state.textBeforeStart,
				};
			}
			return state;

		case 'recording':
			if (
				event.type === 'textChanged' &&
				event.value !== state.textBeforeStart
			) {
				return { phase: 'idle' };
			}
			return state;

		default:
			return state;
	}
}

export function isWisprAutomationBusy(state: WisprAutomationState): boolean {
	return state.phase !== 'idle' && state.phase !== 'failed';
}
