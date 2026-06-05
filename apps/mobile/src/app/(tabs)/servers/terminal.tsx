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
	useWindowDimensions,
	View,
	type StyleProp,
	type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { KeyboardEvents } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { rootLogger } from '@/lib/logger';
import { preferences, useTerminalRenderConfig } from '@/lib/preferences';
import { useSshStore } from '@/lib/ssh-store';
import { JS_TAB_BAR_HEIGHT } from '@/lib/tab-bar-config';
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
	return (
		<View className='flex-1 items-center justify-center bg-background'>
			<Text className='text-[20px] text-text-primary'>Loading</Text>
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
	const insets = useSafeAreaInsets();
	const textPrimaryColor = useCSSVariable('--color-text-primary') as string;

	// Settled keyboard height (dp), from KC's did-show/did-hide (NOT the per-frame
	// animation). The window does NOT shrink for the IME on this edge-to-edge build,
	// so we shrink the terminal ourselves: growing the toolbar's marginBottom by this
	// amount makes the flex:1 terminal give up exactly that many dp. That layout change
	// is what fires the gesture view's onLayout AND the native SurfaceView's
	// onSizeChanged -> setFixedSize -> surfaceChanged -> nativeResize, so the grid,
	// surface buffer, and on-screen bounds stay in lockstep (selection stays aligned).
	// One resize per keyboard transition (no per-frame PTY reflow): correctness over
	// animation smoothness. See
	// docs/projects/complete/renderer-mismatched-selection-cutoff-scrollback.md.
	const [keyboardHeight, setKeyboardHeight] = useState(0);
	useEffect(() => {
		const show = KeyboardEvents.addListener('keyboardDidShow', (e) =>
			setKeyboardHeight(e.height),
		);
		const hide = KeyboardEvents.addListener('keyboardDidHide', () => {
			setKeyboardHeight(0);
			// Keep RN's JS-side focus state in sync with the actual keyboard: a manual
			// dismiss (keyboard's hide button / back gesture) hides the IME WITHOUT
			// blurring the hidden input, so RN still thinks it's focused and a later
			// onTapEmpty -> focus() is a no-op (no state change to re-open the IME).
			// Blurring here guarantees the next tap is a real unfocused->focused
			// transition, which reliably brings the keyboard back up.
			inputRef.current?.blur();
		});
		return () => {
			show.remove();
			hide.remove();
		};
	}, []);

	// The toolbar's marginBottom must clear the keyboard's overlap with THIS column,
	// not the whole screen. The column's bottom sits above the bottom tab bar, so we
	// subtract the space below the column (tab bar + nav inset) from the
	// screen-relative keyboard height — otherwise the toolbar floats a tab-bar-height
	// above the keyboard. (keyboardHeight is measured from the screen bottom.)
	//
	// With the JS tab bar that reserved space is known *by construction*
	// (JS_TAB_BAR_HEIGHT + the bottom inset the bar pads itself with), so we use it
	// directly — exact, no measurement timing. The native bar doesn't expose its
	// height to JS (see docs/toolbar-keyboard-by-construction.md + rns#3627), so for
	// it we keep measuring the column via measureInWindow.
	const [tabBarImpl] = preferences.tabBarImpl.useValue();
	const windowHeight = useWindowDimensions().height;
	const columnRef = useRef<View>(null);
	const [measuredBottomReserved, setMeasuredBottomReserved] = useState(
		insets.bottom,
	);
	const measureColumn = useCallback(() => {
		columnRef.current?.measureInWindow((_x, y, _w, h) => {
			if (h > 0) {
				setMeasuredBottomReserved(Math.max(0, windowHeight - (y + h)));
			}
		});
	}, [windowHeight]);
	const bottomReserved =
		tabBarImpl === 'js'
			? JS_TAB_BAR_HEIGHT + insets.bottom
			: measuredBottomReserved;
	const toolbarMarginBottom =
		keyboardHeight > 0
			? Math.max(keyboardHeight - bottomReserved, insets.bottom)
			: insets.bottom;

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
			// throws "undefined is not a function" on the very first keystroke. The
			// spread already makes a fresh copy, so the in-place .sort() mutates nothing
			// shared. (The unicorn/no-array-sort autofix is disabled globally for this
			// exact reason — see oxlint.config.ts.)
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
		<View className='flex-1 justify-start bg-background px-2 pt-0.5 pb-0'>
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
							className='flex-row items-center gap-1'
						>
							<Ionicons name='close' size={20} color={textPrimaryColor} />
							<Text className='text-text-primary'>Close Shell</Text>
						</Pressable>
					),
				}}
			/>
			{/* Fixed-height column (the window does NOT shrink for the IME here). We
						avoid for the keyboard ourselves via the toolbar's marginBottom below,
						which shrinks the flex:1 terminal by the keyboard height and triggers the
						deterministic surface resize. (A KeyboardAvoidingView resized the surface
						only inconsistently and clipped the 2nd toolbar row.) Paired with
						softwareKeyboardLayoutMode='resize'. */}
			<View ref={columnRef} onLayout={measureColumn} className='flex-1 gap-1'>
				<KeyboardToolBarContext value={toolbarContext}>
					<View className='flex-1 border-2 border-border'>
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
								const printable = text.replaceAll('\n', '');
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
							className='absolute h-px w-px opacity-0'
						/>
					</View>
					{/* marginBottom reserves space below the toolbar: the keyboard height
								when it's up (so both rows — incl. CTRL/ALT — clear the keyboard and
								the terminal shrinks to match), else the gesture-nav inset. This is
								the single knob that drives the deterministic terminal resize. */}
					<View style={{ marginBottom: toolbarMarginBottom }}>
						<KeyboardToolbar />
					</View>
				</KeyboardToolBarContext>
			</View>
		</View>
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
	const textPrimaryColor = useCSSVariable('--color-text-primary') as string;
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
				void scroll(
					shellId,
					e.changeY / Math.max(1, sizeRef.current.height),
				).catch((error: unknown) => {
					// Scroll is best-effort (a dropped frame is non-fatal), but still log.
					logger.warn('scroll failed', error);
				});
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
		<View className='flex-1'>
			<GestureDetector gesture={gesture}>
				<View
					className='flex-1'
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
					className='absolute flex-row items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2'
					style={{
						left: Math.max(4, pendingCopy.x - 32),
						top: Math.max(4, pendingCopy.y - 48),
					}}
				>
					<Ionicons name='copy-outline' size={16} color={textPrimaryColor} />
					<Text className='text-text-primary'>Copy</Text>
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
	return (
		<View className='h-[100px] border border-border'>
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
	return <View className='flex-1 flex-row'>{children}</View>;
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
	const textPrimaryColor = useCSSVariable('--color-text-primary') as string;
	const { sendBytes, modifierKeysActive, setModifierKeysActive } =
		useContextSafe(KeyboardToolBarContext);

	const isTextLabel = 'label' in props;
	const children = isTextLabel ? (
		<Text className='text-text-primary'>{props.label}</Text>
	) : (
		<Ionicons name={props.iconName} size={20} color={textPrimaryColor} />
	);

	const modifierActive =
		props.type === 'modifier' &&
		modifierKeysActive.some((m) => propsToKey(m) === propsToKey(props));

	return (
		<Pressable
			className={
				modifierActive
					? 'flex-1 items-center justify-center border border-border bg-primary'
					: 'flex-1 items-center justify-center border border-border'
			}
			style={style}
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
