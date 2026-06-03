import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupBrowserActionRequests } from '../../src/lib/browser-actions-request-cleanup';
import { type RequestIdHandle } from '../../src/lib/request-id';

void test('browser action request cleanup invalidates browser action requests', () => {
	const events: string[] = [];
	const requestId = (name: string): RequestIdHandle => ({
		next: () => 0,
		isCurrent: () => false,
		invalidate: () => events.push(`invalidate:${name}`),
	});
	const inFlightRefs = {
		hostUrlSubmit: { current: true },
		hostDiffity: { current: true },
		hostDetectedOpen: { current: true },
	};

	cleanupBrowserActionRequests({
		hostUrlReadRequestId: requestId('hostUrlRead'),
		hostUrlSubmitRequestId: requestId('hostUrlSubmit'),
		hostUrlSubmitInFlightRef: inFlightRefs.hostUrlSubmit,
		browserGitHubTargetRequestId: requestId('browserGitHubTarget'),
		hostDiffityRequestId: requestId('hostDiffity'),
		hostDiffityInFlightRef: inFlightRefs.hostDiffity,
		hostDetectedOpenRequestId: requestId('hostDetectedOpen'),
		hostDetectedOpenInFlightRef: inFlightRefs.hostDetectedOpen,
	});

	assert.deepEqual(events, [
		'invalidate:hostUrlRead',
		'invalidate:hostUrlSubmit',
		'invalidate:browserGitHubTarget',
		'invalidate:hostDiffity',
		'invalidate:hostDetectedOpen',
	]);
	assert.equal(inFlightRefs.hostUrlSubmit.current, false);
	assert.equal(inFlightRefs.hostDiffity.current, false);
	assert.equal(inFlightRefs.hostDetectedOpen.current, false);
});
