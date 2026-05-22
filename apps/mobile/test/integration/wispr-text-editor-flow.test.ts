import assert from 'node:assert/strict';
import test from 'node:test';

import {
	canStartWisprTextEntryAutomation,
	resolveWisprAutoCloseOnTextEntryClose,
	resolveWisprPendingAutoCloseRequests,
	resolveTextEntryWisprControl,
	resolveWisprTextEditorAvailability,
} from '../../src/lib/wispr-text-editor-flow';

void test('disabled Wispr service keeps text editor usable without opening settings', () => {
	const result = resolveWisprTextEditorAvailability({
		serviceEnabled: false,
		serviceConnected: false,
	});

	assert.deepEqual(result, {
		type: 'setup-required',
		reason: 'service-disabled',
		message: 'Wispr automation is disabled. Text entry is still available.',
		openAccessibilitySettings: false,
	});
});

void test('connected Wispr service starts automation', () => {
	const result = resolveWisprTextEditorAvailability({
		serviceEnabled: true,
		serviceConnected: true,
	});

	assert.deepEqual(result, { type: 'ready' });
});

void test('text entry shows disabled Wispr as compact setup pill', () => {
	const control = resolveTextEntryWisprControl({
		availability: {
			type: 'setup-required',
			reason: 'service-disabled',
			message: 'Wispr automation is disabled. Text entry is still available.',
			openAccessibilitySettings: false,
		},
		autoStartEnabled: false,
	});

	assert.deepEqual(control, {
		type: 'setup-pill',
		label: 'Wispr disabled',
	});
});

void test('text entry shows ready Wispr as session auto-start switch', () => {
	const control = resolveTextEntryWisprControl({
		availability: { type: 'ready' },
		autoStartEnabled: true,
	});

	assert.deepEqual(control, {
		type: 'switch',
		label: 'Wispr',
		enabled: true,
	});
});

void test('text entry shows compact disabled pill after Wispr automation failure', () => {
	const control = resolveTextEntryWisprControl({
		availability: { type: 'ready' },
		autoStartEnabled: true,
		automationState: {
			phase: 'failed',
			reason: 'bubble-not-found',
			message: 'Wispr bubble not found.',
		},
	});

	assert.deepEqual(control, {
		type: 'setup-pill',
		label: 'Wispr disabled',
	});
});

void test('text entry close auto-closes Wispr only for its auto-start request', () => {
	assert.deepEqual(
		resolveWisprAutoCloseOnTextEntryClose({
			autoStartedRequestId: 7,
			automationState: {
				phase: 'recording',
				textBeforeStart: '',
			},
		}),
		{ type: 'close-now' },
	);

	assert.deepEqual(
		resolveWisprAutoCloseOnTextEntryClose({
			autoStartedRequestId: null,
			automationState: {
				phase: 'recording',
				textBeforeStart: '',
			},
		}),
		{ type: 'none' },
	);
});

void test('text entry close still auto-closes after dictation moved automation back to idle', () => {
	assert.deepEqual(
		resolveWisprAutoCloseOnTextEntryClose({
			autoStartedRequestId: 7,
			automationState: { phase: 'idle' },
		}),
		{ type: 'close-now' },
	);
});

void test('text entry close does not auto-close Wispr after failed automation', () => {
	assert.deepEqual(
		resolveWisprAutoCloseOnTextEntryClose({
			autoStartedRequestId: 7,
			automationState: {
				phase: 'failed',
				reason: 'bubble-not-found',
				message: 'Wispr bubble not found.',
			},
		}),
		{ type: 'none' },
	);
});

void test('text entry close waits after a timed-out start failure', () => {
	assert.deepEqual(
		resolveWisprAutoCloseOnTextEntryClose({
			autoStartedRequestId: 7,
			controlTapStartedRequestId: 7,
			timedOutStartRequestId: 7,
			automationState: {
				phase: 'failed',
				reason: 'bubble-not-found',
				message: 'Wispr bubble not found.',
			},
		}),
		{ type: 'close-after-start', requestId: 7 },
	);

	assert.deepEqual(
		resolveWisprAutoCloseOnTextEntryClose({
			autoStartedRequestId: 7,
			timedOutStartRequestId: 8,
			automationState: {
				phase: 'failed',
				reason: 'bubble-not-found',
				message: 'Wispr bubble not found.',
			},
		}),
		{ type: 'none' },
	);
});

