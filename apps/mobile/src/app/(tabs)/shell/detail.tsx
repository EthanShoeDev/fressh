import { Ionicons } from '@expo/vector-icons';
import {
	scroll,
	SelectionKind,
	selectionClear,
	selectionStart,
	selectionText,
	selectionUpdate,
	Terminal,
} from '@fressh/react-native-terminal';
import * as Clipboard from 'expo-clipboard';

import {
	Stack,
	useLocalSearchParams,
	useRouter,
	useFocusEffect,
} from 'expo-router';
import React, {
	createContext,
	startTransition,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	Pressable,
	Text,
	TextInput,
	View,
	type StyleProp,
	type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { rootLogger } from '@/lib/logger';
import { useTerminalRenderConfig } from '@/lib/preferences';
import { useSshStore } from '@/lib/ssh-store';
import { useTheme } from '@/lib/theme';
import { useContextSafe } from '@/lib/utils';

type TerminalRenderConfig = ReturnType<typeof useTerminalRenderConfig>;

type IconName = keyof typeof Ionicons.glyphMap;

const logger = rootLogger.extend('TabsShellDetail');

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

	if (!ready) {
		return <RouteSkeleton />;
	}
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

const encoder = new TextEncoder();

function ShellDetail() {
	const inputRef = useRef<TextInput>(null);

	const searchParams = useLocalSearchParams<{
		connectionId?: string;
		channelId?: string;
	}>();

	if (!searchParams.connectionId || !searchParams.channelId) {
		throw new Error('Missing connectionId or channelId');
	}

	const { connectionId } = searchParams;
	const channelId = Number.parseInt(searchParams.channelId, 10);

	const router = useRouter();
	const theme = useTheme();
	const insets = useSafeAreaInsets();

	// Shells are keyed in the store by their native `shellId` (opaque), but the
	// route only carries connectionId + channelId — so resolve by those fields.
	const shell = useSshStore((s) =>
		Object.values(s.shells).find(
			(candidate) =>
				candidate.connectionId === connectionId &&
				candidate.channelId === channelId,
		),
	);
	const connection = useSshStore((s) => s.connections[connectionId]);
	const terminalConfig = useTerminalRenderConfig();

	useEffect(() => {
		if (shell && connection) {
			return;
		}
		logger.info('shell or connection not found, navigating back');
		router.back();
	}, [connection, router, shell]);

	const [modifierKeysActive, setModifierKeysActive] = useState<
		KeyboardToolbarModifierButtonProps[]
	>([]);

	const sendBytes = useCallback(
		(bytes: Uint8Array<ArrayBuffer>) => {
			if (!shell) {
				return;
			}

			let modifiedBytes = bytes;
			// NB: copy-then-sort ([...].sort), not Array.prototype.toSorted —
			// toSorted is ES2023 and isn't reliably present in Hermes, so calling it
			// throws "undefined is not a function" on the very first keystroke.
			[...modifierKeysActive]
				.sort((a, b) => a.orderPreference - b.orderPreference)
				.forEach((m) => {
					if (!m.canApplyModifierToBytes(modifiedBytes)) {
						return;
					}
					modifiedBytes = m.applyModifierToBytes(modifiedBytes);
				});

			shell.sendData(modifiedBytes.buffer).catch((error: unknown) => {
				logger.warn('sendData failed', error);
				router.back();
			});
		},
		[shell, router, modifierKeysActive],
	);
	const toolbarContext: KeyboardToolbarContextType = useMemo(
		() => ({
			modifierKeysActive,
			setModifierKeysActive,
			sendBytes,
		}),
		[sendBytes, modifierKeysActive],
	);

	return (
		<>
			<View
				style={{
					justifyContent: 'flex-start',
					backgroundColor: theme.colors.background,
					paddingTop: 2,
					paddingLeft: 8,
					paddingRight: 8,
					paddingBottom: 0,
					flex: 1,
				}}
			>
				<Stack.Screen
					options={{
						headerBackVisible: true,
						title: `${connection?.connectionDetails.username}@${connection?.connectionDetails.host}`,
						headerRight: () => (
							<Pressable
								accessibilityLabel='Close Shell'
								hitSlop={10}
								onPress={async () => {
									logger.info('Close Shell button pressed');
									if (!shell) {
										return;
									}
									try {
										await shell.close();
									} catch (error) {
										logger.warn('Failed to close shell', error);
									}
								}}
								style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
							>
								<Ionicons
									name='close'
									size={20}
									color={theme.colors.textPrimary}
								/>
								<Text style={{ color: theme.colors.textPrimary }}>
									Close Shell
								</Text>
							</Pressable>
						),
					}}
				/>
				{/* react-native-keyboard-controller's KeyboardAvoidingView (NOT RN's): on
						this edge-to-edge build only KC's actually shrinks the column when the
						IME opens, which resizes the terminal SurfaceView (surfaceChanged ->
						nativeResize -> new cell metrics) so touch coords stay aligned with
						surface pixels (RN's left the surface full-height -> selection mismatch).
						NO keyboardVerticalOffset — it desyncs the surface from the touch view
						and breaks alignment. The toolbar instead clears the keyboard via its own
						marginBottom (below). Paired with softwareKeyboardLayoutMode='resize'. */}
				<KeyboardAvoidingView behavior='height' style={{ flex: 1, gap: 4 }}>
					<KeyboardToolBarContext value={toolbarContext}>
						<View
							style={{
								flex: 1,
								borderWidth: 2,
								borderColor: theme.colors.border,
							}}
						>
							{shell ? (
								<TerminalSurface
									shellId={shell.shellId}
									config={terminalConfig}
									onTapEmpty={() => inputRef.current?.focus()}
								/>
							) : null}
							{/* Hidden input: captures soft-keyboard text/keys and forwards
									bytes to the shell. The native <Terminal/> only renders; input
									rides the control plane via sendBytes -> shell.sendData. */}
							<TextInput
								ref={inputRef}
								autoFocus
								value=''
								onChangeText={(text) => {
									if (!shell || !text) {
										return;
									}
									// Enter/Backspace are handled in onKeyPress; send the rest.
									const printable = text.replace(/\n/g, '');
									if (printable) {
										sendBytes(encoder.encode(printable));
									}
								}}
								onKeyPress={(e) => {
									if (!shell) {
										return;
									}
									const key = e.nativeEvent.key;
									if (key === 'Enter') {
										sendBytes(new Uint8Array([13]));
									} else if (key === 'Backspace') {
										sendBytes(new Uint8Array([127]));
									}
								}}
								autoCapitalize='none'
								autoComplete='off'
								autoCorrect={false}
								spellCheck={false}
								blurOnSubmit={false}
								caretHidden
								multiline
								style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
							/>
						</View>
						{/* Lift the toolbar above the gesture-nav inset so its 2nd row
								(CTRL/ALT) clears the keyboard — KC's KAV doesn't subtract the
								bottom inset. Done as marginBottom on the toolbar (not a KAV
								offset) so the terminal's size/mapping is untouched. */}
						<View style={{ marginBottom: insets.bottom }}>
							<KeyboardToolbar />
						</View>
					</KeyboardToolBarContext>
				</KeyboardAvoidingView>
			</View>
			{/* <KeyboardToolbar
				offset={{
					opened: -80,
				}}
			/> */}
		</>
	);
}

/**
 * The interactive terminal surface: renders the native <Terminal/> and layers
 * touch gestures over it. Gestures live here in JS (so the same code drives iOS
 * once it lands); they call the Rust control plane by `shellId`:
 *   - drag            → scroll (scrollback, or wheel/arrows when an app grabs the
 *                       mouse / runs full-screen — decided natively from term mode)
 *   - long-press+drag → select text (word-snapped), then a Copy button appears
 *   - tap             → dismiss a selection, else focus the hidden input (keyboard)
 *
 * Touch coordinates are sent to native as NORMALIZED fractions of this view's
 * measured size (0..1), not pixels — Rust maps the fraction straight onto the grid
 * columns/rows. That stays correct even if the SurfaceView buffer/metrics lag the
 * view size when the keyboard opens (a fraction of the view == a fraction of the
 * grid regardless of pixels). The view size is captured via onLayout below.
 */
function TerminalSurface({
	shellId,
	config,
	onTapEmpty,
}: {
	shellId: string;
	config: TerminalRenderConfig;
	onTapEmpty: () => void;
}) {
	const theme = useTheme();
	// Live size (logical px) of the gesture view, kept current via onLayout.
	const sizeRef = useRef({ width: 1, height: 1 });
	const fracX = (x: number) =>
		Math.min(1, Math.max(0, x / Math.max(1, sizeRef.current.width)));
	const fracY = (y: number) =>
		Math.min(1, Math.max(0, y / Math.max(1, sizeRef.current.height)));
	// When a selection finishes we stash its text + where to float the Copy button.
	// Capturing the text up front means a racing tap-to-dismiss can't empty it.
	const [pendingCopy, setPendingCopy] = useState<{
		x: number;
		y: number;
		text: string;
	} | null>(null);

	const dismissSelection = useCallback(() => {
		selectionClear(shellId);
		setPendingCopy(null);
	}, [shellId]);

	const gesture = useMemo(() => {
		// Quick drag → scroll. changeY>0 (finger down) reveals older content. Sent as
		// a fraction of view height; native multiplies by the grid's row count.
		const scrollPan = Gesture.Pan()
			.runOnJS(true)
			.onStart(() => setPendingCopy(null))
			.onChange((e) => {
				void scroll(shellId, e.changeY / Math.max(1, sizeRef.current.height)).catch(
					() => {},
				);
			});

		// Hold-then-drag → select. Word-snap on start, extend on move, surface the
		// Copy button (with the text captured now) on release.
		const selectPan = Gesture.Pan()
			.runOnJS(true)
			.activateAfterLongPress(300)
			.onStart((e) => {
				setPendingCopy(null);
				selectionStart(shellId, fracX(e.x), fracY(e.y), SelectionKind.Word);
			})
			.onUpdate((e) => {
				selectionUpdate(shellId, fracX(e.x), fracY(e.y));
			})
			.onEnd((e) => {
				const text = selectionText(shellId);
				if (text) {
					setPendingCopy({ x: e.x, y: e.y, text });
				} else {
					dismissSelection();
				}
			});

		const tap = Gesture.Tap()
			.runOnJS(true)
			.onEnd(() => {
				if (pendingCopy) {
					dismissSelection();
				} else {
					onTapEmpty();
				}
			});

		// A held finger arms selectPan; an immediate drag wins scrollPan; a clean
		// tap takes the tap. Race = first to activate wins.
		return Gesture.Race(selectPan, scrollPan, tap);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [shellId, pendingCopy, dismissSelection, onTapEmpty]);

	const onCopy = useCallback(async () => {
		const text = pendingCopy?.text;
		setPendingCopy(null);
		selectionClear(shellId);
		if (text) {
			await Clipboard.setStringAsync(text);
		}
	}, [pendingCopy, shellId]);

	return (
		<View style={{ flex: 1 }}>
			<GestureDetector gesture={gesture}>
				<View
					style={{ flex: 1 }}
					onLayout={(e) => {
						sizeRef.current = {
							width: e.nativeEvent.layout.width,
							height: e.nativeEvent.layout.height,
						};
					}}
				>
					<Terminal
						shellId={shellId}
						fontPath=''
						config={config}
						style={{ flex: 1 }}
					/>
				</View>
			</GestureDetector>
			{pendingCopy ? (
				<Pressable
					accessibilityLabel='Copy selection'
					onPress={onCopy}
					style={{
						position: 'absolute',
						left: Math.max(4, pendingCopy.x - 32),
						top: Math.max(4, pendingCopy.y - 48),
						flexDirection: 'row',
						alignItems: 'center',
						gap: 6,
						paddingHorizontal: 14,
						paddingVertical: 8,
						borderRadius: 8,
						backgroundColor: theme.colors.primary,
					}}
				>
					<Ionicons
						name='copy-outline'
						size={16}
						color={theme.colors.textPrimary}
					/>
					<Text style={{ color: theme.colors.textPrimary }}>Copy</Text>
				</Pressable>
			) : null}
		</View>
	);
}

interface KeyboardToolbarContextType {
	modifierKeysActive: KeyboardToolbarModifierButtonProps[];
	setModifierKeysActive: React.Dispatch<
		React.SetStateAction<KeyboardToolbarModifierButtonProps[]>
	>;
	sendBytes: (bytes: Uint8Array<ArrayBuffer>) => void;
}
const KeyboardToolBarContext = createContext<KeyboardToolbarContextType | null>(
	null,
);

function KeyboardToolbar() {
	const theme = useTheme();
	return (
		<View
			style={{
				height: 100,
				borderWidth: 1,
				borderColor: theme.colors.border,
			}}
		>
			<KeyboardToolbarRow>
				<KeyboardToolbarButtonPreset preset='esc' />
				<KeyboardToolbarButtonPreset preset='/' />
				<KeyboardToolbarButtonPreset preset='|' />
				<KeyboardToolbarButtonPreset preset='home' />
				<KeyboardToolbarButtonPreset preset='up' />
				<KeyboardToolbarButtonPreset preset='end' />
				<KeyboardToolbarButtonPreset preset='pgup' />
			</KeyboardToolbarRow>
			<KeyboardToolbarRow>
				<KeyboardToolbarButtonPreset preset='tab' />
				<KeyboardToolbarButtonPreset preset='ctrl' />
				<KeyboardToolbarButtonPreset preset='alt' />
				<KeyboardToolbarButtonPreset preset='left' />
				<KeyboardToolbarButtonPreset preset='down' />
				<KeyboardToolbarButtonPreset preset='right' />
				<KeyboardToolbarButtonPreset preset='pgdn' />
			</KeyboardToolbarRow>
		</View>
	);
}

function KeyboardToolbarRow({ children }: { children?: React.ReactNode }) {
	return <View style={{ flexDirection: 'row', flex: 1 }}>{children}</View>;
}

type KeyboardToolbarButtonPresetType =
	| 'esc'
	| '/'
	| '|'
	| 'home'
	| 'up'
	| 'end'
	| 'pgup'
	| 'pgdn'
	| 'tab'
	| 'ctrl'
	| 'alt'
	| 'left'
	| 'down'
	| 'right'
	| 'insert'
	| 'delete'
	| 'pageup'
	| 'pagedown';

function KeyboardToolbarButtonPreset({
	preset,
	style,
}: {
	style?: StyleProp<ViewStyle>;
	preset: KeyboardToolbarButtonPresetType;
}) {
	return (
		<KeyboardToolbarButton
			{...keyboardToolbarButtonPresetToProps[preset]}
			style={style}
		/>
	);
}

interface ModifierContract {
	canApplyModifierToBytes: (bytes: Uint8Array<ArrayBuffer>) => boolean;
	applyModifierToBytes: (
		bytes: Uint8Array<ArrayBuffer>,
	) => Uint8Array<ArrayBuffer>;
	orderPreference: number;
}

const escapeByte = 27;

const ctrlModifier: ModifierContract = {
	orderPreference: 10,
	canApplyModifierToBytes: (bytes) => {
		const firstByte = bytes[0];
		if (firstByte === undefined) {
			return false;
		}
		return mapByteToCtrl(firstByte) !== null;
	},
	applyModifierToBytes: (bytes) => {
		const firstByte = bytes[0];
		if (firstByte === undefined) {
			return bytes;
		}
		const ctrlByte = mapByteToCtrl(firstByte);
		if (ctrlByte === null) {
			return bytes;
		}
		return new Uint8Array([ctrlByte]);
	},
};

const altModifier: ModifierContract = {
	orderPreference: 20,
	canApplyModifierToBytes: (bytes) =>
		bytes.length > 0 && bytes[0] !== escapeByte,
	applyModifierToBytes: (bytes) => {
		const result = new Uint8Array(bytes.length + 1);
		result[0] = escapeByte;
		result.set(bytes, 1);
		return result;
	},
};

function mapByteToCtrl(byte: number): number | null {
	if (byte === 32) {
		return 0;
	} // Ctrl+Space
	const uppercase = byte & 0b1101_1111; // Fold to uppercase / control range
	if (uppercase >= 64 && uppercase <= 95) {
		return uppercase & 0x1f;
	}
	if (byte === 63) {
		return 127;
	} // Ctrl+?
	return null;
}

const keyboardToolbarButtonPresetToProps: Record<
	KeyboardToolbarButtonPresetType,
	KeyboardToolbarButtonProps
> = {
	esc: { label: 'ESC', sendBytes: new Uint8Array([27]) },
	'/': { label: '/', sendBytes: new Uint8Array([47]) },
	'|': { label: '|', sendBytes: new Uint8Array([124]) },
	home: { label: 'HOME', sendBytes: new Uint8Array([27, 91, 72]) },
	end: { label: 'END', sendBytes: new Uint8Array([27, 91, 70]) },
	pgup: { label: 'PGUP', sendBytes: new Uint8Array([27, 91, 53, 126]) },
	pgdn: { label: 'PGDN', sendBytes: new Uint8Array([27, 91, 54, 126]) },
	tab: { label: 'TAB', sendBytes: new Uint8Array([9]) },
	left: { iconName: 'arrow-back', sendBytes: new Uint8Array([27, 91, 68]) },
	up: { iconName: 'arrow-up', sendBytes: new Uint8Array([27, 91, 65]) },
	down: { iconName: 'arrow-down', sendBytes: new Uint8Array([27, 91, 66]) },
	right: {
		iconName: 'arrow-forward',
		sendBytes: new Uint8Array([27, 91, 67]),
	},
	insert: { label: 'INSERT', sendBytes: new Uint8Array([27, 91, 50, 126]) },
	delete: { label: 'DELETE', sendBytes: new Uint8Array([27, 91, 51, 126]) },
	pageup: { label: 'PAGEUP', sendBytes: new Uint8Array([27, 91, 53, 126]) },
	pagedown: { label: 'PAGEDOWN', sendBytes: new Uint8Array([27, 91, 54, 126]) },
	ctrl: { label: 'CTRL', type: 'modifier', ...ctrlModifier },
	alt: { label: 'ALT', type: 'modifier', ...altModifier },
};

type KeyboardToolbarButtonViewProps =
	| {
			label: string;
	  }
	| {
			iconName: IconName;
	  };

type KeyboardToolbarModifierButtonProps = {
	type: 'modifier';
} & ModifierContract &
	KeyboardToolbarButtonViewProps;
type KeyboardToolbarInstantButtonProps = {
	type?: 'sendBytes';
	sendBytes: Uint8Array<ArrayBuffer>;
} & KeyboardToolbarButtonViewProps;

type KeyboardToolbarButtonProps =
	| KeyboardToolbarModifierButtonProps
	| KeyboardToolbarInstantButtonProps;

const propsToKey = (props: KeyboardToolbarButtonProps) =>
	'label' in props ? props.label : props.iconName;

function KeyboardToolbarButton({
	style,
	...props
}: KeyboardToolbarButtonProps & { style?: StyleProp<ViewStyle> }) {
	const theme = useTheme();
	const { sendBytes, modifierKeysActive, setModifierKeysActive } =
		useContextSafe(KeyboardToolBarContext);

	const isTextLabel = 'label' in props;
	const children = isTextLabel ? (
		<Text style={{ color: theme.colors.textPrimary }}>{props.label}</Text>
	) : (
		<Ionicons
			name={props.iconName}
			size={20}
			color={theme.colors.textPrimary}
		/>
	);

	const modifierActive =
		props.type === 'modifier' &&
		modifierKeysActive.some((m) => propsToKey(m) === propsToKey(props));

	return (
		<Pressable
			style={[
				{
					flex: 1,
					alignItems: 'center',
					justifyContent: 'center',
					borderWidth: 1,
					borderColor: theme.colors.border,
				},
				modifierActive && { backgroundColor: theme.colors.primary },
				style,
			]}
			onPress={() => {
				if (props.type === 'modifier') {
					setModifierKeysActive((modifierKeysActive) =>
						modifierKeysActive.some((m) => propsToKey(m) === propsToKey(props))
							? modifierKeysActive.filter(
									(m) => propsToKey(m) !== propsToKey(props),
								)
							: [...modifierKeysActive, props],
					);
					return;
				}

				if ('sendBytes' in props) {
					sendBytes(new Uint8Array(props.sendBytes));
					return;
				}
				throw new Error('Invalid button type');
			}}
		>
			{children}
		</Pressable>
	);
}
