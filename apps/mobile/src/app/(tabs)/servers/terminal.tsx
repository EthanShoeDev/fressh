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
	ScrollView,
	Text,
	TextInput,
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
import { ContextBar } from '@/components/terminal/ContextBar';
import { PresetsToolbarPage } from '@/components/terminal/PresetsToolbarPage';
import type { Preset } from '@/lib/presets';
import { ThemedText } from '@/components/themed/ThemedText';
import { JS_TAB_BAR_HEIGHT, NATIVE_TAB_BAR_HEIGHT } from '@/lib/tab-bar-config';
import { applyCase, useThemeSkin } from '@/lib/theme-skin';
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
	// The JS bar's reserved space is exact (JS_TAB_BAR_HEIGHT + inset, by
	// construction). The native bar doesn't expose its height to JS (rns#3627), so
	// it's a GUESS: NATIVE_TAB_BAR_HEIGHT (iOS 49 / Android 80) + inset — the same
	// fixed estimate useBottomTabSpacing uses. We swapped off measureInWindow (flaky
	// timing) for this constant so there's a single, stable knob to tune: increasing
	// NATIVE_TAB_BAR_HEIGHT lowers the toolbar, decreasing it raises the toolbar.
	// See docs/projects/complete/toolbar-keyboard-by-construction.md.
	const [tabBarImpl] = preferences.tabBarImpl.useValue();
	const bottomReserved =
		(tabBarImpl === 'js' ? JS_TAB_BAR_HEIGHT : NATIVE_TAB_BAR_HEIGHT) +
		insets.bottom;
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
					headerTitle: () => (
						<ShellHeaderTitle
							title={`${connection?.connectionDetails.username}@${connection?.connectionDetails.host}`}
						/>
					),
					headerRight: () => (
						<CloseShellButton
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
						/>
					),
				}}
			/>
			{/* Fixed-height column (the window does NOT shrink for the IME here). We
						avoid for the keyboard ourselves via the toolbar's marginBottom below,
						which shrinks the flex:1 terminal by the keyboard height and triggers the
						deterministic surface resize. (A KeyboardAvoidingView resized the surface
						only inconsistently and clipped the 2nd toolbar row.) Paired with
						softwareKeyboardLayoutMode='resize'. */}
			<View className='flex-1 gap-1'>
				<KeyboardToolBarContext value={toolbarContext}>
					{/* Smart-terminal context bar — ambient cwd / command status / exit /
					    timing. A real row (not an overlay) so it never occludes output.
					    See docs/projects/smart-terminal-surface.md. */}
					{shell ? <ContextBar shellId={shell.shellId} /> : null}
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

/**
 * The native stack header's title for the shell — the `user@host` string in the
 * theme's mono voice, led by a glowing accent "live" dot, so it reads as a live
 * terminal session and matches the theme rather than the bare system title.
 */
function ShellHeaderTitle({ title }: { title: string }) {
	const skin = useThemeSkin();
	const [textPrimary, primary] = useCSSVariable([
		'--color-text-primary',
		'--color-primary',
	]) as [string, string];
	return (
		<View className='flex-row items-center gap-2'>
			<View
				style={{
					width: 7,
					height: 7,
					borderRadius: 4,
					backgroundColor: primary,
					boxShadow: skin.glow || undefined,
				}}
			/>
			<ThemedText
				mono
				numberOfLines={1}
				style={{
					color: textPrimary,
					fontSize: 16,
					fontWeight: '700',
					letterSpacing: skin.tracking || undefined,
				}}
			>
				{applyCase(skin, title)}
			</ThemedText>
		</View>
	);
}

/**
 * Themed header action that ends the shell, in each theme's voice:
 * - Brutalist (Monolith / `edgeToEdge`): a borderless `[ × CLOSE ]` in danger mono
 *   with bracket glyphs — matching the design's `[<x/>CLOSE]` convention.
 * - Everything else: a danger-tinted rounded pill.
 */
function CloseShellButton({ onPress }: { onPress: () => void }) {
	const skin = useThemeSkin();
	const danger = useCSSVariable('--color-danger') as string;

	if (skin.edgeToEdge) {
		const bracket = {
			color: danger,
			fontSize: 13,
			fontWeight: '700' as const,
			letterSpacing: skin.tracking || undefined,
		};
		return (
			<Pressable
				accessibilityLabel='Close Shell'
				hitSlop={10}
				onPress={onPress}
				className='flex-row items-center gap-1.5'
			>
				{/* `]` is its own element so the row gap sits before it too, giving an even
				    `[ x CLOSE ]` — gluing it as `CLOSE]` is what left the close bracket with
				    no breathing room while the open bracket looked padded. */}
				<ThemedText mono style={bracket}>
					[
				</ThemedText>
				<Ionicons name='close' size={13} color={danger} />
				<ThemedText mono style={bracket}>
					CLOSE
				</ThemedText>
				<ThemedText mono style={bracket}>
					]
				</ThemedText>
			</Pressable>
		);
	}

	return (
		<Pressable
			accessibilityLabel='Close Shell'
			hitSlop={10}
			onPress={onPress}
			className='flex-row items-center gap-1.5 px-2.5 py-1.5'
			style={{
				borderRadius: skin.controlRadius,
				borderWidth: 1,
				borderColor: danger,
			}}
		>
			<Ionicons name='close' size={15} color={danger} />
			<ThemedText style={{ color: danger, fontSize: 13, fontWeight: '600' }}>
				{applyCase(skin, 'Close')}
			</ThemedText>
		</Pressable>
	);
}