void test('text entry close waits for an in-flight start tap before auto-closing', () => {
	assert.deepEqual(
		resolveWisprAutoCloseOnTextEntryClose({
			autoStartedRequestId: 7,
			controlTapStartedRequestId: 7,
			automationState: {
				phase: 'waitingForBubble',
				textBeforeStart: '',
			},
		}),
		{ type: 'close-after-start', requestId: 7 },
	);
});

void test('text entry close skips auto-close before Wispr control tap starts', () => {
	assert.deepEqual(
		resolveWisprAutoCloseOnTextEntryClose({
			autoStartedRequestId: 7,
			controlTapStartedRequestId: null,
			automationState: {
				phase: 'waitingForBubble',
				textBeforeStart: '',
			},
		}),
		{ type: 'none' },
	);

	assert.deepEqual(
		resolveWisprAutoCloseOnTextEntryClose({
			autoStartedRequestId: 8,
			controlTapStartedRequestId: 7,
			automationState: {
				phase: 'waitingForBubble',
				textBeforeStart: '',
			},
		}),
		{ type: 'none' },
	);
});

void test('text entry close skips auto-close before a start tap can be in flight', () => {
	assert.deepEqual(
		resolveWisprAutoCloseOnTextEntryClose({
			autoStartedRequestId: 7,
			automationState: { phase: 'openingTextEntry' },
		}),
		{ type: 'none' },
	);
});

void test('no-op closes preserve existing pending Wispr close requests', () => {
	assert.deepEqual(
		resolveWisprPendingAutoCloseRequests({
			pendingRequests: [{ requestId: 7, retryClose: true }],
			decision: { type: 'none' },
			retryClose: true,
		}),
		{
			pendingRequests: [{ requestId: 7, retryClose: true }],
			closeNow: false,
		},
	);
});

void test('text entry close records in-flight Wispr starts without clearing older pending closes', () => {
	assert.deepEqual(
		resolveWisprPendingAutoCloseRequests({
			pendingRequests: [{ requestId: 7, retryClose: true }],
			decision: { type: 'close-after-start', requestId: 8 },
			retryClose: false,
		}),
		{
			pendingRequests: [
				{ requestId: 7, retryClose: true },
				{ requestId: 8, retryClose: false },
			],
			closeNow: false,
		},
	);
});

void test('text entry close updates retry policy for an existing pending Wispr close', () => {
	assert.deepEqual(
		resolveWisprPendingAutoCloseRequests({
			pendingRequests: [{ requestId: 7, retryClose: true }],
			decision: { type: 'close-after-start', requestId: 7 },
			retryClose: false,
		}),
		{
			pendingRequests: [{ requestId: 7, retryClose: false }],
			closeNow: false,
		},
	);
});

void test('immediate Wispr close leaves unrelated pending close requests intact', () => {
	assert.deepEqual(
		resolveWisprPendingAutoCloseRequests({
			pendingRequests: [{ requestId: 7, retryClose: true }],
			decision: { type: 'close-now' },
			retryClose: true,
		}),
		{
			pendingRequests: [{ requestId: 7, retryClose: true }],
			closeNow: true,
		},
	);
});

void test('Wispr auto-start waits for older pending auto-close requests to settle', () => {
	assert.equal(
		canStartWisprTextEntryAutomation({
			closeInFlight: false,
			pendingRequests: [],
		}),
		true,
	);

	assert.equal(
		canStartWisprTextEntryAutomation({
			closeInFlight: false,
			pendingRequests: [{ requestId: 7, retryClose: true }],
		}),
		false,
	);

	assert.equal(
		canStartWisprTextEntryAutomation({
			closeInFlight: true,
			pendingRequests: [],
		}),
		false,
	);
});
