import { rootLogger } from './logger';

const logger = rootLogger.extend('AgentNotifications');

type AgentNotificationsNativeModule = {
	postAgentAlert?: (
		notificationId: number,
		title: string,
		message: string,
		connectionId: string,
		channelId: number,
		notificationConnectionId: string,
		session: string,
		target: string,
		windowId: string,
		eventId: string,
		tapToken: string,
		vibrate: boolean,
	) => Promise<void>;
	cancelAgentAlert?: (notificationId: number) => Promise<void>;
};

export type AgentAlertNotificationInput = {
	notificationId: number;
	title: string;
	message: string;
	connectionId: string;
	channelId: number;
	notificationConnectionId: string;
	session: string;
	target: string;
	windowId: string;
	eventId: string;
	tapToken: string;
	vibrate: boolean;
};

type AgentNotificationsLogger = {
	warn: (message: string, ...args: unknown[]) => void;
};

type AgentNotificationsNativeDependencies = {
	getPlatformOS: () => string;
	getNativeModule: () => AgentNotificationsNativeModule | undefined;
	ensureNotificationPermission: () => Promise<boolean>;
	logger: AgentNotificationsLogger;
};

export function createAgentNotificationsNativeWrapper({
	getPlatformOS,
	getNativeModule,
	ensureNotificationPermission,
	logger,
}: AgentNotificationsNativeDependencies) {
	return {
		async postAgentAlertNotification(input: AgentAlertNotificationInput) {
			if (getPlatformOS() !== 'android') return false;
			const nativeModule = getNativeModule();
			if (!nativeModule) return false;
			if (typeof nativeModule.postAgentAlert !== 'function') {
				logger.warn('agent alert notification post unavailable');
				return false;
			}
			const allowed = await ensureNotificationPermission();
			if (!allowed) {
				logger.warn(
					'notification permission not granted; skipping agent alert',
				);
				return false;
			}
			try {
				await nativeModule.postAgentAlert(
					input.notificationId,
					input.title,
					input.message,
					input.connectionId,
					input.channelId,
					input.notificationConnectionId,
					input.session,
					input.target,
					input.windowId,
					input.eventId,
					input.tapToken,
					input.vibrate,
				);
				return true;
			} catch (error) {
				logger.warn('agent alert notification post failed', error);
				return false;
			}
		},
		async cancelAgentAlertNotification(notificationId: number) {
			if (getPlatformOS() !== 'android') return false;
			const nativeModule = getNativeModule();
			if (!nativeModule) return false;
			if (typeof nativeModule.cancelAgentAlert !== 'function') {
				logger.warn('agent alert notification cancel unavailable');
				return false;
			}
			try {
				await nativeModule.cancelAgentAlert(notificationId);
				return true;
			} catch (error) {
				logger.warn('agent alert notification cancel failed', error);
				return false;
			}
		},
	};
}

async function loadDefaultAgentNotificationWrapper() {
	const [{ NativeModules, Platform }, { ensureNotificationPermission }] =
		await Promise.all([import('react-native'), import('./foreground-service')]);
	return createAgentNotificationsNativeWrapper({
		getPlatformOS: () => Platform.OS,
		getNativeModule: () =>
			NativeModules.FresshForegroundService as
				| AgentNotificationsNativeModule
				| undefined,
		ensureNotificationPermission,
		logger,
	});
}

export async function postAgentAlertNotification(
	input: AgentAlertNotificationInput,
) {
	try {
		const wrapper = await loadDefaultAgentNotificationWrapper();
		return await wrapper.postAgentAlertNotification(input);
	} catch (error) {
		logger.warn('agent alert notification wrapper load failed', error);
		return false;
	}
}

export async function cancelAgentAlertNotification(notificationId: number) {
	try {
		const wrapper = await loadDefaultAgentNotificationWrapper();
		return await wrapper.cancelAgentAlertNotification(notificationId);
	} catch (error) {
		logger.warn('agent alert notification wrapper load failed', error);
		return false;
	}
}
