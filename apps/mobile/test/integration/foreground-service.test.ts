import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldStartForegroundService } from '../../src/lib/agent-notification-runtime';
import { createForegroundServiceStarter } from '../../src/lib/foreground-service-core';

void test('foreground service restart is required when liveness flips to stopped', () => {
	const key = 'Fressh Terminal|Connected';

	assert.equal(
		shouldStartForegroundService({
			currentKey: key,
			nextKey: key,
			foregroundServiceStarted: true,
		}),
		false,
	);
	assert.equal(
		shouldStartForegroundService({
			currentKey: key,
			nextKey: key,
			foregroundServiceStarted: false,
		}),
		true,
	);
});

void test('foreground service starter reports native start success', async () => {
	const calls: [string, string][] = [];
	const starter = createForegroundServiceStarter({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			start: async (title, message) => {
				calls.push([title, message]);
			},
		}),
		ensureNotificationPermission: async () => true,
		logger: { warn: () => {} },
	});

	const started = await starter.startForegroundService({
		title: 'Terminal',
		message: 'Connected',
	});

	assert.equal(started, true);
	assert.deepEqual(calls, [['Terminal', 'Connected']]);
});

void test('foreground service starter continues after notification permission denial', async () => {
	const calls: [string, string][] = [];
	const warnings: unknown[][] = [];
	const starter = createForegroundServiceStarter({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			start: async (title, message) => {
				calls.push([title, message]);
			},
		}),
		ensureNotificationPermission: async () => false,
		logger: { warn: (...args) => warnings.push(args) },
	});

	const started = await starter.startForegroundService({
		title: 'Terminal',
		message: 'Connected',
	});

	assert.equal(started, true);
	assert.deepEqual(calls, [['Terminal', 'Connected']]);
	assert.deepEqual(warnings, [
		['notification permission not granted; continuing anyway'],
	]);
});

void test('foreground service starter reports native running state', async () => {
	const starter = createForegroundServiceStarter({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			start: async () => {},
			isRunning: async () => true,
		}),
		ensureNotificationPermission: async () => true,
		logger: { warn: () => {} },
	});

	assert.equal(await starter.isForegroundServiceRunning(), true);
});

void test('foreground service starter treats missing running probe as compatible', async () => {
	const starter = createForegroundServiceStarter({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			start: async () => {},
		}),
		ensureNotificationPermission: async () => true,
		logger: { warn: () => {} },
	});

	assert.equal(await starter.isForegroundServiceRunning(), true);
});

void test('foreground service starter reports native start failure', async () => {
	const error = new Error('start rejected');
	const warnings: unknown[][] = [];
	const starter = createForegroundServiceStarter({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			start: async () => {
				throw error;
			},
		}),
		ensureNotificationPermission: async () => true,
		logger: { warn: (...args) => warnings.push(args) },
	});

	const started = await starter.startForegroundService();

	assert.equal(started, false);
	assert.deepEqual(warnings, [['foreground service start failed', error]]);
});

void test('foreground service starter does not claim background coverage without native module', async () => {
	const starter = createForegroundServiceStarter({
		getPlatformOS: () => 'android',
		getNativeModule: () => undefined,
		ensureNotificationPermission: async () => true,
		logger: { warn: () => {} },
	});

	assert.equal(await starter.startForegroundService(), false);
});

void test('foreground service starter skips stop outside Android or without native stop', async () => {
	const nonAndroidStarter = createForegroundServiceStarter({
		getPlatformOS: () => 'ios',
		getNativeModule: () => ({
			start: async () => {},
			stop: async () => {
				throw new Error('should not stop on ios');
			},
		}),
		ensureNotificationPermission: async () => true,
		logger: { warn: () => {} },
	});
	const missingStopStarter = createForegroundServiceStarter({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			start: async () => {},
		}),
		ensureNotificationPermission: async () => true,
		logger: { warn: () => {} },
	});

	assert.equal(await nonAndroidStarter.stopForegroundService(), false);
	assert.equal(await missingStopStarter.stopForegroundService(), false);
});

void test('foreground service starter reports native stop success and failure', async () => {
	let stopCalls = 0;
	const successStarter = createForegroundServiceStarter({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			start: async () => {},
			stop: async () => {
				stopCalls += 1;
			},
		}),
		ensureNotificationPermission: async () => true,
		logger: { warn: () => {} },
	});
	const error = new Error('stop rejected');
	const warnings: unknown[][] = [];
	const failureStarter = createForegroundServiceStarter({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			start: async () => {},
			stop: async () => {
				throw error;
			},
		}),
		ensureNotificationPermission: async () => true,
		logger: { warn: (...args) => warnings.push(args) },
	});

	assert.equal(await successStarter.stopForegroundService(), true);
	assert.equal(stopCalls, 1);
	assert.equal(await failureStarter.stopForegroundService(), false);
	assert.deepEqual(warnings, [['foreground service stop failed', error]]);
});
