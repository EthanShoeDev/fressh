import { type ListenerEvent } from '@fressh/react-native-uniffi-russh';
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
import * as LucideIcons from 'lucide-react-native';
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
	Animated,
	AppState,
	Keyboard,
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	useWindowDimensions,
	View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
	ACTIVE_KEYBOARD_IDS,
	DEFAULT_KEYBOARD_ID,
	KEYBOARDS_BY_ID,
	MACROS_BY_KEYBOARD_ID,
	type KeyboardDefinition,
	type KeyboardSlot,
	type MacroDef,
	type ModifierKey,
} from '@/generated/keyboard-config';
import { useAutoConnectStore } from '@/lib/auto-connect';
import {
	commandPresets,
	type CommandPreset,
	type CommandStep,
} from '@/lib/command-presets';
import { getStoredConnectionId } from '@/lib/connection-utils';
import {
	CONFIGURATOR_URL,
	HANDLE_DEV_SERVER_URL,
	runAction,
	type ActionContext,
	type ActionId,
} from '@/lib/keyboard-actions';
import { runMacro } from '@/lib/keyboard-runtime';
import { rootLogger } from '@/lib/logger';
import { useSshStore } from '@/lib/ssh-store';
import { useTheme } from '@/lib/theme';

const logger = rootLogger.extend('TabsShellDetail');

type OrderedWriteFn = (bytes: Uint8Array<ArrayBufferLike>) => Promise<void>;

const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

// Single-writer queue that guarantees no interleaving across all PTY writes.
class OrderedWriter {
	private tail: Promise<void> = Promise.resolve();

	constructor(private write: OrderedWriteFn) {}

	send(bytes: Uint8Array<ArrayBufferLike>) {
		return this.enqueue(async () => {
			await this.write(bytes);
		});
	}

