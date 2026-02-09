import { usePathname, useRouter } from 'expo-router';
import React from 'react';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { pickLatestConnection } from './connection-utils';
import {
	startForegroundService,
	stopForegroundService,
} from './foreground-service';
import { rootLogger } from './logger';
import { connectAndOpenShell } from './query-fns';
import {
	secretsManager,
	type InputConnectionDetails,
	type StoredConnectionDetails,
} from './secrets-manager';
import { useSshStore } from './ssh-store';
import { queryClient } from './utils';

const logger = rootLogger.extend('AutoConnect');
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000];

type AutoConnectState = {
	isAutoConnecting: boolean;
	isReconnecting: boolean;
	setAutoConnecting: (next: boolean) => void;
	setReconnecting: (next: boolean) => void;
};

export const useAutoConnectStore = create<AutoConnectState>((set) => ({
	isAutoConnecting: false,
	isReconnecting: false,
	setAutoConnecting: (next) => set({ isAutoConnecting: next }),
	setReconnecting: (next) => set({ isReconnecting: next }),
}));

const isActiveState = (state: string) => state === 'active';

// Auto-connect only supports key-based connections.
async function resolveKeySecurity(details: StoredConnectionDetails) {
	try {
		const keyEntry = await secretsManager.keys.utils.getPrivateKey(
			details.security.keyId,
		);
		return {
			type: 'key' as const,
			privateKey: keyEntry.value,
		};
	} catch (error) {
		logger.info('Auto-connect skipped, key missing', error);
		return null;
	}
}

