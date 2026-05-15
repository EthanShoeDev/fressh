import {
	type ListenerEvent,
	type SshShell,
} from '@fressh/react-native-uniffi-russh';
import {
	XtermJsWebView,
	type XtermWebViewHandle,
	type TouchScrollConfig,
} from '@fressh/react-native-xtermjs-webview';

import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import {
	Stack,
	useLocalSearchParams,
	useRouter,
	useFocusEffect,
} from 'expo-router';
import React, {
	startTransition,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	Alert,
	ActivityIndicator,
	Animated,
	AppState,
	Keyboard,
	KeyboardAvoidingView,
	PixelRatio,
	Platform,
	Pressable,
	Text,
	useWindowDimensions,
	View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAutoConnectStore } from '@/lib/auto-connect';
import { getStoredConnectionId } from '@/lib/connection-utils';
import {
	buildDiffityShareCommand,
	buildHostBrowserPanePathCommand,
	buildHostBrowserStatusCycleCommand,
	buildTmuxWindowConfigGetCommand,
	buildTmuxWindowConfigSetCommand,
	extractLastHttpsUrl,
	getHostBrowserUrlSlotLabel,
	parseHostBrowserUrlInput,
	type HostBrowserUrlSlot,
} from '@/lib/host-browser-actions';
import {
	HANDLE_DEV_SERVER_URL,
	runAction,
	type ActionContext,
	type ActionId,
} from '@/lib/keyboard-actions';
import { runMacro } from '@/lib/keyboard-runtime';
import { rootLogger } from '@/lib/logger';
import { resolveLucideIcon } from '@/lib/lucide-utils';
import { secretsManager } from '@/lib/secrets-manager';
import {
	getActiveKeyboardIds,
	getKeyboardActionTarget,
	getKeyboardsById,
	resolveActiveOneShotReturnKeyboardId,
	resolveSelectedKeyboardId,
	type CommandPreset,
	type CommandStep,
	type KeyboardDefinition,
	type KeyboardExecutableItem,
	type MacroDef,
	type ModifierKey,
} from '@/lib/shell-config';
import {
	loadRuntimeShellConfigState,
	reloadRuntimeShellConfigFromRemote,
} from '@/lib/shell-config-store-native';
import { executeSideChannelCommand } from '@/lib/ssh-side-channel';
import { useSshStore } from '@/lib/ssh-store';
import { useTheme } from '@/lib/theme';
import {
	buildTmuxScrollbackCopyModeCommand,
	getTmuxScrollbackControlFailurePolicy,
	getTmuxScrollbackLiveInputPolicy,
	runTmuxControlCommand,
} from '@/lib/tmux-scrollback';
import { queryClient } from '@/lib/utils';
import { wisprAutomationNative } from '@/lib/wispr-automation-native';
import {
	isWisprAutomationBusy,
	reduceWisprAutomationState,
	type WisprAutomationEvent,
	type WisprAutomationFailureReason,
	type WisprAutomationState,
} from '@/lib/wispr-automation-state';
import { resolveWisprTextEditorAvailability } from '@/lib/wispr-text-editor-flow';
import { CommandPresetsModal } from './components/CommandPresetsModal';
import { ConfigureModal } from './components/ConfigureModal';
import { FeatureRequestModal } from './components/FeatureRequestModal';
import { HostUrlModal, type HostUrlModalMode } from './components/HostUrlModal';
import { TerminalCommanderModal } from './components/TerminalCommanderModal';
import { TerminalKeyboard } from './components/TerminalKeyboard';
import {
	TextEntryModal,
	type TextInputScreenBounds,
} from './components/TextEntryModal';

const logger = rootLogger.extend('TabsShellDetail');

type OrderedWriteFn = (bytes: Uint8Array<ArrayBufferLike>) => Promise<void>;

const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

const WISPR_TAP_RETRY_WINDOW_MS = 2_500;
const WISPR_TAP_RETRY_INTERVAL_MS = 200;
const WISPR_OPENING_FALLBACK_MS = 750;

const getErrorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const getWisprTapFailureReason = (
	error: unknown,
): WisprAutomationFailureReason => {
	const message = getErrorMessage(error).toLowerCase();
	return message.includes('not found') ? 'bubble-not-found' : 'tap-failed';
};

const getWisprTapFailureMessage = (
	reason: WisprAutomationFailureReason,
	error: unknown,
) => {
	if (reason === 'bubble-not-found') return 'Wispr bubble not found.';
	if (reason === 'tap-failed') {
		const message = getErrorMessage(error);
		return message ? `Wispr tap failed: ${message}` : 'Wispr tap failed.';
	}
	return 'Wispr automation failed.';
};

// Single-writer queue that guarantees no interleaving across all PTY writes.
class OrderedWriter {
	private tail: Promise<void> = Promise.resolve();

	constructor(private write: OrderedWriteFn) {}

	send(bytes: Uint8Array<ArrayBufferLike>) {
		return this.enqueue(async () => {
			await this.write(bytes);
		});
	}

	sendBatch(
		segments: Uint8Array<ArrayBufferLike>[],
		opts?: { interSegmentDelayMs?: number },
	) {
		const delayMs = opts?.interSegmentDelayMs ?? 0;
		return this.enqueue(async () => {
			for (let i = 0; i < segments.length; i += 1) {
				const segment = segments[i];
				if (segment) await this.write(segment);
				if (delayMs > 0 && i + 1 < segments.length) {
					await sleep(delayMs);
				}
			}
		});
	}

	private enqueue(task: () => Promise<void>) {
		const next = this.tail.then(task, task);
		this.tail = next.catch(() => {});
		return next;
	}
}

const isValidCancelKey = (cancelKey: Uint8Array) =>
	cancelKey.length === 1 && cancelKey[0] !== 0x1b;

const concatBytes = (a: Uint8Array, b: Uint8Array) => {
	const merged = new Uint8Array(a.length + b.length);
	merged.set(a, 0);
	merged.set(b, a.length);
	return merged;
};

const containsMarker = (bytes: Uint8Array, marker: number[]) => {
	if (bytes.length < marker.length) return false;
	for (let i = 0; i <= bytes.length - marker.length; i += 1) {
		let matched = true;
		for (let j = 0; j < marker.length; j += 1) {
			if (bytes[i + j] !== marker[j]) {
				matched = false;
				break;
			}
		}
		if (matched) return true;
	}
	return false;
};

const isLargePayload = (bytes: Uint8Array) => {
	if (bytes.length > 32) return true;
	for (let i = 0; i < bytes.length; i += 1) {
		if (bytes[i] === 10 || bytes[i] === 13) return true;
	}
	const pasteStart = [0x1b, 0x5b, 0x32, 0x30, 0x30, 0x7e];
	const pasteEnd = [0x1b, 0x5b, 0x32, 0x30, 0x31, 0x7e];
	return containsMarker(bytes, pasteStart) || containsMarker(bytes, pasteEnd);
};

const GITHUB_ISSUES_URL = 'https://github.com/mulyoved/fressh/issues';
const SHELL_CONFIG_DOC_URL =
	'https://github.com/mulyoved/fressh/blob/dev/docs/shell-config.md';

export default function TabsShellDetail() {
	const [ready, setReady] = useState(false);
	const hasShownRef = useRef(false);

	useFocusEffect(
		React.useCallback(() => {
			if (hasShownRef.current) {
				setReady(true);
				return undefined;
			}

			let timeout: ReturnType<typeof setTimeout> | null = null;
			startTransition(() => {
				timeout = setTimeout(() => {
					// TODO: This is gross. It would be much better to switch
					// after the navigation animation completes.
					hasShownRef.current = true;
					setReady(true);
				}, 16);
			});

			return () => {
				if (timeout) clearTimeout(timeout);
			};
		}, []),
	);

	if (!ready) return <RouteSkeleton />;
	return <ShellDetail />;
}

function RouteSkeleton() {
	const theme = useTheme();
	return (
		<View
			style={{
				flex: 1,
				justifyContent: 'center',
				alignItems: 'center',
				backgroundColor: theme.colors.background,
			}}
		>
			<Text style={{ color: theme.colors.textPrimary, fontSize: 20 }}>
				Loading
			</Text>
		</View>
	);
}

type TmuxAttachErrorScreenProps = {
	sessionName: string;
	onEdit: () => void;
};

function TmuxAttachErrorScreen({
	sessionName,
	onEdit,
}: TmuxAttachErrorScreenProps) {
	const theme = useTheme();
	return (
		<View
			style={{
				flex: 1,
				justifyContent: 'center',
				alignItems: 'center',
				backgroundColor: theme.colors.background,
				padding: 24,
			}}
		>
			<Text
				style={{
					color: theme.colors.textPrimary,
					fontSize: 20,
					fontWeight: '700',
					marginBottom: 12,
					textAlign: 'center',
				}}
			>
				Tmux session not found
			</Text>
			<Text
				style={{
					color: theme.colors.textSecondary,
					fontSize: 14,
					textAlign: 'center',
					marginBottom: 20,
				}}
			>
				We could not attach to tmux session &quot;{sessionName}&quot;. Create it
				on the server and try again.
			</Text>
			<Pressable
				onPress={onEdit}
				style={{
					backgroundColor: theme.colors.primary,
					borderRadius: 10,
					paddingVertical: 12,
					paddingHorizontal: 20,
				}}
			>
				<Text style={{ color: '#fff', fontWeight: '700' }}>
					Edit Connection
				</Text>
			</Pressable>
		</View>
	);
}

type TerminalErrorBoundaryProps = {
	children: React.ReactNode;
	onRetry: () => void;
};

type TerminalErrorBoundaryState = {
	hasError: boolean;
};

type HostUrlModalState = {
	mode: HostUrlModalMode;
	slot: HostBrowserUrlSlot;
	panePath: string;
	initialValue: string;
};

class TerminalErrorBoundary extends React.Component<
	TerminalErrorBoundaryProps,
	TerminalErrorBoundaryState
