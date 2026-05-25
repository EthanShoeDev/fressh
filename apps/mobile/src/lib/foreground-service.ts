import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import {
	createForegroundServiceStarter,
	type ForegroundServiceNativeModule,
} from './foreground-service-core';
import { rootLogger } from './logger';

const logger = rootLogger.extend('ForegroundService');

const nativeForegroundService = NativeModules.FresshForegroundService as
	| ForegroundServiceNativeModule
	| undefined;

let didRequestNotificationPermission = false;

export async function ensureNotificationPermission() {
	if (Platform.OS !== 'android') return true;
	if (typeof Platform.Version === 'number' && Platform.Version < 33)
		return true;
	try {
		const granted = await PermissionsAndroid.check(
			PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
		);
		if (granted) return true;
		if (didRequestNotificationPermission) return false;
		didRequestNotificationPermission = true;
		const result = await PermissionsAndroid.request(
			PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
		);
		return result === PermissionsAndroid.RESULTS.GRANTED;
	} catch (error) {
		logger.warn('notification permission check failed', error);
		return false;
	}
}

export async function startForegroundServiceAndReport(opts?: {
	title?: string;
	message?: string;
}): Promise<boolean> {
	return await foregroundService.startForegroundService(opts);
}

export async function startForegroundService(opts?: {
	title?: string;
	message?: string;
}): Promise<void> {
	await startForegroundServiceAndReport(opts);
}

export async function stopForegroundServiceAndReport(): Promise<boolean> {
	return await foregroundService.stopForegroundService();
}

export async function stopForegroundService(): Promise<void> {
	await stopForegroundServiceAndReport();
}

export async function isForegroundServiceRunning(): Promise<boolean> {
	return await foregroundService.isForegroundServiceRunning();
}

const foregroundService = createForegroundServiceStarter({
	getPlatformOS: () => Platform.OS,
	getNativeModule: () => nativeForegroundService,
	ensureNotificationPermission,
	logger,
});
