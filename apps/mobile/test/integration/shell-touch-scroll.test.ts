import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveShellTouchScrollPolicy } from '../../src/app/shell/shell-touch-scroll';

void test('remote touch scroll owns the viewport only for connected Android tablet tmux sessions', () => {
	const connectedAndroidTablet = resolveShellTouchScrollPolicy({
		platformOS: 'android',
		width: 800,
		height: 1280,
		tmuxEnabled: true,
		hasConnection: true,
		scrollTraceEnabled: false,
		debug: false,
	});

	assert.equal(connectedAndroidTablet.ownsViewport, true);

	for (const input of [
		{ platformOS: 'ios', width: 800, height: 1280 },
		{ platformOS: 'android', width: 599, height: 1280 },
		{ platformOS: 'android', width: 800, height: 1280, tmuxEnabled: false },
		{ platformOS: 'android', width: 800, height: 1280, hasConnection: false },
	]) {
		assert.equal(
			resolveShellTouchScrollPolicy({
				platformOS: input.platformOS,
				width: input.width,
				height: input.height,
				tmuxEnabled: input.tmuxEnabled ?? true,
				hasConnection: input.hasConnection ?? true,
				scrollTraceEnabled: false,
				debug: false,
			}).ownsViewport,
			false,
		);
	}
});

void test('shell touch scroll policy derives WebView config and xterm scrollback from viewport ownership', () => {
	const owned = resolveShellTouchScrollPolicy({
		platformOS: 'android',
		width: 800,
		height: 1280,
		tmuxEnabled: true,
		hasConnection: true,
		scrollTraceEnabled: true,
		debug: true,
	});

	assert.equal(owned.xtermScrollback, 0);
	assert.deepEqual(owned.touchScrollConfig, {
		enabled: true,
		pxPerLine: 10,
		slopPx: 10,
		maxLinesPerFrame: 12,
		flickVelocity: 1.2,
		coalesceMs: 24,
		minFlushMs: 16,
		maxFlushMs: 80,
		maxPagesPerFlush: 12,
		maxExtraLines: 999,
		maxBacklogPages: 50,
		velocityMultiplierEnabled: true,
		velocityThreshold: 0.3,
		velocityBoost: 2.5,
		velocityBoostMax: 20,
		velocitySmoothing: 0.2,
		backlogMultiplierEnabled: true,
		backlogBoostRefPages: 2,
		backlogBoostMax: 2,
		rttEwmaAlpha: 0.2,
		debug: true,
		debugOverlay: false,
		debugTelemetry: true,
		debugTelemetryIntervalMs: 120,
	});

	const notOwned = resolveShellTouchScrollPolicy({
		platformOS: 'android',
		width: 599,
		height: 1280,
		tmuxEnabled: true,
		hasConnection: true,
		scrollTraceEnabled: true,
		debug: true,
	});

	assert.equal(notOwned.xtermScrollback, 10000);
	assert.deepEqual(notOwned.touchScrollConfig, { enabled: false });
});