> {
	constructor(props: TerminalErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(): TerminalErrorBoundaryState {
		return { hasError: true };
	}

	override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		logger.error('Terminal crashed', error, errorInfo);
	}

	handleRetry = () => {
		this.setState({ hasError: false });
		this.props.onRetry();
	};

	override render() {
		if (this.state.hasError) {
			return <TerminalErrorFallback onRetry={this.handleRetry} />;
		}
		return this.props.children;
	}
}

function TerminalErrorFallback({ onRetry }: { onRetry: () => void }) {
	const theme = useTheme();
	return (
		<View
			style={{
				flex: 1,
				justifyContent: 'center',
				alignItems: 'center',
				backgroundColor: theme.colors.background,
				padding: 20,
			}}
		>
			<Text
				style={{
					color: theme.colors.textPrimary,
					fontSize: 18,
					marginBottom: 12,
				}}
			>
				Terminal crashed
			</Text>
			<Pressable
				onPress={onRetry}
				style={{
					paddingHorizontal: 20,
					paddingVertical: 10,
					borderRadius: 8,
					backgroundColor: theme.colors.primary,
				}}
			>
				<Text style={{ color: '#fff', fontSize: 16 }}>Tap to retry</Text>
			</Pressable>
		</View>
	);
}

const encoder = new TextEncoder();
const tmuxPrefixKey = '\x02';
const tmuxCopyModeKey = '[';
const tmuxCancelKey = 'q';
const tmuxExitKey = 'q';
const touchEnterDelayMs = 10;