const TOOLBAR_PAGE_HEIGHT = 86;

function KeyboardToolbar() {
	const [terminalBg, border, primary, muted] = useCSSVariable([
		'--color-terminal-background',
		'--color-border',
		'--color-primary',
		'--color-muted',
	]) as [string, string, string, string];
	const { sendBytes } = useContextSafe(KeyboardToolBarContext);
	const [pageWidth, setPageWidth] = useState(0);
	const [page, setPage] = useState(0);

	// Run a preset: type its command into the PTY, with a trailing Enter unless the
	// user opted out (autoRun off ⇒ insert only, they edit + submit). See
	// docs/projects/future/preset-command-buttons.md.
	const onRunPreset = useCallback(
		(preset: Preset) => {
			sendBytes(encoder.encode(preset.command + (preset.autoRun ? '\r' : '')));
		},
		[sendBytes],
	);

	// Match the design's accessory bar: a hairline-topped strip in the terminal's
	// own colour. Page 1 is the modifier/nav keys (the default); page 2 is presets.
	// A paging ScrollView is enough — the bar sits below the terminal's gesture
	// zone, so its horizontal swipe never fights the scroll/select gestures.
	return (
		<View
			style={{
				borderTopWidth: 1,
				borderTopColor: border,
				backgroundColor: terminalBg,
				paddingHorizontal: 10,
				paddingTop: 8,
				paddingBottom: 6,
				gap: 4,
			}}
		>
			<View
				style={{ height: TOOLBAR_PAGE_HEIGHT }}
				onLayout={(e) => setPageWidth(e.nativeEvent.layout.width)}
			>
				<ScrollView
					horizontal
					pagingEnabled
					showsHorizontalScrollIndicator={false}
					keyboardShouldPersistTaps='handled'
					onMomentumScrollEnd={(e) =>
						setPage(
							Math.round(
								e.nativeEvent.contentOffset.x / Math.max(1, pageWidth),
							),
						)
					}
				>
					{/* Page 1 — modifier / nav keys (unchanged default). */}
					<View
						style={{ width: pageWidth, height: TOOLBAR_PAGE_HEIGHT, gap: 7 }}
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
					{/* Page 2 — preset commands. */}
					<View style={{ width: pageWidth, height: TOOLBAR_PAGE_HEIGHT }}>
						<PresetsToolbarPage onRun={onRunPreset} />
					</View>
				</ScrollView>
			</View>
			<PageDots
				count={2}
				active={page}
				activeColor={primary}
				dotColor={muted}
			/>
		</View>
	);
}

function PageDots({
	count,
	active,
	activeColor,
	dotColor,
}: {
	count: number;
	active: number;
	activeColor: string;
	dotColor: string;
}) {
	return (
		<View className='flex-row items-center justify-center gap-1.5'>
			{Array.from({ length: count }, (_, i) => (
				<View
					key={i}
					style={{
						width: i === active ? 14 : 6,
						height: 6,
						borderRadius: 3,
						backgroundColor: i === active ? activeColor : dotColor,
						opacity: i === active ? 1 : 0.5,
					}}
				/>
			))}
		</View>
	);
}

function KeyboardToolbarRow({ children }: { children?: React.ReactNode }) {
	return (
		<View className='flex-1 flex-row' style={{ gap: 7 }}>
			{children}
		</View>
	);
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
	const skin = useThemeSkin();
	const [textPrimaryColor, surface, border, primary, onPrimary] =
		useCSSVariable([
			'--color-text-primary',
			'--color-surface',
			'--color-border',
			'--color-primary',
			'--color-button-text-on-primary',
		]) as [string, string, string, string, string];
	const { sendBytes, modifierKeysActive, setModifierKeysActive } =
		useContextSafe(KeyboardToolBarContext);

	const modifierActive =
		props.type === 'modifier' &&
		modifierKeysActive.some((m) => propsToKey(m) === propsToKey(props));

	const fg = modifierActive ? onPrimary : textPrimaryColor;
	const isTextLabel = 'label' in props;
	const children = isTextLabel ? (
		<Text
			style={{
				color: fg,
				fontSize: 13,
				fontWeight: '600',
				fontFamily: skin.monoFamily,
			}}
		>
			{props.label}
		</Text>
	) : (
		<Ionicons name={props.iconName} size={20} color={fg} />
	);

	return (
		<Pressable
			className='flex-1 items-center justify-center'
			style={[
				{
					borderRadius: skin.controlRadius,
					borderWidth: 1,
					borderColor: modifierActive ? primary : border,
					backgroundColor: modifierActive ? primary : surface,
					boxShadow: modifierActive && skin.glow ? skin.glow : undefined,
				},
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