export function AutoConnectManager() {
	const router = useRouter();
	const pathname = usePathname();
	const connect = useSshStore((s) => s.connect);
	const shells = useSshStore(useShallow((s) => Object.values(s.shells)));
	const connections = useSshStore((s) => s.connections);
	const latestShell = React.useMemo(() => {
		if (shells.length === 0) return null;
		return shells.reduce((latest, shell) =>
			shell.createdAtMs > latest.createdAtMs ? shell : latest,
		);
	}, [shells]);

	const {
		isAutoConnecting,
		isReconnecting,
		setAutoConnecting,
		setReconnecting,
	} = useAutoConnectStore(
		useShallow((s) => ({
			isAutoConnecting: s.isAutoConnecting,
			isReconnecting: s.isReconnecting,
			setAutoConnecting: s.setAutoConnecting,
			setReconnecting: s.setReconnecting,
		})),
	);

	const inFlightRef = React.useRef(false);
	const reconnectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const prevShellCountRef = React.useRef(shells.length);
	const isActiveRef = React.useRef(isActiveState(AppState.currentState));
	const foregroundKeyRef = React.useRef<string | null>(null);
	const allowBackgroundRef = React.useRef(false);
	const didInitRef = React.useRef(false);

	const clearReconnectTimer = React.useCallback(() => {
		if (reconnectTimerRef.current) {
			clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}
	}, []);

	// Always replace to avoid stacking repeated resumes in history.
	const navigateToShell = React.useCallback(
		(connectionId: string, channelId: number) => {
			router.replace({
				pathname: '/shell/detail',
				params: { connectionId, channelId },
			});
		},
		[router],
	);

	const loadLatestSavedConnection = React.useCallback(async () => {
		const entries = await queryClient.fetchQuery(
			secretsManager.connections.query.list,
		);
		const eligible = entries?.filter((entry) => entry.value.autoConnect);
		return pickLatestConnection(eligible);
	}, []);

	// Single attempt: use an active shell if present; otherwise connect silently.
	const attemptAutoConnect = React.useCallback(async () => {
		if (inFlightRef.current) return false;
		inFlightRef.current = true;
		setAutoConnecting(true);

		try {
			if (latestShell) {
				// Avoid re-mounting the terminal if we're already on the detail screen.
				if (pathname !== '/shell/detail') {
					navigateToShell(latestShell.connectionId, latestShell.channelId);
				}
				return true;
			}

			const latestEntry = await loadLatestSavedConnection();
			if (!latestEntry) return false;

			const details = latestEntry.value;
			if (
				typeof details.useTmux !== 'boolean' ||
				typeof details.tmuxSessionName !== 'string'
			) {
				return false;
			}
			const normalizedDetails: InputConnectionDetails = {
				...details,
				useTmux: details.useTmux,
				tmuxSessionName: details.tmuxSessionName,
				autoConnect: details.autoConnect ?? false,
			};
			const resolvedSecurity = await resolveKeySecurity(details);
			if (!resolvedSecurity) return false;

			await connectAndOpenShell({
				connectionDetails: normalizedDetails,
				resolvedSecurity,
				connect,
				navigate: ({ connectionId, channelId }) => {
					navigateToShell(connectionId, channelId);
				},
				navigateWithError: ({
					connectionId,
					tmuxSessionName,
					storedConnectionId,
				}) => {
					router.replace({
						pathname: '/shell/detail',
						params: {
							connectionId,
							channelId: '0',
							tmuxError: 'attach-failed',
							tmuxSessionName,
							storedConnectionId,
						},
					});
				},
			});
			return true;
		} catch (error) {
			logger.warn('Auto-connect attempt failed', error);
			return false;
		} finally {
			setAutoConnecting(false);
			inFlightRef.current = false;
		}
	}, [
		connect,
		latestShell,
		loadLatestSavedConnection,
		navigateToShell,
		pathname,
		router,
		setAutoConnecting,
	]);

	const runAutoConnectOnce = React.useCallback(async () => {
		if (
			!isActiveRef.current &&
			!(Platform.OS === 'android' && allowBackgroundRef.current)
		)
			return;
		const autoState = useAutoConnectStore.getState();
		if (autoState.isAutoConnecting || autoState.isReconnecting) return;
		await attemptAutoConnect();
	}, [attemptAutoConnect]);

	// On disconnect, retry a few times with backoff before giving up.
	const scheduleReconnect = React.useCallback(async () => {
		if (isReconnecting || isAutoConnecting) return;
		setReconnecting(true);

		const attemptWithBackoff = async (attempt: number) => {
			if (
				!isActiveRef.current &&
				!(Platform.OS === 'android' && allowBackgroundRef.current)
			) {
				setReconnecting(false);
				return;
			}
			const success = await attemptAutoConnect();
			if (success) {
				setReconnecting(false);
				return;
			}
			if (attempt >= RECONNECT_DELAYS_MS.length) {
				setReconnecting(false);
				return;
			}
			reconnectTimerRef.current = setTimeout(() => {
				void attemptWithBackoff(attempt + 1);
			}, RECONNECT_DELAYS_MS[attempt]);
		};

		await attemptWithBackoff(0);
	}, [attemptAutoConnect, isAutoConnecting, isReconnecting, setReconnecting]);

	React.useEffect(() => {
		if (Platform.OS !== 'android') return;
		const shouldRunService = shells.length > 0;
		allowBackgroundRef.current = shouldRunService;

		if (!shouldRunService) {
			if (foregroundKeyRef.current !== null) {
				foregroundKeyRef.current = null;
				void stopForegroundService();
			}
			return;
		}

		const connection = latestShell
			? connections[latestShell.connectionId]
			: undefined;
		const title = 'Fressh Terminal';
		const message = connection
			? `Connected to ${connection.connectionDetails.username}@${connection.connectionDetails.host}`
			: isReconnecting || isAutoConnecting
				? 'Reconnecting...'
				: 'Keeping SSH connection alive';
		const nextKey = `${title}|${message}`;
		if (foregroundKeyRef.current === nextKey) return;
		foregroundKeyRef.current = nextKey;
		void startForegroundService({ title, message });
	}, [
		connections,
		isAutoConnecting,
		isReconnecting,
		latestShell,
		shells.length,
	]);

	React.useEffect(() => {
		return () => {
			if (Platform.OS !== 'android') return;
			void stopForegroundService();
		};
	}, []);

	React.useEffect(() => {
		if (didInitRef.current) return;
		didInitRef.current = true;
		void runAutoConnectOnce();
	}, [runAutoConnectOnce]);

	React.useEffect(() => {
		// Trigger on warm resumes; pause retries when backgrounded.
		// eslint-disable-next-line @eslint-react/web-api/no-leaked-event-listener -- React Native AppState cleans up via subscription.remove()
		const subscription = AppState.addEventListener('change', (nextState) => {
			const wasActive = isActiveRef.current;
			isActiveRef.current = isActiveState(nextState);

			if (wasActive && !isActiveRef.current) {
				clearReconnectTimer();
				setReconnecting(false);
				return;
			}
			if (!wasActive && isActiveRef.current) {
				if (shells.length === 0) {
					void scheduleReconnect();
				} else {
					void runAutoConnectOnce();
				}
			}
		});

		return () => {
			subscription.remove();
			clearReconnectTimer();
		};
	}, [
		clearReconnectTimer,
		runAutoConnectOnce,
		scheduleReconnect,
		setReconnecting,
		shells.length,
	]);

	React.useEffect(() => {
		// Detect a shell drop and kick off a reconnect cycle.
		if (
			!isActiveRef.current &&
			!(Platform.OS === 'android' && allowBackgroundRef.current)
		) {
			prevShellCountRef.current = shells.length;
			return;
		}
		if (prevShellCountRef.current > 0 && shells.length === 0) {
			void scheduleReconnect();
		}
		prevShellCountRef.current = shells.length;
	}, [scheduleReconnect, shells.length]);

	return null;
}