function ShellDetail() {
	const xtermRef = useRef<XtermWebViewHandle>(null);
	const listenerIdRef = useRef<bigint | null>(null);
	const attachedShellKeyRef = useRef<string | null>(null);
	const hasAttachedOnceRef = useRef(false);
	const tmuxControlShellRef = useRef<SshShell | null>(null);
	const tmuxControlListenerRef = useRef<bigint | null>(null);
	const tmuxControlWriterRef = useRef<OrderedWriter | null>(null);
	const [terminalReady, setTerminalReady] = useState(false);
	const [hasRenderedTerminal, setHasRenderedTerminal] = useState(false);
	const [shellConfigState, setShellConfigState] = useState(() =>
		loadRuntimeShellConfigState(),
	);

	const searchParams = useLocalSearchParams<{
		connectionId?: string;
		channelId?: string;
		tmuxError?: string;
		tmuxSessionName?: string;
		storedConnectionId?: string;
	}>();

	const connectionId = searchParams.connectionId;
	const channelId = parseInt(searchParams.channelId ?? '');

	if (!connectionId || isNaN(channelId))
		throw new Error('Missing or invalid connectionId/channelId');
	const hasTmuxAttachError = searchParams.tmuxError === 'attach-failed';
	const tmuxSessionName = searchParams.tmuxSessionName;

	const router = useRouter();
	const theme = useTheme();
	const insets = useSafeAreaInsets();

	const shell = useSshStore(
		(s) => s.shells[`${connectionId}-${channelId}` as const],
	);
	const connection = useSshStore((s) => s.connections[connectionId]);
	const storedConnectionId =
		searchParams.storedConnectionId ??
		(connection
			? getStoredConnectionId(connection.connectionDetails)
			: undefined);
	const isAutoConnecting = useAutoConnectStore((s) => s.isAutoConnecting);
	const isReconnecting = useAutoConnectStore((s) => s.isReconnecting);
	const [tmuxTarget, setTmuxTarget] = useState(
		tmuxSessionName?.trim().length ? tmuxSessionName.trim() : 'main',
	);
	const [tmuxEnabled, setTmuxEnabled] = useState(false);
	const [tmuxControlReady, setTmuxControlReady] = useState(false);
	const [tmuxControlRestartNonce, setTmuxControlRestartNonce] = useState(0);

	useEffect(() => {
		if (hasTmuxAttachError) return;
		if (shell && connection) return;
		const autoState = useAutoConnectStore.getState();
		if (autoState.isAutoConnecting || autoState.isReconnecting) return;
		if (connection && !shell) {
			logger.info(
				'shell missing on active connection, waiting for reconnect cycle',
			);
			return;
		}
		logger.info('connection not found, replacing route with /shell');
		router.back();
	}, [
		connection,
		hasTmuxAttachError,
		isAutoConnecting,
		isReconnecting,
		router,
		shell,
	]);

	useEffect(() => {
		if (tmuxSessionName?.trim().length) {
			// eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- Sync state from prop
			setTmuxTarget(tmuxSessionName.trim());
		}
	}, [tmuxSessionName]);

	useEffect(() => {
		if (!storedConnectionId) return;
		let cancelled = false;
		void queryClient
			.fetchQuery(secretsManager.connections.query.get(storedConnectionId))
			.then((entry) => {
				if (cancelled) return;
				const details = entry?.value;
				if (!details) return;
				const useTmux = details.useTmux ?? true;
				setTmuxEnabled(useTmux);
				if (useTmux) {
					const sessionName = details.tmuxSessionName?.trim() || 'main';
					setTmuxTarget(sessionName);
				}
			})
			.catch((error) => {
				logger.warn('Failed to load tmux session info', error);
			});
		return () => {
			cancelled = true;
		};
	}, [storedConnectionId]);

	useEffect(() => {
		const xterm = xtermRef.current;
		return () => {
			if (shell && listenerIdRef.current != null)
				shell.removeListener(listenerIdRef.current);
			listenerIdRef.current = null;
			attachedShellKeyRef.current = null;
			if (xterm) xterm.flush();
		};
	}, [shell]);

	useEffect(() => {
		if (!connection || !tmuxEnabled) {
			// eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- Reset readiness when tmux support is unavailable
			setTmuxControlReady(false);
			return;
		}
		let cancelled = false;
		const startTmuxControlShell = async () => {
			try {
				const controlShell = await connection.startShell({
					term: 'Xterm',
					useTmux: false,
					tmuxSessionName: '',
				});
				if (cancelled) {
					await controlShell.close();
					return;
				}
				const listenerId = controlShell.addListener(() => {}, {
					cursor: { mode: 'live' },
				});
				tmuxControlShellRef.current = controlShell;
				tmuxControlListenerRef.current = listenerId;
				tmuxControlWriterRef.current = new OrderedWriter(async (bytes) => {
					await controlShell.sendData(bytes.buffer as ArrayBuffer);
				});
				setTmuxControlReady(true);
			} catch (error) {
				setTmuxControlReady(false);
				logger.warn('Failed to start tmux control shell', error);
			}
		};
		void startTmuxControlShell();
		return () => {
			cancelled = true;
			const controlShell = tmuxControlShellRef.current;
			const listenerId = tmuxControlListenerRef.current;
			tmuxControlShellRef.current = null;
			tmuxControlListenerRef.current = null;
			tmuxControlWriterRef.current = null;
			setTmuxControlReady(false);
			if (!controlShell) return;
			if (listenerId != null) {
				controlShell.removeListener(listenerId);
			}
			controlShell.close().catch((error) => {
				logger.warn('Failed to close tmux control shell', error);
			});
		};
	}, [connection, tmuxControlRestartNonce, tmuxEnabled]);

	useEffect(() => {
		return () => {
			commandTimeoutsRef.current.forEach((timeout) => {
				clearTimeout(timeout);
			});
			commandTimeoutsRef.current = [];
		};
	}, []);

	const shellConfig = shellConfigState.config;
	const keyboardsById = useMemo(
		() => getKeyboardsById(shellConfig),
		[shellConfig],
	);
	const activeKeyboardIds = useMemo(
		() => getActiveKeyboardIds(shellConfig),
		[shellConfig],
	);
	const [preferredKeyboardId, setPreferredKeyboardId] = useState<string>(() =>
		resolveSelectedKeyboardId(shellConfig, shellConfig.defaultKeyboardId),
	);
	const selectedKeyboardId = useMemo(
		() => resolveSelectedKeyboardId(shellConfig, preferredKeyboardId),
		[preferredKeyboardId, shellConfig],
	);
	const availableKeyboardIds = useMemo(
		() => new Set(activeKeyboardIds),
		[activeKeyboardIds],
	);

	useEffect(() => {
		shellConfigRef.current = shellConfig;
	}, [shellConfig]);

	useEffect(() => {
		availableKeyboardIdsRef.current = availableKeyboardIds;
	}, [availableKeyboardIds]);

	useEffect(() => {
		selectedKeyboardIdRef.current = selectedKeyboardId;
	}, [selectedKeyboardId]);

	const currentKeyboard = useMemo<KeyboardDefinition | null>(() => {
		return selectedKeyboardId
			? (keyboardsById[selectedKeyboardId] ?? null)
			: null;
	}, [keyboardsById, selectedKeyboardId]);

	const currentMacros = useMemo<MacroDef[]>(
		() =>
			currentKeyboard
				? (shellConfig.macrosByKeyboardId[currentKeyboard.id] ?? [])
				: [],
		[currentKeyboard, shellConfig],
	);

	// Flash message for keyboard switching
	const [flashKeyboardName, setFlashKeyboardName] = useState<string | null>(
		null,
	);
	const flashOpacity = useRef(new Animated.Value(0)).current;
	const isFirstMount = useRef(true);

	useEffect(() => {
		// Skip the flash on first mount
		if (isFirstMount.current) {
			isFirstMount.current = false;
			return;
		}

		if (!currentKeyboard) return;

		// eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- Animation state requires direct set in effect
		setFlashKeyboardName(currentKeyboard.name);
		flashOpacity.setValue(1);

		const animation = Animated.timing(flashOpacity, {
			toValue: 0,
			duration: 800,
			delay: 400,
			useNativeDriver: true,
		});

		animation.start(({ finished }) => {
			if (finished) {
				setFlashKeyboardName(null);
			}
		});

		return () => {
			animation.stop();
		};
	}, [currentKeyboard, flashOpacity]);

	const [modifierKeysActive, setModifierKeysActive] = useState<ModifierKey[]>(
		[],
	);
	const [systemKeyboardEnabled, setSystemKeyboardEnabled] = useState(
		Platform.OS === 'android',
	);
	const systemKeyboardVisibleRef = useRef(false);
	const lastKeyboardVisibleRef = useRef(false);
	const appStateRef = useRef(AppState.currentState);
	const [selectionModeEnabled, setSelectionModeEnabled] = useState(false);
	const [commandPresetsOpen, setCommandPresetsOpen] = useState(false);
	const [commanderOpen, setCommanderOpen] = useState(false);
	const [textEntryOpen, setTextEntryOpen] = useState(false);
	const [wisprAutomationState, setWisprAutomationState] =
		useState<WisprAutomationState>({ phase: 'idle' });
	const [configureOpen, setConfigureOpen] = useState(false);
	const [featureRequestOpen, setFeatureRequestOpen] = useState(false);
	const [featureRequestSubmitting, setFeatureRequestSubmitting] =
		useState(false);
	const [featureRequestError, setFeatureRequestError] = useState<
		string | undefined
	>(undefined);
	const [hostUrlModalState, setHostUrlModalState] =
		useState<HostUrlModalState | null>(null);
	const [hostUrlModalSubmitting, setHostUrlModalSubmitting] = useState(false);
	const [hostUrlModalError, setHostUrlModalError] = useState<string | null>(
		null,
	);
	const [scrollbackActive, setScrollbackActive] = useState(false);
	const scrollbackActiveRef = useRef(false);
	const scrollbackPhaseRef = useRef<'dragging' | 'active'>('active');
	const shellConfigRef = useRef(shellConfig);
	const availableKeyboardIdsRef = useRef(availableKeyboardIds);
	const selectedKeyboardIdRef = useRef(selectedKeyboardId);
	const currentInstanceIdRef = useRef<string | null>(null);
	const writerRef = useRef<OrderedWriter | null>(null);
	const commandTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
	const wisprAutomationStateRef = useRef<WisprAutomationState>({
		phase: 'idle',
	});
	const wisprTextEntryValueRef = useRef('');
	const wisprAutomationRequestIdRef = useRef(0);
	const hostUrlReadRequestIdRef = useRef(0);
	const wisprOpeningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const lastSelectionRef = useRef<{ text: string; at: number } | null>(null);
	const { width, height } = useWindowDimensions();
	const touchScrollEnabled =
		Platform.OS === 'android' &&
		Math.min(width, height) >= 600 &&
		tmuxEnabled &&
		tmuxControlReady;
	const touchScrollConfig = useMemo<TouchScrollConfig>(
		() =>
			touchScrollEnabled
				? {
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
						debug: __DEV__,
						debugOverlay: false,
						debugTelemetry: __DEV__,
						debugTelemetryIntervalMs: 120,
						enterDelayMs: touchEnterDelayMs,
						prefixKey: tmuxPrefixKey,
						copyModeKey: tmuxCopyModeKey,
						exitKey: tmuxExitKey,
						cancelKey: tmuxCancelKey,
					}
				: { enabled: false },
		[touchScrollEnabled],
	);
	const cancelKeyBytes = useMemo(() => encoder.encode(tmuxCancelKey), []);
	const exitKeyBytes = useMemo(() => encoder.encode(tmuxExitKey), []);

	const exitSelectionMode = useCallback(() => {
		setSelectionModeEnabled(false);
		xtermRef.current?.setSelectionModeEnabled(false);
	}, []);

	const writeToShell = useCallback(
		async (bytes: Uint8Array<ArrayBufferLike>) => {
			if (!shell) return;
			try {
				await shell.sendData(bytes.buffer as ArrayBuffer);
			} catch (e: unknown) {
				logger.warn('sendData failed', e);
				router.back();
			}
		},
		[shell, router],
	);

	useEffect(() => {
		if (!shell) {
			writerRef.current = null;
			return;
		}
		writerRef.current = new OrderedWriter(writeToShell);
	}, [shell, writeToShell]);

	const sendBytesOrdered = useCallback((bytes: Uint8Array<ArrayBuffer>) => {
		return writerRef.current?.send(bytes);
	}, []);

	const sendBytesQueued = useCallback(
		(
			segments: Uint8Array<ArrayBuffer>[],
			opts?: { interSegmentDelayMs?: number },
		) => {
			return writerRef.current?.sendBatch(segments, opts);
		},
		[],
	);

	const clearScrollbackState = useCallback(() => {
		scrollbackActiveRef.current = false;
		scrollbackPhaseRef.current = 'active';
		setScrollbackActive(false);
		xtermRef.current?.exitScrollback({ emitExit: false });
	}, []);

	const handleTmuxControlUnavailable = useCallback(
		(reason: string) => {
			logger.warn(reason);
			const failurePolicy = getTmuxScrollbackControlFailurePolicy({
				scrollbackActive: scrollbackActiveRef.current,
			});
			const controlShell = tmuxControlShellRef.current;
			const listenerId = tmuxControlListenerRef.current;
			tmuxControlShellRef.current = null;
			tmuxControlListenerRef.current = null;
			tmuxControlWriterRef.current = null;
			setTmuxControlReady(false);
			if (failurePolicy === 'exit-scrollback-and-restart-control') {
				if (isValidCancelKey(cancelKeyBytes)) {
					void sendBytesOrdered(cancelKeyBytes);
				} else {
					logger.warn(
						'cancelKey invalid; cannot exit scrollback after control failure',
					);
				}
			}
			clearScrollbackState();
			setTmuxControlRestartNonce((prev) => prev + 1);
			if (!controlShell) return;
			if (listenerId != null) {
				controlShell.removeListener(listenerId);
			}
			controlShell.close().catch((error) => {
				logger.warn(
					'Failed to close tmux control shell after send failure',
					error,
				);
			});
		},
		[cancelKeyBytes, clearScrollbackState, sendBytesOrdered],
	);

	const sendTmuxControlCommand = useCallback(
		async (command: string) => {
			const writer = tmuxControlWriterRef.current;
			if (!writer) return false;
			const sent = await runTmuxControlCommand(writer, command);
			if (sent) return true;
			handleTmuxControlUnavailable('tmux control send failed');
			return false;
		},
		[handleTmuxControlUnavailable],
	);

	const sendInputEnsuringLive = useCallback(
		(bytes: Uint8Array<ArrayBuffer>) => {
			const inputPolicy = getTmuxScrollbackLiveInputPolicy({
				scrollbackActive: scrollbackActiveRef.current,
			});
			if (inputPolicy === 'pass-through') {
				void sendBytesOrdered(bytes);
				return;
			}

			if (!isValidCancelKey(cancelKeyBytes)) {
				logger.warn(
					'cancelKey invalid; blocking input until Jump to live is used',
				);
				return;
			}

			const isExitKey =
				bytes.length === exitKeyBytes.length &&
				bytes.length === 1 &&
				bytes[0] === exitKeyBytes[0];

			if (isExitKey) {
				void sendBytesOrdered(cancelKeyBytes);
				clearScrollbackState();
				return;
			}

			const largePayload = isLargePayload(bytes);
			if (!largePayload) {
				void sendBytesOrdered(concatBytes(cancelKeyBytes, bytes));
			} else {
				void sendBytesQueued([cancelKeyBytes, bytes], {
					interSegmentDelayMs: touchEnterDelayMs,
				});
			}
			clearScrollbackState();
		},
		[
			cancelKeyBytes,
			exitKeyBytes,
			sendBytesOrdered,
			sendBytesQueued,
			clearScrollbackState,
		],
	);

	const sendBytesRaw = useCallback(
		(bytes: Uint8Array<ArrayBuffer>) => {
			sendInputEnsuringLive(bytes);
		},
		[sendInputEnsuringLive],
	);

	const sendBytesWithModifiers = useCallback(
		(bytes: Uint8Array<ArrayBuffer>) => {
			if (!shell) return;
			let next = bytes;
			modifierKeysActive
				.map((key) => MODIFIER_DEFS[key])
				.sort((a, b) => a.orderPreference - b.orderPreference)
				.forEach((modifier) => {
					if (!modifier.canApplyModifierToBytes(next)) return;
					next = modifier.applyModifierToBytes(next);
				});
			sendBytesRaw(next);
		},
		[modifierKeysActive, sendBytesRaw, shell],
	);

	const sendTextRaw = useCallback(
		(value: string) => {
			sendBytesRaw(encoder.encode(value));
		},
		[sendBytesRaw],
	);

	const sendTextWithModifiers = useCallback(
		(value: string) => {
			sendBytesWithModifiers(encoder.encode(value));
		},
		[sendBytesWithModifiers],
	);

	const clearCommandTimeouts = useCallback(() => {
		commandTimeoutsRef.current.forEach((timeout) => {
			clearTimeout(timeout);
		});
		commandTimeoutsRef.current = [];
	}, []);

	const sendCommandStep = useCallback(
		(step: CommandStep) => {
			const times = step.repeat ?? 1;
			for (let i = 0; i < times; i += 1) {
				switch (step.type) {
					case 'text':
						sendTextRaw(step.data);
						break;
					case 'enter':
						sendBytesRaw(encoder.encode('\r'));
						break;
					case 'arrowDown':
						sendBytesRaw(encoder.encode('\x1b[B'));
						break;
					case 'arrowUp':
						sendBytesRaw(encoder.encode('\x1b[A'));
						break;
					case 'esc':
						sendBytesRaw(encoder.encode('\x1b'));
						break;
					case 'space':
						sendBytesRaw(encoder.encode(' '));
						break;
					case 'tab':
						sendBytesRaw(encoder.encode('\t'));
						break;
					default:
						break;
				}
			}
		},
		[sendBytesRaw, sendTextRaw],
	);

	const runCommandSteps = useCallback(
		(steps: CommandStep[]) => {
			exitSelectionMode();
			clearCommandTimeouts();
			const baseDelay = 50;
			let scheduledDelay = 0;
			steps.forEach((step, index) => {
				const stepDelay = step.delayMs ?? (index === 0 ? 0 : baseDelay);
				scheduledDelay += stepDelay;
				const timeoutId = setTimeout(() => {
					sendCommandStep(step);
				}, scheduledDelay);
				commandTimeoutsRef.current.push(timeoutId);
			});
			setCommandPresetsOpen(false);
		},
		[clearCommandTimeouts, exitSelectionMode, sendCommandStep],
	);

	const runCommandPreset = useCallback(
		(preset: CommandPreset) => {
			runCommandSteps(preset.steps);
		},
		[runCommandSteps],
	);

	const toggleModifier = useCallback((modifier: ModifierKey) => {
		setModifierKeysActive((prev) =>
			prev.includes(modifier)
				? prev.filter((entry) => entry !== modifier)
				: [...prev, modifier],
		);
	}, []);

	const rotateKeyboard = useCallback(() => {
		if (activeKeyboardIds.length <= 1) return;
		setPreferredKeyboardId((current) => {
			const resolvedCurrent = resolveSelectedKeyboardId(shellConfig, current);
			const idx = Math.max(0, activeKeyboardIds.indexOf(resolvedCurrent));
			const nextIdx = (idx + 1) % activeKeyboardIds.length;
			return activeKeyboardIds[nextIdx] ?? resolvedCurrent;
		});
	}, [activeKeyboardIds, shellConfig]);

	const selectKeyboardIfExists = useCallback(
		(id: string) => {
			if (!availableKeyboardIds.has(id)) return;
			setPreferredKeyboardId(id);
		},
		[availableKeyboardIds],
	);

	const handlePasteClipboard = useCallback(async () => {
		try {
			const text = await Clipboard.getStringAsync();
			if (text) sendTextRaw(text);
			if (selectionModeEnabled) {
				exitSelectionMode();
			}
		} catch (error) {
			logger.warn('clipboard read failed', error);
		}
	}, [exitSelectionMode, sendTextRaw, selectionModeEnabled]);

	const handlePasteTextEntry = useCallback(
		async (value: string) => {
			if (!value) return;
			if (selectionModeEnabled) {
				exitSelectionMode();
			}

			const textBytes = encoder.encode(value);
			const enterBytes = encoder.encode('\r');

			const inputPolicy = getTmuxScrollbackLiveInputPolicy({
				scrollbackActive: scrollbackActiveRef.current,
			});
			if (inputPolicy === 'exit-before-send') {
				if (!isValidCancelKey(cancelKeyBytes)) {
					logger.warn('cancelKey invalid; cannot auto-exit scrollback');
					return;
				}
				clearScrollbackState();
				try {
					await sendBytesQueued([cancelKeyBytes, textBytes, enterBytes], {
						interSegmentDelayMs: touchEnterDelayMs,
					});
				} catch (error) {
					logger.warn('paste text entry failed', error);
				}
				return;
			}

			void sendBytesQueued([textBytes, enterBytes]);
		},
		[
			cancelKeyBytes,
			clearScrollbackState,
			exitSelectionMode,
			selectionModeEnabled,
			sendBytesQueued,
		],
	);

	const clearWisprOpeningTimeout = useCallback(() => {
		if (!wisprOpeningTimeoutRef.current) return;
		clearTimeout(wisprOpeningTimeoutRef.current);
		wisprOpeningTimeoutRef.current = null;
	}, []);

	const setWisprAutomationStateSnapshot = useCallback(
		(nextState: WisprAutomationState) => {
			wisprAutomationStateRef.current = nextState;
			setWisprAutomationState(nextState);
		},
		[],
	);

	const applyWisprAutomationEvent = useCallback(
		(event: WisprAutomationEvent) => {
			const nextState = reduceWisprAutomationState(
				wisprAutomationStateRef.current,
				event,
			);
			setWisprAutomationStateSnapshot(nextState);
			if (nextState.phase !== 'openingTextEntry') {
				clearWisprOpeningTimeout();
			}
			return nextState;
		},
		[clearWisprOpeningTimeout, setWisprAutomationStateSnapshot],
	);

	const resetWisprAutomation = useCallback(() => {
		wisprAutomationRequestIdRef.current += 1;
		clearWisprOpeningTimeout();
		applyWisprAutomationEvent({ type: 'reset' });
	}, [applyWisprAutomationEvent, clearWisprOpeningTimeout]);

	const failWisprAutomation = useCallback(
		(reason: WisprAutomationFailureReason, message: string) => {
			wisprAutomationRequestIdRef.current += 1;
			applyWisprAutomationEvent({
				type: 'failed',
				reason,
				message,
			});
		},
		[applyWisprAutomationEvent],
	);

	const isWisprAutomationRequestActive = useCallback((requestId: number) => {
		return requestId === wisprAutomationRequestIdRef.current;
	}, []);

	const tapWisprControlWithRetry = useCallback(
		async (
			requestId: number,
			options?: {
				notFoundMessage?: string;
			},
		) => {
			let lastError: unknown = new Error(
				options?.notFoundMessage ?? 'Wispr bubble not found',
			);
			const deadline = Date.now() + WISPR_TAP_RETRY_WINDOW_MS;

			while (Date.now() <= deadline) {
				if (!isWisprAutomationRequestActive(requestId)) return null;
				try {
					await wisprAutomationNative.tapWisprControl();
					if (!isWisprAutomationRequestActive(requestId)) return null;
					return { ok: true as const };
				} catch (error) {
					lastError = error;
				}
				await sleep(WISPR_TAP_RETRY_INTERVAL_MS);
			}

			const reason = getWisprTapFailureReason(lastError);
			return {
				ok: false as const,
				reason,
				message: getWisprTapFailureMessage(reason, lastError),
			};
		},
		[isWisprAutomationRequestActive],
	);

	const startWisprOpeningFallback = useCallback(
		(requestId: number, onFallback: () => void) => {
			clearWisprOpeningTimeout();
			wisprOpeningTimeoutRef.current = setTimeout(() => {
				if (
					!isWisprAutomationRequestActive(requestId) ||
					wisprAutomationStateRef.current.phase !== 'openingTextEntry'
				) {
					return;
				}
				onFallback();
			}, WISPR_OPENING_FALLBACK_MS);
		},
		[clearWisprOpeningTimeout, isWisprAutomationRequestActive],
	);

	const handleWisprTextEntryFocus = useCallback(
		(value: string, bounds?: TextInputScreenBounds) => {
			if (wisprAutomationStateRef.current.phase !== 'openingTextEntry') {
				return;
			}

			const requestId = wisprAutomationRequestIdRef.current;
			clearWisprOpeningTimeout();
			applyWisprAutomationEvent({
				type: 'textEntryFocused',
				textBeforeStart: value,
			});

			void (async () => {
				if (bounds && bounds.width > 0 && bounds.height > 0) {
					const pixelRatio = PixelRatio.get();
					const x = (bounds.x + bounds.width / 2) * pixelRatio;
					const y = (bounds.y + Math.min(bounds.height / 2, 48)) * pixelRatio;
					try {
						await wisprAutomationNative.tapScreen(x, y);
					} catch (error) {
						logger.warn('Failed to prime Wispr text field', error);
					}
				}
				return tapWisprControlWithRetry(requestId);
			})().then((result) => {
				if (
					!result ||
					!isWisprAutomationRequestActive(requestId) ||
					wisprAutomationStateRef.current.phase !== 'waitingForBubble'
				) {
					return;
				}
				if (result.ok) {
					applyWisprAutomationEvent({ type: 'wisprTapSucceeded' });
					return;
				}
				applyWisprAutomationEvent({
					type: 'failed',
					reason: result.reason,
					message: result.message,
				});
			});
		},
		[
			applyWisprAutomationEvent,
			clearWisprOpeningTimeout,
			isWisprAutomationRequestActive,
			tapWisprControlWithRetry,
		],
	);

	const handleWisprTextEntryValueChange = useCallback(
		(value: string) => {
			wisprTextEntryValueRef.current = value;
			const previousPhase = wisprAutomationStateRef.current.phase;
			const nextState = applyWisprAutomationEvent({
				type: 'textChanged',
				value,
			});
			if (previousPhase === 'recording' && nextState.phase === 'idle') {
				wisprAutomationRequestIdRef.current += 1;
			}
		},
		[applyWisprAutomationEvent],
	);

	const handleOpenWisprTextEditor = useCallback(() => {
		const currentState = wisprAutomationStateRef.current;
		if (currentState.phase !== 'idle' && currentState.phase !== 'failed') {
			logger.info('Ignoring Wispr text entry while automation is busy', {
				phase: currentState.phase,
			});
			return;
		}
		if (Platform.OS !== 'android') {
			setCommanderOpen(false);
			setCommandPresetsOpen(false);
			setTextEntryOpen(true);
			failWisprAutomation(
				'unsupported-platform',
				'Wispr automation is only available on Android.',
			);
			return;
		}

		const requestId = wisprAutomationRequestIdRef.current + 1;
		wisprAutomationRequestIdRef.current = requestId;
		void (async () => {
			try {
				const status = await wisprAutomationNative.getStatus();
				if (!isWisprAutomationRequestActive(requestId)) return;
				const availability = resolveWisprTextEditorAvailability(status);
				if (availability.type === 'setup-required') {
					setCommanderOpen(false);
					setCommandPresetsOpen(false);
					setTextEntryOpen(true);
					applyWisprAutomationEvent({
						type: 'failed',
						reason: availability.reason,
						message: availability.message,
					});
					return;
				}

				setCommanderOpen(false);
				setCommandPresetsOpen(false);
				applyWisprAutomationEvent({ type: 'press' });
				startWisprOpeningFallback(requestId, () => {
					handleWisprTextEntryFocus(wisprTextEntryValueRef.current);
				});
				setTextEntryOpen(true);
			} catch (error) {
				if (!isWisprAutomationRequestActive(requestId)) return;
				setCommanderOpen(false);
				setCommandPresetsOpen(false);
				setTextEntryOpen(true);
				applyWisprAutomationEvent({
					type: 'failed',
					reason: 'service-disabled',
					message: 'Wispr automation is unavailable.',
				});
				logger.warn('Wispr automation status check failed', error);
			}
		})();
	}, [
		applyWisprAutomationEvent,
		failWisprAutomation,
		handleWisprTextEntryFocus,
		isWisprAutomationRequestActive,
		startWisprOpeningFallback,
	]);

	const handleOpenWisprAutomationSettings = useCallback(() => {
		if (Platform.OS !== 'android') return;
		void wisprAutomationNative.openAccessibilitySettings().catch((error) => {
			logger.warn('Failed to open accessibility settings', error);
		});
	}, []);

	const handleCloseTextEntry = useCallback(() => {
		setTextEntryOpen(false);
		resetWisprAutomation();
	}, [resetWisprAutomation]);

	useEffect(
		() => () => {
			wisprAutomationRequestIdRef.current += 1;
			clearWisprOpeningTimeout();
		},
		[clearWisprOpeningTimeout],
	);

	const handleCopySelection = useCallback(() => {
		const xr = xtermRef.current;
		if (!xr) return;
		void (async () => {
			const selection = await xr.getSelection();
			if (!selection) {
				logger.info('no selection to copy');
				return;
			}
			lastSelectionRef.current = { text: selection, at: Date.now() };
			await Clipboard.setStringAsync(selection);
			logger.info('copied selection', selection.length);
			exitSelectionMode();
			const returnKeyboardId = resolveActiveOneShotReturnKeyboardId(
				shellConfigRef.current,
				availableKeyboardIdsRef.current,
				selectedKeyboardIdRef.current,
			);
			if (returnKeyboardId) {
				setPreferredKeyboardId(returnKeyboardId);
			}
		})();
	}, [exitSelectionMode]);

	const handleSelectionChanged = useCallback((text: string) => {
		if (!text) return;
		const now = Date.now();
		if (lastSelectionRef.current?.text === text) return;
		lastSelectionRef.current = { text, at: now };
	}, []);

	const openConfigDialog = useCallback(() => {
		setConfigureOpen(true);
	}, []);

	const handleDevServer = useCallback(() => {
		setConfigureOpen(false);
		void Linking.openURL(HANDLE_DEV_SERVER_URL);
	}, []);

	const handleReloadConfig = useCallback(async () => {
		setConfigureOpen(false);
		try {
			const nextState = await reloadRuntimeShellConfigFromRemote();
			setShellConfigState(nextState);
			Alert.alert(
				'Config reloaded',
				`Loaded ${nextState.config.version} from GitHub.`,
			);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Unable to reload config.';
			setShellConfigState((current) => ({
				...current,
				lastError: message,
			}));
			Alert.alert('Config reload failed', message);
		}
	}, []);

	const handleHostConfig = useCallback(() => {
		setConfigureOpen(false);
		const editConnectionId = storedConnectionId ?? connectionId;
		router.replace({
			pathname: '/',
			params: { editConnectionId },
		});
	}, [connectionId, router, storedConnectionId]);

	const handleOpenGitHubIssues = useCallback(() => {
		setConfigureOpen(false);
		void Linking.openURL(GITHUB_ISSUES_URL);
	}, []);

	const handleOpenShellConfigDocs = useCallback(() => {
		setConfigureOpen(false);
		void Linking.openURL(SHELL_CONFIG_DOC_URL);
	}, []);

	const handleOpenFeatureRequest = useCallback(() => {
		setConfigureOpen(false);
		setFeatureRequestError(undefined);
		setFeatureRequestOpen(true);
	}, []);

	const handleFeatureRequestSubmit = useCallback(
		async (description: string) => {
			if (!connection) {
				setFeatureRequestError('No SSH connection available');
				return;
			}

			setFeatureRequestSubmitting(true);
			setFeatureRequestError(undefined);

			const escapeSingleQuotes = (value: string) =>
				value.replace(/'/g, "'\\''");
			const escapedDescription = escapeSingleQuotes(description);
			const escapedPrompt = escapeSingleQuotes(
				'Generate a concise GitHub issue title (max 72 chars) for this feature request. Return only the title line, no quotes.',
			);

			const command = `
description='${escapedDescription}'
prompt='${escapedPrompt}'
prompt=$(printf '%s\\n\\n%s\\n' "$prompt" "$description")

if ! command -v claude >/dev/null 2>&1; then
  echo 'claude CLI not found. Install Claude Code CLI (claude).' >&2
  false
else
  claude_help=$(claude --help 2>/dev/null)
  raw_title=''
  if printf '%s' "$claude_help" | grep -q -- '--print'; then
    raw_title=$(claude --print "$prompt")
  elif printf '%s' "$claude_help" | grep -q -- ' -p'; then
    raw_title=$(claude -p "$prompt")
  else
    echo 'claude CLI does not support --print or -p prompt flags.' >&2
    false
  fi
  claude_status=$?
  if [ $claude_status -ne 0 ]; then
    echo 'Claude failed to generate a title.' >&2
    false
  else
    title=$(printf '%s' "$raw_title" | tr -d '\\r' | head -n 1 | sed 's/^['"'"'"[:space:]]*//;s/['"'"'"[:space:]]*$//' | tr -s '[:space:]' ' ')
    title=$(printf '%s' "$title" | cut -c1-72)
    if [ -z "$title" ]; then
      echo 'Claude returned an empty title.' >&2
      false
    else
      gh issue create --repo mulyoved/fressh --title "Feature Request: $title" --body "$description"
    fi
  fi
fi
`.trim();

			try {
				// Execute via side-channel SSH session (doesn't interfere with current terminal)
				const result = await executeSideChannelCommand(
					connection,
					command,
					60000,
				);

				if (result.success) {
					logger.info('Feature request submitted successfully', {
						output: result.output,
						issueUrl: result.issueUrl,
					});
					setFeatureRequestOpen(false);
					setFeatureRequestError(undefined);
					// Extract issue number from URL (format: https://github.com/owner/repo/issues/123)
					const issueUrl = result.issueUrl ?? null;
					const issueNumberMatch = issueUrl?.match(/\/issues\/(\d+)$/);
					const issueNumber = issueNumberMatch?.[1] ?? null;
					Alert.alert(
						issueNumber
							? `Issue #${issueNumber} Created`
							: 'Feature Request Submitted',
						issueUrl
							? `Your request has been created:\n${issueUrl}`
							: 'Your feature request has been submitted successfully.',
						[{ text: 'OK' }],
					);
				} else {
					const errorMsg =
						result.error ||
						'Failed to create issue. Make sure gh and claude CLIs are installed and authenticated on the remote host.';
					logger.error('Feature request failed', { error: errorMsg });
					setFeatureRequestError(errorMsg);
				}
			} catch (err) {
				const errorMsg =
					err instanceof Error ? err.message : 'Unknown error occurred';
				logger.error('Feature request error', { error: err });
				setFeatureRequestError(errorMsg);
			} finally {
				setFeatureRequestSubmitting(false);
			}
		},
		[connection],
	);

	const showHostBrowserError = useCallback((title: string, message: string) => {
		Alert.alert(title, message);
	}, []);

	const runHostBrowserCommand = useCallback(
		async (command: string, timeoutMs = 30_000) => {
			if (!connection) {
				throw new Error('No SSH connection available.');
			}
			const result = await executeSideChannelCommand(
				connection,
				command,
				timeoutMs,
			);
			if (!result.success) {
				throw new Error(
					result.error || result.output || 'Remote command failed.',
				);
			}
			return result.output.trim();
		},
		[connection],
	);

	const resolveHostBrowserPanePath = useCallback(async () => {
		if (!tmuxEnabled) {
			throw new Error(
				'Host browser actions require a tmux-enabled connection.',
			);
		}
		const sessionName = tmuxTarget.trim() || 'main';
		const output = await runHostBrowserCommand(
			buildHostBrowserPanePathCommand(sessionName),
			10_000,
		);
		const panePath = output
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean)
			.at(-1);
		if (!panePath) {
			throw new Error(
				`Could not resolve pane path for tmux session ${sessionName}.`,
			);
		}
		return panePath;
	}, [runHostBrowserCommand, tmuxEnabled, tmuxTarget]);

	const openAndroidUrl = useCallback(async (url: string) => {
		try {
			await Linking.openURL(url);
		} catch (error) {
			throw new Error(
				`Android could not open ${url}: ${getErrorMessage(error)}`,
			);
		}
	}, []);

	const handleOpenHostDiffity = useCallback(() => {
		void (async () => {
			try {
				const panePath = await resolveHostBrowserPanePath();
				const output = await runHostBrowserCommand(
					buildDiffityShareCommand(panePath),
					60_000,
				);
				const url = extractLastHttpsUrl(output);
				if (!url) {
					throw new Error(
						output || 'diffity-share did not return an HTTPS URL.',
					);
				}
				await openAndroidUrl(url);
			} catch (error) {
				showHostBrowserError('Diffity failed', getErrorMessage(error));
			}
		})();
	}, [
		openAndroidUrl,
		resolveHostBrowserPanePath,
		runHostBrowserCommand,
		showHostBrowserError,
	]);

	const handleOpenHostUrlSlot = useCallback(
		(slot: HostBrowserUrlSlot) => {
			const requestId = ++hostUrlReadRequestIdRef.current;
			void (async () => {
				try {
					const panePath = await resolveHostBrowserPanePath();
					const value = await runHostBrowserCommand(
						buildTmuxWindowConfigGetCommand(slot, panePath),
						10_000,
					);
					if (requestId !== hostUrlReadRequestIdRef.current) return;
					const savedUrl = value.trim();
					if (savedUrl) {
						const parsed = parseHostBrowserUrlInput(savedUrl);
						if (parsed.type === 'invalid') {
							setHostUrlModalState({
								mode: 'edit',
								slot,
								panePath,
								initialValue: savedUrl,
							});
							setHostUrlModalError(parsed.message);
							return;
						}
						if (parsed.type === 'empty') return;
						await openAndroidUrl(parsed.url);
						return;
					}
					setHostUrlModalError(null);
					setHostUrlModalState({
						mode: 'open-missing',
						slot,
						panePath,
						initialValue: '',
					});
				} catch (error) {
					if (requestId !== hostUrlReadRequestIdRef.current) return;
					showHostBrowserError(
						`${getHostBrowserUrlSlotLabel(slot)} failed`,
						getErrorMessage(error),
					);
				}
			})();
		},
		[
			openAndroidUrl,
			resolveHostBrowserPanePath,
			runHostBrowserCommand,
			showHostBrowserError,
		],
	);

	const handleEditHostUrlSlot = useCallback(
		(slot: HostBrowserUrlSlot) => {
			const requestId = ++hostUrlReadRequestIdRef.current;
			void (async () => {
				try {
					const panePath = await resolveHostBrowserPanePath();
					const value = await runHostBrowserCommand(
						buildTmuxWindowConfigGetCommand(slot, panePath),
						10_000,
					);
					if (requestId !== hostUrlReadRequestIdRef.current) return;
					setHostUrlModalError(null);
					setHostUrlModalState({
						mode: 'edit',
						slot,
						panePath,
						initialValue: value.trim(),
					});
				} catch (error) {
					if (requestId !== hostUrlReadRequestIdRef.current) return;
					showHostBrowserError(
						`Edit ${getHostBrowserUrlSlotLabel(slot)} failed`,
						getErrorMessage(error),
					);
				}
			})();
		},
		[resolveHostBrowserPanePath, runHostBrowserCommand, showHostBrowserError],
	);

	const handleCloseHostUrlModal = useCallback(() => {
		if (hostUrlModalSubmitting) return;
		setHostUrlModalState(null);
		setHostUrlModalError(null);
	}, [hostUrlModalSubmitting]);

	const handleSubmitHostUrlModal = useCallback(
		(value: string) => {
			const state = hostUrlModalState;
			if (!state) return;
			const parsed = parseHostBrowserUrlInput(value);
			if (parsed.type === 'empty') {
				setHostUrlModalState(null);
				setHostUrlModalError(null);
				return;
			}
			if (parsed.type === 'invalid') {
				setHostUrlModalError(parsed.message);
				return;
			}

			void (async () => {
				setHostUrlModalSubmitting(true);
				setHostUrlModalError(null);
				try {
					await runHostBrowserCommand(
						buildTmuxWindowConfigSetCommand(
							state.slot,
							state.panePath,
							parsed.url,
						),
						10_000,
					);
					if (state.mode === 'open-missing') {
						await openAndroidUrl(parsed.url);
					}
					setHostUrlModalState(null);
				} catch (error) {
					setHostUrlModalError(getErrorMessage(error));
				} finally {
					setHostUrlModalSubmitting(false);
				}
			})();
		},
		[hostUrlModalState, openAndroidUrl, runHostBrowserCommand],
	);

	const handleCycleWorkmuxStatus = useCallback(() => {
		void (async () => {
			try {
				if (!tmuxEnabled) {
					throw new Error('Status cycle requires a tmux-enabled connection.');
				}
				const sessionName = tmuxTarget.trim() || 'main';
				await runHostBrowserCommand(
					buildHostBrowserStatusCycleCommand(sessionName),
					10_000,
				);
			} catch (error) {
				showHostBrowserError('Status cycle failed', getErrorMessage(error));
			}
		})();
	}, [runHostBrowserCommand, showHostBrowserError, tmuxEnabled, tmuxTarget]);

	const actionContext = useMemo<ActionContext>(
		() => ({
			availableKeyboardIds,
			selectKeyboard: selectKeyboardIfExists,
			resolveKeyboardActionTarget: (actionId) =>
				getKeyboardActionTarget(shellConfig, actionId),
			rotateKeyboard,
			openConfigurator: openConfigDialog,
			sendBytes: sendBytesRaw,
			pasteClipboard: handlePasteClipboard,
			copySelection: handleCopySelection,
			toggleCommandPresets: () => {
				setCommanderOpen(false);
				handleCloseTextEntry();
				setCommandPresetsOpen((prev) => !prev);
			},
			openCommander: () => {
				setCommandPresetsOpen(false);
				handleCloseTextEntry();
				setCommanderOpen(true);
			},
			openWisprTextEditor: handleOpenWisprTextEditor,
			openHostDiffity: handleOpenHostDiffity,
			openHostUrlSlot: handleOpenHostUrlSlot,
			editHostUrlSlot: handleEditHostUrlSlot,
			cycleWorkmuxStatus: handleCycleWorkmuxStatus,
		}),
		[
			availableKeyboardIds,
			handleCycleWorkmuxStatus,
			handleCopySelection,
			handleCloseTextEntry,
			handleEditHostUrlSlot,
			handleOpenHostDiffity,
			handleOpenHostUrlSlot,
			handlePasteClipboard,
			handleOpenWisprTextEditor,
			openConfigDialog,
			rotateKeyboard,
			shellConfig,
			selectKeyboardIfExists,
			sendBytesRaw,
		],
	);

	const handleAction = useCallback(
		(actionId: ActionId) => {
			void runAction(actionId, actionContext);
		},
		[actionContext],
	);

	const handleSlotPress = useCallback(
		(slot: KeyboardExecutableItem) => {
			if (
				selectionModeEnabled &&
				!(slot.type === 'action' && slot.actionId === 'COPY_SELECTION')
			) {
				// Any input/command should exit selection first, except explicit copy.
				exitSelectionMode();
			}
			const returnKeyboardId = resolveActiveOneShotReturnKeyboardId(
				shellConfig,
				availableKeyboardIds,
				currentKeyboard?.id,
			);

			switch (slot.type) {
				case 'modifier':
					toggleModifier(slot.modifier);
					break;
				case 'text':
					sendTextWithModifiers(slot.text);
					break;
				case 'bytes':
					sendBytesWithModifiers(new Uint8Array(slot.bytes));
					break;
				case 'macro': {
					const macro = currentMacros.find(
						(entry) => entry.id === slot.macroId,
					);
					if (macro) {
						runMacro(macro, {
							sendBytes: sendBytesRaw,
							sendText: sendTextRaw,
							runSteps: runCommandSteps,
							onAction: handleAction,
						});
					}
					break;
				}
				case 'action':
					handleAction(slot.actionId);
					break;
				default:
					break;
			}

			if (returnKeyboardId) {
				setPreferredKeyboardId(returnKeyboardId);
			}
		},
		[
			availableKeyboardIds,
			currentKeyboard,
			currentMacros,
			exitSelectionMode,
			handleAction,
			runCommandSteps,
			selectionModeEnabled,
			sendBytesRaw,
			sendBytesWithModifiers,
			sendTextRaw,
			sendTextWithModifiers,
			shellConfig,
			toggleModifier,
		],
	);

	// Debounced PTY resize handler
	const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
	const resumeDismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	const handleTerminalResize = useCallback(
		(cols: number, rows: number) => {
			// Skip if same size
			if (
				lastSizeRef.current?.cols === cols &&
				lastSizeRef.current?.rows === rows
			) {
				return;
			}
			lastSizeRef.current = { cols, rows };

			// Clear pending resize
			if (resizeTimeoutRef.current) {
				clearTimeout(resizeTimeoutRef.current);
			}

			// Debounce resize calls (100ms)
			resizeTimeoutRef.current = setTimeout(() => {
				if (!shell) return;
				logger.info(`Resizing PTY to ${cols}x${rows}`);
				shell.resizePty(cols, rows).catch((e: unknown) => {
					logger.warn('resizePty failed', e);
				});
			}, 100);
		},
		[shell],
	);

	// Cleanup resize timeout on unmount
	useEffect(() => {
		return () => {
			if (resizeTimeoutRef.current) {
				clearTimeout(resizeTimeoutRef.current);
			}
			if (resumeDismissTimeoutRef.current) {
				clearTimeout(resumeDismissTimeoutRef.current);
			}
		};
	}, []);

	useEffect(() => {
		if (Platform.OS !== 'android') return;
		const showSub = Keyboard.addListener('keyboardDidShow', () => {
			systemKeyboardVisibleRef.current = true;
		});
		const hideSub = Keyboard.addListener('keyboardDidHide', () => {
			systemKeyboardVisibleRef.current = false;
		});
		return () => {
			showSub.remove();
			hideSub.remove();
		};
	}, []);

	useEffect(() => {
		if (Platform.OS !== 'android') return;
		const dismissKeyboard = () => Keyboard.dismiss();
		appStateRef.current = AppState.currentState;
		dismissKeyboard();
		xtermRef.current?.setSystemKeyboardEnabled(systemKeyboardEnabled);
		// eslint-disable-next-line @eslint-react/web-api/no-leaked-event-listener -- React Native AppState cleans up via subscription.remove()
		const subscription = AppState.addEventListener('change', (nextState) => {
			const previousState = appStateRef.current;
			appStateRef.current = nextState;
			if (nextState === 'active') {
				xtermRef.current?.setSystemKeyboardEnabled(systemKeyboardEnabled);
				// Preserve the previous OS keyboard visibility when returning to the app.
				if (!systemKeyboardEnabled || !lastKeyboardVisibleRef.current) {
					dismissKeyboard();
					// Some devices show the keyboard after focus settles; dismiss again.
					if (resumeDismissTimeoutRef.current) {
						clearTimeout(resumeDismissTimeoutRef.current);
					}
					resumeDismissTimeoutRef.current = setTimeout(() => {
						dismissKeyboard();
					}, 150);
					systemKeyboardVisibleRef.current = false;
				}
				return;
			}
			// Capture once when transitioning away from active.
			if (previousState === 'active') {
				lastKeyboardVisibleRef.current = systemKeyboardVisibleRef.current;
			}
		});
		return () => {
			subscription.remove();
		};
	}, [systemKeyboardEnabled]);

	const enableSystemKeyboard = useCallback(() => {
		if (Platform.OS !== 'android') return;
		xtermRef.current?.setSystemKeyboardEnabled(true);
		setSystemKeyboardEnabled(true);
	}, []);

	const disableSystemKeyboard = useCallback(() => {
		if (Platform.OS !== 'android') return;
		xtermRef.current?.setSystemKeyboardEnabled(false);
		Keyboard.dismiss();
		systemKeyboardVisibleRef.current = false;
		setSystemKeyboardEnabled(false);
	}, []);

	const handleSelectionModeChange = useCallback(
		(enabled: boolean) => {
			setSelectionModeEnabled(enabled);
			if (enabled) {
				disableSystemKeyboard();
			} else {
				enableSystemKeyboard();
			}
		},
		[disableSystemKeyboard, enableSystemKeyboard],
	);

	const handleScrollbackModeChange = useCallback(
		(event: {
			active: boolean;
			phase: 'dragging' | 'active';
			instanceId: string;
		}) => {
			if (
				currentInstanceIdRef.current &&
				event.instanceId !== currentInstanceIdRef.current
			) {
				return;
			}
			scrollbackActiveRef.current = event.active;
			scrollbackPhaseRef.current = event.phase;
			setScrollbackActive(event.active);
		},
		[],
	);

	const handleTmuxEnterCopyMode = useCallback(
		async (event: { instanceId: string; requestId: number }) => {
			if (
				currentInstanceIdRef.current &&
				event.instanceId !== currentInstanceIdRef.current
			) {
				return;
			}
			const targetName = tmuxTarget.trim().length ? tmuxTarget.trim() : 'main';
			const command = buildTmuxScrollbackCopyModeCommand(targetName);
			if (!(await sendTmuxControlCommand(command))) {
				logger.warn(
					'tmux touch-scroll entry unavailable without tmux control shell',
				);
				return;
			}
			xtermRef.current?.sendTmuxEnterCopyModeAck(
				event.requestId,
				event.instanceId,
			);
		},
		[sendTmuxControlCommand, tmuxTarget],
	);

	const handleTmuxScrollBatch = useCallback(
		(event: {
			direction: 'up' | 'down';
			pages: number;
			lines: number;
			instanceId: string;
		}) => {
			if (!shell) return;
			if (
				currentInstanceIdRef.current &&
				event.instanceId !== currentInstanceIdRef.current
			) {
				return;
			}
			if (selectionModeEnabled) return;
			if (!tmuxEnabled || !tmuxControlReady) return;

			const pages = Math.max(0, event.pages);
			const lines = Math.max(0, event.lines);
			if (!pages && !lines) return;

			const targetName = tmuxTarget.trim().length ? tmuxTarget.trim() : 'main';
			const safeTarget = targetName.replace(/'/g, "'\\''");
			const targetArg = `'${safeTarget}'`;
			const pageCmd = event.direction === 'up' ? 'page-up' : 'page-down';
			const lineCmd = event.direction === 'up' ? 'scroll-up' : 'scroll-down';
			const parts: string[] = [];
			if (pages > 0) {
				parts.push(`send-keys -t ${targetArg} -N ${pages} -X ${pageCmd}`);
			}
			if (lines > 0) {
				parts.push(`send-keys -t ${targetArg} -N ${lines} -X ${lineCmd}`);
			}
			if (parts.length === 0) return;
			const command = `tmux ${parts.join(' \\; ')}`;
			void (async () => {
				if (await sendTmuxControlCommand(command)) return;
				logger.warn(
					'tmux touch-scroll batch unavailable without tmux control shell',
				);
			})();
		},
		[
			shell,
			selectionModeEnabled,
			sendTmuxControlCommand,
			tmuxControlReady,
			tmuxTarget,
			tmuxEnabled,
		],
	);

	const handleWebViewInput = useCallback(
		(input: { str: string; kind: 'typing' | 'scroll'; instanceId: string }) => {
			if (!shell) return;
			if (
				currentInstanceIdRef.current &&
				input.instanceId !== currentInstanceIdRef.current
			) {
				return;
			}
			const bytes = encoder.encode(input.str);
			if (input.kind === 'scroll') {
				if (selectionModeEnabled) return;
				void sendBytesOrdered(bytes);
				return;
			}
			if (selectionModeEnabled) exitSelectionMode();
			sendInputEnsuringLive(bytes);
		},
		[
			shell,
			sendBytesOrdered,
			sendInputEnsuringLive,
			selectionModeEnabled,
			exitSelectionMode,
		],
	);

	const handleTerminalCrashRetry = useCallback(() => {
		// Navigate back to trigger auto-reconnect flow
		router.back();
	}, [router]);

	const handleJumpToLive = useCallback(() => {
		if (!isValidCancelKey(cancelKeyBytes)) {
			logger.warn('cancelKey invalid; cannot auto-exit scrollback');
			return;
		}
		void sendBytesOrdered(cancelKeyBytes);
		clearScrollbackState();
	}, [cancelKeyBytes, sendBytesOrdered, clearScrollbackState]);

	const writeShellChunkToTerminal = useCallback((bytesBuffer: ArrayBuffer) => {
		const bytes = new Uint8Array(bytesBuffer);
		xtermRef.current?.write(bytes);
	}, []);

	const attachShellToTerminal = useCallback(() => {
		if (!terminalReady) return;
		if (!shell) return;
		const xterm = xtermRef.current;
		if (!xterm) return;

		const shellKey = `${shell.connectionId}-${shell.channelId}`;
		if (attachedShellKeyRef.current !== shellKey) {
			hasAttachedOnceRef.current = false;
		}
		if (
			listenerIdRef.current != null &&
			attachedShellKeyRef.current === shellKey
		) {
			return;
		}

		if (listenerIdRef.current != null) {
			try {
				shell.removeListener(listenerIdRef.current);
			} catch (error) {
				logger.warn('Failed to remove prior shell listener', error);
			}
			listenerIdRef.current = null;
		}
		attachedShellKeyRef.current = shellKey;

		if (Platform.OS === 'android') {
			xterm.setSystemKeyboardEnabled(true);
			// eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- Called from an attach routine invoked in an effect; keep UI in sync.
			setSystemKeyboardEnabled(true);
		}
		xterm.setSelectionModeEnabled(selectionModeEnabled);

		void (async () => {
			if (!hasAttachedOnceRef.current) {
				const res = shell.readBuffer({ mode: 'head' });
				logger.info('readBuffer(head)', {
					chunks: res.chunks.length,
					nextSeq: res.nextSeq,
					dropped: res.dropped,
				});
				if (res.chunks.length) {
					const chunks = res.chunks.map((c) => c.bytes);
					xterm.writeMany(chunks.map((c) => new Uint8Array(c)));
					xterm.flush();
				}
				const id = shell.addListener(
					(ev: ListenerEvent) => {
						if ('kind' in ev) {
							logger.warn('listener.dropped', ev);
							return;
						}
						const chunk = ev;
						writeShellChunkToTerminal(chunk.bytes);
					},
					{ cursor: { mode: 'seq', seq: res.nextSeq } },
				);
				logger.info('shell listener attached', id.toString());
				listenerIdRef.current = id;
				hasAttachedOnceRef.current = true;
				return;
			}

			const id = shell.addListener(
				(ev: ListenerEvent) => {
					if ('kind' in ev) {
						logger.warn('listener.dropped', ev);
						return;
					}
					const chunk = ev;
					writeShellChunkToTerminal(chunk.bytes);
				},
				{ cursor: { mode: 'live' } },
			);
			logger.info('shell listener attached (live)', id.toString());
			listenerIdRef.current = id;
		})();

		// Focus to pop the keyboard (iOS needs the prop we set).
		if (Platform.OS === 'ios') xterm.focus();
	}, [selectionModeEnabled, shell, terminalReady, writeShellChunkToTerminal]);

	const handleTerminalInitialized = useCallback(
		(instanceId: string) => {
			currentInstanceIdRef.current = instanceId;
			scrollbackActiveRef.current = false;
			scrollbackPhaseRef.current = 'active';
			setScrollbackActive(false);
			hasAttachedOnceRef.current = false;

			if (listenerIdRef.current != null && shell) {
				try {
					shell.removeListener(listenerIdRef.current);
				} catch (error) {
					logger.warn('Failed to remove prior shell listener', error);
				}
			}
			listenerIdRef.current = null;
			attachedShellKeyRef.current = null;

			setTerminalReady(true);
			setHasRenderedTerminal(true);
		},
		[shell],
	);

	useEffect(() => {
		attachShellToTerminal();
	}, [attachShellToTerminal]);

	const wisprMode = isWisprAutomationBusy(wisprAutomationState);
	const wisprStatusText = useMemo(() => {
		switch (wisprAutomationState.phase) {
			case 'openingTextEntry':
			case 'waitingForBubble':
				return 'Waiting for Wispr...';
			case 'recording':
				return 'Wispr recording.';
			case 'failed':
				return wisprAutomationState.message;
			default:
				return undefined;
		}
	}, [wisprAutomationState]);

	if (hasTmuxAttachError) {
		return (
			<TmuxAttachErrorScreen
				sessionName={tmuxSessionName ?? 'main'}
				onEdit={() => {
					router.replace({
						pathname: '/',
						params: { editConnectionId: storedConnectionId ?? connectionId },
					});
				}}
			/>
		);
	}

	const shouldRenderTerminal =
		hasRenderedTerminal || Boolean(shell && connection);
	const scrollbackVisible = scrollbackActive;
	const showReconnectOverlay =
		(isAutoConnecting || isReconnecting) && (!shell || !connection);
	const ScrollbackIcon = resolveLucideIcon('ArrowDownToLine');
	if (!shouldRenderTerminal) {
		return isAutoConnecting || isReconnecting ? <RouteSkeleton /> : null;
	}

	return (
		<>
			<Stack.Screen options={{ headerShown: false }} />
			<KeyboardAvoidingView
				// On Android, window resizing already handles keyboard avoidance.
				// Keep KeyboardAvoidingView behavior only for iOS.
				behavior={Platform.OS === 'ios' ? 'height' : undefined}
				keyboardVerticalOffset={0}
				style={{
					flex: 1,
					backgroundColor: theme.colors.background,
					// Respect system status/navigation bars on Android.
					paddingTop: Platform.OS === 'android' ? insets.top : 0,
					// Keep a small breathing gap above the Android navigation bar.
					paddingBottom: Platform.OS === 'android' ? insets.bottom + 4 : 0,
				}}
			>
				<TerminalErrorBoundary onRetry={handleTerminalCrashRetry}>
					<View style={{ flex: 1 }}>
						<XtermJsWebView
							ref={xtermRef}
							style={{ flex: 1 }}
							webViewOptions={{
								// Prevent iOS from adding automatic top inset inside WebView
								contentInsetAdjustmentBehavior: 'never',
								onLayout: () => {
									// Refit terminal when container size changes
									xtermRef.current?.fit();
								},
							}}
							logger={{
								log: logger.info,
								// debug: logger.debug,
								warn: logger.warn,
								error: logger.error,
							}}
							xtermOptions={{
								theme: {
									background: theme.colors.background,
									foreground: theme.colors.textPrimary,
									...(Platform.OS === 'android'
										? {
												// Android: reverse-style selection for readability; iOS keeps the default blue highlight.
												selectionBackground: '#F5F5F5',
												selectionForeground: '#000000',
												selectionInactiveBackground: 'rgba(255, 255, 255, 0.6)',
											}
										: {
												selectionBackground: 'rgba(37, 99, 235, 0.35)',
												selectionInactiveBackground: 'rgba(37, 99, 235, 0.2)',
											}),
								},
							}}
							touchScrollConfig={touchScrollConfig}
							onResize={handleTerminalResize}
							onSelection={handleSelectionChanged}
							onSelectionModeChange={handleSelectionModeChange}
							onInitialized={handleTerminalInitialized}
							onInput={handleWebViewInput}
							onScrollbackModeChange={handleScrollbackModeChange}
							onTmuxEnterCopyMode={handleTmuxEnterCopyMode}
							onTmuxScrollBatch={handleTmuxScrollBatch}
						/>
						{scrollbackVisible && (
							<Pressable
								onPress={handleJumpToLive}
								style={{
									position: 'absolute',
									right: 16,
									bottom: 16,
									width: 48,
									height: 48,
									borderRadius: 999,
									alignItems: 'center',
									justifyContent: 'center',
									backgroundColor: 'rgba(15, 23, 42, 0.92)',
									borderWidth: 1,
									borderColor: 'rgba(148, 163, 184, 0.35)',
								}}
							>
								{ScrollbackIcon ? (
									<ScrollbackIcon color={theme.colors.textPrimary} size={20} />
								) : null}
							</Pressable>
						)}
					</View>
				</TerminalErrorBoundary>
				<TerminalKeyboard
					keyboard={currentKeyboard}
					modifierKeysActive={modifierKeysActive}
					onSlotPress={handleSlotPress}
					selectionModeEnabled={selectionModeEnabled}
					onCopySelection={handleCopySelection}
				/>
				<CommandPresetsModal
					open={commandPresetsOpen}
					presets={shellConfig.commandMenus}
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					onClose={() => {
						setCommandPresetsOpen(false);
					}}
					onSelect={runCommandPreset}
				/>
				<TerminalCommanderModal
					open={commanderOpen}
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					onClose={() => {
						setCommanderOpen(false);
					}}
					onExecuteCommand={(value) => {
						if (!value.trim()) return;
						sendTextRaw(value);
						sendBytesRaw(encoder.encode('\r'));
					}}
					onPasteText={(value) => {
						if (!value.trim()) return;
						sendTextRaw(value);
					}}
					onSendShortcut={(sequence) => {
						sendBytesRaw(encoder.encode(sequence));
					}}
				/>
				<TextEntryModal
					open={textEntryOpen}
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					wisprMode={wisprMode}
					wisprStatusText={wisprStatusText}
					onWisprSetup={
						wisprAutomationState.phase === 'failed' &&
						wisprAutomationState.reason === 'service-disabled'
							? handleOpenWisprAutomationSettings
							: undefined
					}
					onClose={handleCloseTextEntry}
					onPaste={handlePasteTextEntry}
					onWisprFocus={handleWisprTextEntryFocus}
					onValueChange={handleWisprTextEntryValueChange}
				/>
				<HostUrlModal
					open={hostUrlModalState != null}
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					slotLabel={
						hostUrlModalState
							? getHostBrowserUrlSlotLabel(hostUrlModalState.slot)
							: 'URL'
					}
					initialValue={hostUrlModalState?.initialValue ?? ''}
					mode={hostUrlModalState?.mode ?? 'edit'}
					isSubmitting={hostUrlModalSubmitting}
					error={hostUrlModalError}
					onClose={handleCloseHostUrlModal}
					onSubmit={handleSubmitHostUrlModal}
				/>
				<ConfigureModal
					open={configureOpen}
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					onClose={() => {
						setConfigureOpen(false);
					}}
					onDevServer={handleDevServer}
					onReloadConfig={handleReloadConfig}
					onHostConfig={handleHostConfig}
					onOpenGitHubIssues={handleOpenGitHubIssues}
					onOpenShellConfigDocs={handleOpenShellConfigDocs}
					onRequestFeature={handleOpenFeatureRequest}
					configVersion={shellConfig.version}
					configUpdatedAt={shellConfig.updatedAt}
					configSource={shellConfigState.source}
					configLastLoadedAt={shellConfigState.lastLoadedAt}
					configLastError={shellConfigState.lastError}
				/>
				<FeatureRequestModal
					open={featureRequestOpen}
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					onClose={() => {
						setFeatureRequestOpen(false);
						setFeatureRequestSubmitting(false);
						setFeatureRequestError(undefined);
					}}
					onSubmit={handleFeatureRequestSubmit}
					isSubmitting={featureRequestSubmitting}
					error={featureRequestError}
				/>
				{showReconnectOverlay && (
					<View
						style={{
							position: 'absolute',
							top: 0,
							left: 0,
							right: 0,
							bottom: 0,
							alignItems: 'center',
							justifyContent: 'center',
							backgroundColor: theme.colors.overlay,
						}}
					>
						<View
							style={{
								paddingHorizontal: 20,
								paddingVertical: 16,
								borderRadius: 12,
								backgroundColor: theme.colors.surface,
								borderWidth: 1,
								borderColor: theme.colors.border,
								alignItems: 'center',
							}}
						>
							<ActivityIndicator color={theme.colors.textPrimary} />
							<Text
								style={{
									marginTop: 8,
									color: theme.colors.textPrimary,
									fontSize: 16,
									fontWeight: '600',
								}}
							>
								Reconnecting...
							</Text>
							<Text
								style={{
									marginTop: 4,
									color: theme.colors.textSecondary,
									fontSize: 12,
								}}
							>
								Keeping your session ready
							</Text>
						</View>
					</View>
				)}
				{flashKeyboardName && (
					<Animated.View
						pointerEvents="none"
						style={{
							position: 'absolute',
							top: '40%',
							left: 0,
							right: 0,
							alignItems: 'center',
							opacity: flashOpacity,
						}}
					>
						<View
							style={{
								backgroundColor: 'rgba(0, 0, 0, 0.75)',
								paddingHorizontal: 20,
								paddingVertical: 10,
								borderRadius: 8,
							}}
						>
							<Text
								style={{
									color: '#fff',
									fontSize: 16,
									fontWeight: '600',
								}}
							>
								{flashKeyboardName}
							</Text>
						</View>
					</Animated.View>
				)}
			</KeyboardAvoidingView>
		</>
	);
}
type ModifierContract = {
	canApplyModifierToBytes: (bytes: Uint8Array<ArrayBuffer>) => boolean;
	applyModifierToBytes: (
		bytes: Uint8Array<ArrayBuffer>,
	) => Uint8Array<ArrayBuffer>;
	orderPreference: number;
};

const escapeByte = 27;

const shiftModifier: ModifierContract = {
	orderPreference: 5,
	canApplyModifierToBytes: (bytes) =>
		bytes.some((byte) => byte >= 97 && byte <= 122),
	applyModifierToBytes: (bytes) => {
		const next = new Uint8Array(bytes.length);
		for (let i = 0; i < bytes.length; i += 1) {
			const byte = bytes[i];
			if (byte === undefined) continue;
			next[i] = byte >= 97 && byte <= 122 ? byte - 32 : byte;
		}
		return next;
	},
};

const ctrlModifier: ModifierContract = {
	orderPreference: 10,
	canApplyModifierToBytes: (bytes) => {
		const firstByte = bytes[0];
		if (firstByte === undefined) return false;
		return mapByteToCtrl(firstByte) != null;
	},
	applyModifierToBytes: (bytes) => {
		const firstByte = bytes[0];
		if (firstByte === undefined) return bytes;
		const ctrlByte = mapByteToCtrl(firstByte);
		if (ctrlByte == null) return bytes;
		return new Uint8Array([ctrlByte]);
	},
};

const altModifier: ModifierContract = {
	orderPreference: 20,
	canApplyModifierToBytes: (bytes) => {
		return bytes.length > 0 && bytes[0] !== escapeByte;
	},
	applyModifierToBytes: (bytes) => {
		const result = new Uint8Array(bytes.length + 1);
		result[0] = escapeByte;
		result.set(bytes, 1);
		return result;
	},
};

function mapByteToCtrl(byte: number): number | null {
	if (byte === 32) return 0; // Ctrl+Space
	const uppercase = byte & 0b1101_1111; // Fold to uppercase / control range
	if (uppercase >= 64 && uppercase <= 95) {
		return uppercase & 0x1f;
	}
	if (byte === 63) return 127; // Ctrl+?
	return null;
}

const cmdModifier: ModifierContract = {
	orderPreference: 30,
	canApplyModifierToBytes: () => false,
	applyModifierToBytes: (bytes) => bytes,
};

const MODIFIER_DEFS: Record<ModifierKey, ModifierContract> = {
	SHIFT: shiftModifier,
	CTRL: ctrlModifier,
	ALT: altModifier,
	CMD: cmdModifier,
};
