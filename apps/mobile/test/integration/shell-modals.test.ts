import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupBrowserActionRequests } from '../../src/lib/browser-actions-request-cleanup';
import {
	createHostDiffityRequestController,
	type HostDiffityRequestController,
} from '../../src/lib/host-diffity-request-controller';
import { type RequestIdHandle } from '../../src/lib/request-id';

const createRequestId = (): RequestIdHandle => {
	let current = 0;
	return {
		next: () => {
			current += 1;
			return current;
		},
		isCurrent: (id) => id === current,
		invalidate: () => {
			current += 1;
		},
	};
};

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

void test('stale Diffity completion cannot clear a newer in-flight request', async () => {
	const requestId = createRequestId();
	const inFlightRef = { current: false };
	const controller: HostDiffityRequestController =
		createHostDiffityRequestController({
			requestId,
			inFlightRef,
		});
	const first = controller.start();
	assert.equal(first, 1);
	assert.equal(inFlightRef.current, true);

	requestId.invalidate();
	inFlightRef.current = false;
	assert.equal(inFlightRef.current, false);

	const second = controller.start();
	assert.equal(second, 3);
	assert.equal(inFlightRef.current, true);

	controller.finish(first);
	assert.equal(inFlightRef.current, true);

	assert.equal(controller.start(), null);
	controller.finish(second);
	assert.equal(inFlightRef.current, false);
	assert.equal(controller.start(), 4);
});
