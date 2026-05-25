export type ForegroundServiceNativeModule = {
	start: (title: string, message: string) => Promise<void>;
	stop?: () => Promise<void>;
	isRunning?: () => Promise<boolean>;
};

type ForegroundServiceLogger = {
	warn: (message: string, ...args: unknown[]) => void;
};

type ForegroundServiceDependencies = {
	getPlatformOS: () => string;
	getNativeModule: () => ForegroundServiceNativeModule | undefined;
	ensureNotificationPermission: () => Promise<boolean>;
	logger: ForegroundServiceLogger;
};

export function createForegroundServiceStarter({
	getPlatformOS,
	getNativeModule,
	ensureNotificationPermission,
	logger,
}: ForegroundServiceDependencies) {
	return {
		async startForegroundService(opts?: { title?: string; message?: string }) {
			if (getPlatformOS() !== 'android') return false;
			const nativeModule = getNativeModule();
			if (!nativeModule) return false;
			const allowed = await ensureNotificationPermission();
			if (!allowed) {
				logger.warn('notification permission not granted; continuing anyway');
			}
			const title = opts?.title ?? 'Fressh Terminal';
			const message = opts?.message ?? 'Keeping SSH connection alive';
			try {
				await nativeModule.start(title, message);
				return true;
			} catch (error) {
				logger.warn('foreground service start failed', error);
				return false;
			}
		},
		async stopForegroundService() {
			if (getPlatformOS() !== 'android') return false;
			const nativeModule = getNativeModule();
			if (!nativeModule?.stop) return false;
			try {
				await nativeModule.stop();
				return true;
			} catch (error) {
				logger.warn('foreground service stop failed', error);
				return false;
			}
		},
		async isForegroundServiceRunning() {
			if (getPlatformOS() !== 'android') return false;
			const nativeModule = getNativeModule();
			if (!nativeModule) return false;
			if (!nativeModule.isRunning) return true;
			try {
				return await nativeModule.isRunning();
			} catch (error) {
				logger.warn('foreground service running check failed', error);
				return false;
			}
		},
	};
}