	sendBatch(segments: Uint8Array<ArrayBufferLike>[], opts?: { interSegmentDelayMs?: number }) {
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

export default function TabsShellDetail() {
	const [ready, setReady] = useState(false);

	useFocusEffect(
		React.useCallback(() => {
			startTransition(() => {
				setTimeout(() => {
					// TODO: This is gross. It would be much better to switch
					// after the navigation animation completes.
					setReady(true);
				}, 16);
			});

			return () => {
				setReady(false);
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
const ALL_KEYBOARD_IDS = Object.keys(KEYBOARDS_BY_ID);
const ACTIVE_KEYBOARD_IDS_FALLBACK: readonly string[] =
	ACTIVE_KEYBOARD_IDS.length > 0 ? ACTIVE_KEYBOARD_IDS : ALL_KEYBOARD_IDS;
const DEFAULT_KEYBOARD_ID_FALLBACK =
	DEFAULT_KEYBOARD_ID || ACTIVE_KEYBOARD_IDS_FALLBACK[0] || '';

function ShellDetail() {
	const xtermRef = useRef<XtermWebViewHandle>(null);
	const listenerIdRef = useRef<bigint | null>(null);

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

	useEffect(() => {
		if (hasTmuxAttachError) return;
		if (shell && connection) return;
		const autoState = useAutoConnectStore.getState();
		if (autoState.isAutoConnecting || autoState.isReconnecting) return;
		logger.info('shell or connection not found, replacing route with /shell');
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
		const xterm = xtermRef.current;
		return () => {
			if (shell && listenerIdRef.current != null)
				shell.removeListener(listenerIdRef.current);
			listenerIdRef.current = null;
			if (xterm) xterm.flush();
		};
	}, [shell]);

	useEffect(() => {
		return () => {
			commandTimeoutsRef.current.forEach((timeout) => {
				clearTimeout(timeout);
			});
			commandTimeoutsRef.current = [];
		};
	}, []);

	const [selectedKeyboardId, setSelectedKeyboardId] = useState<string>(
		DEFAULT_KEYBOARD_ID_FALLBACK,
	);
	const availableKeyboardIds = useMemo(() => new Set(ALL_KEYBOARD_IDS), []);

	const currentKeyboard = useMemo<KeyboardDefinition | null>(() => {
		if (selectedKeyboardId && KEYBOARDS_BY_ID[selectedKeyboardId]) {
			return KEYBOARDS_BY_ID[selectedKeyboardId];
		}
		if (
			DEFAULT_KEYBOARD_ID_FALLBACK &&
			KEYBOARDS_BY_ID[DEFAULT_KEYBOARD_ID_FALLBACK]
		) {
			return KEYBOARDS_BY_ID[DEFAULT_KEYBOARD_ID_FALLBACK];
		}
		const fallbackId = ACTIVE_KEYBOARD_IDS_FALLBACK[0];
		return fallbackId ? (KEYBOARDS_BY_ID[fallbackId] ?? null) : null;
	}, [selectedKeyboardId]);

	const currentMacros = useMemo<MacroDef[]>(
		() =>
			currentKeyboard ? (MACROS_BY_KEYBOARD_ID[currentKeyboard.id] ?? []) : [],
		[currentKeyboard],
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
	const [systemKeyboardEnabled, setSystemKeyboardEnabled] = useState(false);
	const [selectionModeEnabled, setSelectionModeEnabled] = useState(false);
	const [commandPresetsOpen, setCommandPresetsOpen] = useState(false);
	const [commanderOpen, setCommanderOpen] = useState(false);
	const [scrollbackActive, setScrollbackActive] = useState(false);
	const scrollbackActiveRef = useRef(false);
	const scrollbackPhaseRef = useRef<'dragging' | 'active'>('active');
	const currentInstanceIdRef = useRef<string | null>(null);
	const writerRef = useRef<OrderedWriter | null>(null);
	const commandTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
	const lastSelectionRef = useRef<{ text: string; at: number } | null>(null);
	const { width, height } = useWindowDimensions();
	const touchScrollEnabled =
		Platform.OS === 'android' && Math.min(width, height) >= 600;
	const touchScrollConfig = useMemo<TouchScrollConfig>(
		() =>
			touchScrollEnabled
				? {
						enabled: true,
						pxPerLine: 16,
						slopPx: 10,
						maxLinesPerFrame: 6,
						flickVelocity: 1.2,
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

	const sendInputEnsuringLive = useCallback(
		(bytes: Uint8Array<ArrayBuffer>) => {
			if (!scrollbackActiveRef.current) {
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

	const runCommandPreset = useCallback(
		(preset: CommandPreset) => {
			exitSelectionMode();
			clearCommandTimeouts();
			let delay = 0;
			const baseDelay = 50;
			preset.steps.forEach((step) => {
				const stepDelay = step.delayMs ?? baseDelay;
				const timeoutId = setTimeout(() => {
					sendCommandStep(step);
				}, delay);
				commandTimeoutsRef.current.push(timeoutId);
				delay += stepDelay * (step.repeat ?? 1);
			});
			setCommandPresetsOpen(false);
		},
		[clearCommandTimeouts, exitSelectionMode, sendCommandStep],
	);

	const toggleModifier = useCallback((modifier: ModifierKey) => {
		setModifierKeysActive((prev) =>
			prev.includes(modifier)
				? prev.filter((entry) => entry !== modifier)
				: [...prev, modifier],
		);
	}, []);

	const rotateKeyboard = useCallback(() => {
		if (ACTIVE_KEYBOARD_IDS_FALLBACK.length <= 1) return;
		setSelectedKeyboardId((current) => {
			const idx = Math.max(0, ACTIVE_KEYBOARD_IDS_FALLBACK.indexOf(current));
			const nextIdx = (idx + 1) % ACTIVE_KEYBOARD_IDS_FALLBACK.length;
			return ACTIVE_KEYBOARD_IDS_FALLBACK[nextIdx] ?? current;
		});
	}, []);

	const selectKeyboardIfExists = useCallback(
		(id: string) => {
			if (!availableKeyboardIds.has(id)) return;
			setSelectedKeyboardId(id);
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
		})();
	}, [exitSelectionMode]);

	const handleSelectionChanged = useCallback((text: string) => {
		if (!text) return;
		const now = Date.now();
		if (lastSelectionRef.current?.text === text) return;
		lastSelectionRef.current = { text, at: now };
	}, []);

	const openConfigDialog = useCallback(() => {
		const editConnectionId = storedConnectionId ?? connectionId;
		Alert.alert(
			'Configure',
			'Choose where to go',
			[
				{
					text: 'Keyboard config',
					onPress: () => {
						void Linking.openURL(CONFIGURATOR_URL);
					},
				},
				{
					text: 'Handle dev server',
					onPress: () => {
						void Linking.openURL(HANDLE_DEV_SERVER_URL);
					},
				},
				{
					text: 'Host config',
					onPress: () => {
						router.replace({
							pathname: '/',
							params: { editConnectionId },
						});
					},
				},
				{ text: 'Cancel', style: 'cancel' },
			],
			{ cancelable: true },
		);
	}, [connectionId, router, storedConnectionId]);

	const actionContext = useMemo<ActionContext>(
		() => ({
			availableKeyboardIds,
			selectKeyboard: selectKeyboardIfExists,
			rotateKeyboard,
			openConfigurator: openConfigDialog,
			sendBytes: sendBytesRaw,
			pasteClipboard: handlePasteClipboard,
			copySelection: handleCopySelection,
			toggleCommandPresets: () => {
				setCommanderOpen(false);
				setCommandPresetsOpen((prev) => !prev);
			},
			openCommander: () => {
				setCommandPresetsOpen(false);
				setCommanderOpen(true);
			},
		}),
		[
			availableKeyboardIds,
			handleCopySelection,
			handlePasteClipboard,
			openConfigDialog,
			rotateKeyboard,
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
		(slot: KeyboardSlot) => {
			if (
				selectionModeEnabled &&
				!(slot.type === 'action' && slot.actionId === 'COPY_SELECTION')
			) {
				// Any input/command should exit selection first, except explicit copy.
				exitSelectionMode();
			}
			if (slot.type === 'modifier') {
				toggleModifier(slot.modifier);
				return;
			}
			if (slot.type === 'text') {
				sendTextWithModifiers(slot.text);
				return;
			}
			if (slot.type === 'bytes') {
				sendBytesWithModifiers(new Uint8Array(slot.bytes));
				return;
			}
			if (slot.type === 'macro') {
				const macro = currentMacros.find((entry) => entry.id === slot.macroId);
				if (!macro) return;
				runMacro(macro, {
					sendBytes: sendBytesRaw,
					sendText: sendTextRaw,
					onAction: handleAction,
				});
				return;
			}
			if (slot.type === 'action') {
				handleAction(slot.actionId);
				return;
			}
		},
		[
			currentMacros,
			exitSelectionMode,
			handleAction,
			sendBytesRaw,
			sendBytesWithModifiers,
			sendTextRaw,
			sendTextWithModifiers,
			selectionModeEnabled,
			toggleModifier,
		],
	);

	// Debounced PTY resize handler
	const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);

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
		};
	}, []);

	useEffect(() => {
		if (Platform.OS !== 'android') return;
		const dismissKeyboard = () => Keyboard.dismiss();
		dismissKeyboard();
		if (!systemKeyboardEnabled) {
			xtermRef.current?.setSystemKeyboardEnabled(false);
		}
		// eslint-disable-next-line @eslint-react/web-api/no-leaked-event-listener -- React Native AppState cleans up via subscription.remove()
		const subscription = AppState.addEventListener('change', (nextState) => {
			if (nextState === 'active') {
				if (!systemKeyboardEnabled) {
					xtermRef.current?.setSystemKeyboardEnabled(false);
					dismissKeyboard();
				}
			}
		});
		return () => {
			subscription.remove();
		};
	}, [systemKeyboardEnabled]);

	const disableSystemKeyboard = useCallback(() => {
		if (Platform.OS !== 'android') return;
		xtermRef.current?.setSystemKeyboardEnabled(false);
		Keyboard.dismiss();
		setSystemKeyboardEnabled(false);
	}, []);

	const toggleSystemKeyboard = useCallback(() => {
		if (Platform.OS !== 'android') return;
		const next = !systemKeyboardEnabled;
		setSystemKeyboardEnabled(next);
		xtermRef.current?.setSystemKeyboardEnabled(next);
		if (next) {
			exitSelectionMode();
			// Defer focus until after the button press releases.
			setTimeout(() => {
				xtermRef.current?.focus();
			}, 0);
		} else {
			Keyboard.dismiss();
		}
	}, [exitSelectionMode, systemKeyboardEnabled]);

	const handleSelectionModeChange = useCallback(
		(enabled: boolean) => {
			setSelectionModeEnabled(enabled);
			if (enabled) disableSystemKeyboard();
		},
		[disableSystemKeyboard],
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
			const prefixBytes = encoder.encode(tmuxPrefixKey);
			const copyModeBytes = encoder.encode(tmuxCopyModeKey);
			try {
				await sendBytesQueued([prefixBytes, copyModeBytes], {
					interSegmentDelayMs: touchEnterDelayMs,
				});
			} catch (error) {
				logger.warn('tmux enter copy-mode write failed', error);
			}
			xtermRef.current?.sendTmuxEnterCopyModeAck(
				event.requestId,
				event.instanceId,
			);
		},
		[sendBytesQueued],
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

	const handleTerminalInitialized = useCallback(
		(instanceId: string) => {
			currentInstanceIdRef.current = instanceId;
			scrollbackActiveRef.current = false;
			scrollbackPhaseRef.current = 'active';
			setScrollbackActive(false);

			if (!shell) throw new Error('Shell not found');
			if (Platform.OS === 'android') {
				xtermRef.current?.setSystemKeyboardEnabled(false);
				setSystemKeyboardEnabled(false);
			}
			xtermRef.current?.setSelectionModeEnabled(selectionModeEnabled);

			// Replay from head, then attach live listener
			void (async () => {
				const res = shell.readBuffer({ mode: 'head' });
				logger.info('readBuffer(head)', {
					chunks: res.chunks.length,
					nextSeq: res.nextSeq,
					dropped: res.dropped,
				});
				if (res.chunks.length) {
					const chunks = res.chunks.map((c) => c.bytes);
					const xr = xtermRef.current;
					if (xr) {
						xr.writeMany(chunks.map((c) => new Uint8Array(c)));
						xr.flush();
					}
				}
				const id = shell.addListener(
					(ev: ListenerEvent) => {
						if ('kind' in ev) {
							logger.warn('listener.dropped', ev);
							return;
						}
						const chunk = ev;
						const xr3 = xtermRef.current;
						if (xr3) xr3.write(new Uint8Array(chunk.bytes));
					},
					{ cursor: { mode: 'seq', seq: res.nextSeq } },
				);
				logger.info('shell listener attached', id.toString());
				listenerIdRef.current = id;
			})();
			// Focus to pop the keyboard (iOS needs the prop we set)
			const xr2 = xtermRef.current;
			if (xr2 && Platform.OS === 'ios') xr2.focus();
		},
		[shell, selectionModeEnabled],
	);

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

	const shouldRenderTerminal = Boolean(shell && connection);
	const scrollbackVisible = scrollbackActive;
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
									<ScrollbackIcon
										color={theme.colors.textPrimary}
										size={20}
									/>
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
					onPasteClipboard={handlePasteClipboard}
					showSystemKeyboardToggle={Platform.OS === 'android'}
					systemKeyboardEnabled={systemKeyboardEnabled}
					onToggleSystemKeyboard={toggleSystemKeyboard}
				/>
				<CommandPresetsModal
					open={commandPresetsOpen}
					presets={commandPresets}
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

type LucideIconComponent = React.ComponentType<{
	color?: string;
	size?: number;
}>;

function resolveLucideIcon(name: string | null): LucideIconComponent | null {
	if (!name) return null;
	const iconMap = LucideIcons as unknown as Record<string, LucideIconComponent>;
	const Icon = iconMap[name];
	return Icon ?? null;
}

function TerminalKeyboard({
	keyboard,
	modifierKeysActive,
	onSlotPress,
	selectionModeEnabled,
	onCopySelection,
	onPasteClipboard,
	showSystemKeyboardToggle,
	systemKeyboardEnabled,
	onToggleSystemKeyboard,
}: {
	keyboard: KeyboardDefinition | null;
	modifierKeysActive: ModifierKey[];
	onSlotPress: (slot: KeyboardSlot) => void;
	selectionModeEnabled: boolean;
	onCopySelection: () => void;
	onPasteClipboard: () => void;
	showSystemKeyboardToggle: boolean;
	systemKeyboardEnabled: boolean;
	onToggleSystemKeyboard: () => void;
}) {
	const theme = useTheme();
	const KeyboardIcon = resolveLucideIcon('Keyboard');
	const CopyIcon = resolveLucideIcon('Copy');
	const PasteIcon = resolveLucideIcon('ClipboardPaste');

	if (!keyboard) {
		return (
			<View
				style={{
					borderTopWidth: 1,
					borderColor: theme.colors.border,
					padding: 12,
				}}
			>
				<Text style={{ color: theme.colors.textSecondary }}>
					No keyboard configuration. Generate code to enable shortcuts.
				</Text>
			</View>
		);
	}

	/* eslint-disable @eslint-react/no-array-index-key */
	const rows = keyboard.grid.map((row, rowIndex) => (
		<View key={`row-${rowIndex}`} style={{ flexDirection: 'row' }}>
			{row.map((slot, colIndex) => {
				if (!slot) {
					return (
						<View
							key={`slot-${rowIndex}-${colIndex}`}
							style={{ flex: 1, margin: 2 }}
						/>
					);
				}

				const modifierActive =
					slot.type === 'modifier' &&
					modifierKeysActive.includes(slot.modifier);
				const Icon = resolveLucideIcon(slot.icon);

				return (
					<Pressable
						key={`slot-${rowIndex}-${colIndex}`}
						onPress={() => onSlotPress(slot)}
						style={[
							{
								flex: 1,
								margin: 2,
								paddingVertical: 6,
								borderRadius: 8,
								borderWidth: 1,
								borderColor: theme.colors.border,
								alignItems: 'center',
								justifyContent: 'center',
							},
							modifierActive && {
								backgroundColor: theme.colors.primary,
							},
						]}
					>
						{Icon ? <Icon color={theme.colors.textPrimary} size={18} /> : null}
						<Text
							numberOfLines={1}
							style={{
								color: theme.colors.textPrimary,
								fontSize: 10,
								marginTop: Icon ? 2 : 0,
							}}
						>
							{slot.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	));
	/* eslint-enable @eslint-react/no-array-index-key */

	const copyToggle = (
		<Pressable
			onPress={onCopySelection}
			style={{
				flex: 1,
				margin: 2,
				paddingVertical: 6,
				borderRadius: 8,
				borderWidth: 1,
				borderColor: theme.colors.border,
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			{CopyIcon ? (
				<CopyIcon color={theme.colors.textPrimary} size={18} />
			) : null}
			<Text
				numberOfLines={1}
				style={{
					color: theme.colors.textPrimary,
					fontSize: 10,
					marginTop: CopyIcon ? 2 : 0,
				}}
			>
				Copy
			</Text>
		</Pressable>
	);

	const pasteToggle = (
		<Pressable
			onPress={onPasteClipboard}
			style={{
				flex: 1,
				margin: 2,
				paddingVertical: 6,
				borderRadius: 8,
				borderWidth: 1,
				borderColor: theme.colors.border,
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			{PasteIcon ? (
				<PasteIcon color={theme.colors.textPrimary} size={18} />
			) : null}
			<Text
				numberOfLines={1}
				style={{
					color: theme.colors.textPrimary,
					fontSize: 10,
					marginTop: PasteIcon ? 2 : 0,
				}}
			>
				Paste
			</Text>
		</Pressable>
	);

	const systemKeyboardToggle = showSystemKeyboardToggle ? (
		<Pressable
			onPress={onToggleSystemKeyboard}
			style={[
				{
					flex: 1,
					margin: 2,
					paddingVertical: 6,
					borderRadius: 8,
					borderWidth: 1,
					borderColor: theme.colors.border,
					alignItems: 'center',
					justifyContent: 'center',
				},
				systemKeyboardEnabled && { backgroundColor: theme.colors.primary },
			]}
		>
			{KeyboardIcon ? (
				<KeyboardIcon color={theme.colors.textPrimary} size={18} />
			) : null}
			<Text
				numberOfLines={1}
				style={{
					color: theme.colors.textPrimary,
					fontSize: 10,
					marginTop: KeyboardIcon ? 2 : 0,
				}}
			>
				OS Keyboard
			</Text>
		</Pressable>
	) : null;

	const toggleRow =
		selectionModeEnabled || showSystemKeyboardToggle ? (
			<View style={{ flexDirection: 'row' }}>
				{selectionModeEnabled ? copyToggle : null}
				{selectionModeEnabled ? pasteToggle : null}
				{systemKeyboardToggle}
			</View>
		) : null;

	return (
		<View
			style={{
				borderTopWidth: 1,
				borderColor: theme.colors.border,
				padding: 6,
			}}
		>
			{toggleRow}
			{rows}
		</View>
	);
}

const COMMANDER_SHORTCUTS = [
	{
		name: 'Ctrl+C',
		sequence: '\x03',
		description: 'Interrupt/Cancel current process',
	},
	{
		name: 'Ctrl+D',
		sequence: '\x04',
		description: 'End of file (EOF) / Exit',
	},
	{
		name: 'Ctrl+Z',
		sequence: '\x1a',
		description: 'Suspend current process',
	},
	{
		name: 'Ctrl+A',
		sequence: '\x01',
		description: 'Move cursor to beginning of line',
	},
	{
		name: 'Ctrl+E',
		sequence: '\x05',
		description: 'Move cursor to end of line',
	},
	{
		name: 'Ctrl+K',
		sequence: '\x0b',
		description: 'Kill/Delete from cursor to end of line',
	},
	{
		name: 'Ctrl+U',
		sequence: '\x15',
		description: 'Kill/Delete from cursor to beginning of line',
	},
	{
		name: 'Ctrl+W',
		sequence: '\x17',
		description: 'Delete word before cursor',
	},
	{
		name: 'Ctrl+L',
		sequence: '\x0c',
		description: 'Clear screen',
	},
	{
		name: 'Ctrl+R',
		sequence: '\x12',
		description: 'Reverse search command history',
	},
	{
		name: 'Tab',
		sequence: '\t',
		description: 'Auto-complete',
	},
	{
		name: 'Escape',
		sequence: '\x1b',
		description: 'Escape key',
	},
];

function CommandPresetsModal({
	open,
	presets,
	bottomOffset,
	onClose,
	onSelect,
}: {
	open: boolean;
	presets: CommandPreset[];
	bottomOffset: number;
	onClose: () => void;
	onSelect: (preset: CommandPreset) => void;
}) {
	const theme = useTheme();
	const uniquePresets = useMemo(() => {
		const seen = new Set<string>();
		return presets.filter((preset) => {
			const key = preset.label.trim();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}, [presets]);

	return (
		<Modal
			transparent
			visible={open}
			animationType="slide"
			onRequestClose={onClose}
		>
			<Pressable
				onPress={onClose}
				style={{
					flex: 1,
					backgroundColor: theme.colors.overlay,
					justifyContent: 'flex-end',
					alignItems: 'flex-end',
				}}
			>
				<View
					onStartShouldSetResponder={() => true}
					style={{
						backgroundColor: theme.colors.background,
						borderTopLeftRadius: 16,
						padding: 16,
						borderColor: theme.colors.borderStrong,
						borderWidth: 1,
						maxHeight: '80%',
						width: '70%',
						maxWidth: 320,
						minWidth: 240,
						marginRight: 8,
						marginBottom: bottomOffset,
					}}
				>
					<View
						style={{
							flexDirection: 'row',
							alignItems: 'center',
							justifyContent: 'space-between',
							marginBottom: 12,
						}}
					>
						<Text
							style={{
								color: theme.colors.textPrimary,
								fontSize: 18,
								fontWeight: '700',
							}}
						>
							Command Presets
						</Text>
						<Pressable
							onPress={onClose}
							style={{
								paddingHorizontal: 10,
								paddingVertical: 6,
								borderRadius: 8,
								borderWidth: 1,
								borderColor: theme.colors.border,
							}}
						>
							<Text style={{ color: theme.colors.textSecondary }}>Close</Text>
						</Pressable>
					</View>
					{uniquePresets.length === 0 ? (
						<Text style={{ color: theme.colors.textSecondary }}>
							No command presets configured.
						</Text>
					) : (
						<ScrollView>
							{uniquePresets.map((preset, index) => (
								<Pressable
									key={`${preset.label}-${index.toString()}`}
									onPress={() => onSelect(preset)}
									style={{
										paddingVertical: 12,
										paddingHorizontal: 12,
										borderRadius: 10,
										borderWidth: 1,
										borderColor: theme.colors.border,
										backgroundColor: theme.colors.surface,
										marginBottom: 8,
									}}
								>
									<Text
										style={{
											color: theme.colors.textPrimary,
											fontSize: 14,
											fontWeight: '600',
										}}
									>
										{preset.label}
									</Text>
								</Pressable>
							))}
						</ScrollView>
					)}
				</View>
			</Pressable>
		</Modal>
	);
}

function TerminalCommanderModal({
	open,
	bottomOffset,
	onClose,
	onExecuteCommand,
	onPasteText,
	onSendShortcut,
}: {
	open: boolean;
	bottomOffset: number;
	onClose: () => void;
	onExecuteCommand: (value: string) => void;
	onPasteText: (value: string) => void;
	onSendShortcut: (sequence: string) => void;
}) {
	const theme = useTheme();
	const [commandInput, setCommandInput] = useState('');
	const [pasteInput, setPasteInput] = useState('');

	const handleClose = useCallback(() => {
		setCommandInput('');
		setPasteInput('');
		onClose();
	}, [onClose]);

	return (
		<Modal
			transparent
			visible={open}
			animationType="slide"
			onRequestClose={handleClose}
		>
			<Pressable
				onPress={handleClose}
				style={{
					flex: 1,
					backgroundColor: theme.colors.overlay,
				}}
			>
				<KeyboardAvoidingView
					behavior={Platform.OS === 'ios' ? 'padding' : undefined}
					style={{ flex: 1, justifyContent: 'flex-end' }}
				>
					<View
						onStartShouldSetResponder={() => true}
						style={{
							backgroundColor: theme.colors.background,
							borderTopLeftRadius: 16,
							padding: 16,
							borderColor: theme.colors.borderStrong,
							borderWidth: 1,
							maxHeight: '85%',
							width: '70%',
							maxWidth: 360,
							minWidth: 260,
							alignSelf: 'flex-end',
							marginRight: 8,
							marginBottom: bottomOffset,
						}}
					>
						<View
							style={{
								flexDirection: 'row',
								alignItems: 'center',
								justifyContent: 'space-between',
								marginBottom: 12,
							}}
						>
							<Text
								style={{
									color: theme.colors.textPrimary,
									fontSize: 18,
									fontWeight: '700',
								}}
							>
								Terminal Commander
							</Text>
							<Pressable
								onPress={handleClose}
								style={{
									paddingHorizontal: 10,
									paddingVertical: 6,
									borderRadius: 8,
									borderWidth: 1,
									borderColor: theme.colors.border,
								}}
							>
								<Text style={{ color: theme.colors.textSecondary }}>Close</Text>
							</Pressable>
						</View>
						<ScrollView>
							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 14,
									fontWeight: '600',
									marginBottom: 6,
								}}
							>
								Execute Command
							</Text>
							<TextInput
								value={commandInput}
								onChangeText={setCommandInput}
								placeholder="ls -la"
								placeholderTextColor={theme.colors.muted}
								style={{
									borderWidth: 1,
									borderColor: theme.colors.border,
									backgroundColor: theme.colors.inputBackground,
									color: theme.colors.textPrimary,
									borderRadius: 10,
									paddingHorizontal: 12,
									paddingVertical: 10,
									marginBottom: 10,
								}}
							/>
							<Pressable
								onPress={() => {
									if (!commandInput.trim()) return;
									onExecuteCommand(commandInput);
									handleClose();
								}}
								style={{
									backgroundColor: theme.colors.primary,
									borderRadius: 10,
									paddingVertical: 12,
									alignItems: 'center',
									marginBottom: 16,
								}}
							>
								<Text
									style={{
										color: theme.colors.buttonTextOnPrimary,
										fontWeight: '700',
									}}
								>
									Execute
								</Text>
							</Pressable>
							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 14,
									fontWeight: '600',
									marginBottom: 6,
								}}
							>
								Paste Text
							</Text>
							<TextInput
								value={pasteInput}
								onChangeText={setPasteInput}
								placeholder="Enter text to paste..."
								placeholderTextColor={theme.colors.muted}
								style={{
									borderWidth: 1,
									borderColor: theme.colors.border,
									backgroundColor: theme.colors.inputBackground,
									color: theme.colors.textPrimary,
									borderRadius: 10,
									paddingHorizontal: 12,
									paddingVertical: 10,
									minHeight: 90,
									textAlignVertical: 'top',
									marginBottom: 10,
								}}
								multiline
							/>
							<Pressable
								onPress={() => {
									if (!pasteInput.trim()) return;
									onPasteText(pasteInput);
									handleClose();
								}}
								style={{
									backgroundColor: theme.colors.primary,
									borderRadius: 10,
									paddingVertical: 12,
									alignItems: 'center',
									marginBottom: 16,
								}}
							>
								<Text
									style={{
										color: theme.colors.buttonTextOnPrimary,
										fontWeight: '700',
									}}
								>
									Paste
								</Text>
							</Pressable>
							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 14,
									fontWeight: '600',
									marginBottom: 6,
								}}
							>
								Shortcuts
							</Text>
							{COMMANDER_SHORTCUTS.map((shortcut) => (
								<Pressable
									key={shortcut.name}
									onPress={() => {
										onSendShortcut(shortcut.sequence);
										handleClose();
									}}
									style={{
										paddingVertical: 12,
										paddingHorizontal: 12,
										borderRadius: 10,
										borderWidth: 1,
										borderColor: theme.colors.border,
										backgroundColor: theme.colors.surface,
										marginBottom: 8,
									}}
								>
									<Text
										style={{
											color: theme.colors.textPrimary,
											fontSize: 14,
											fontWeight: '600',
										}}
									>
										{shortcut.name}
									</Text>
									<Text
										style={{
											color: theme.colors.textSecondary,
											fontSize: 12,
											marginTop: 2,
										}}
									>
										{shortcut.description}
									</Text>
								</Pressable>
							))}
						</ScrollView>
					</View>
				</KeyboardAvoidingView>
			</Pressable>
		</Modal>
	);
}
