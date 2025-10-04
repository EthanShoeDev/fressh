import { Ionicons } from '@expo/vector-icons';
import { type ListenerEvent } from '@fressh/react-native-uniffi-russh';
import {
	XtermJsWebView,
	type XtermWebViewHandle,
} from '@fressh/react-native-xtermjs-webview';

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
import { KeyboardAvoidingView, Pressable, Text, View } from 'react-native';
import { rootLogger } from '@/lib/logger';
import { useSshStore } from '@/lib/ssh-store';
import { useTheme } from '@/lib/theme';
import { useBottomTabSpacing } from '@/lib/useBottomTabSpacing';
import { useContextSafe } from '@/lib/utils';

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

const encoder = new TextEncoder();

function ShellDetail() {
	const xtermRef = useRef<XtermWebViewHandle>(null);
	const listenerIdRef = useRef<bigint | null>(null);

	const searchParams = useLocalSearchParams<{
		connectionId?: string;
		channelId?: string;
	}>();

	if (!searchParams.connectionId || !searchParams.channelId)
		throw new Error('Missing connectionId or channelId');

	const connectionId = searchParams.connectionId;
	const channelId = parseInt(searchParams.channelId);

	const router = useRouter();
	const theme = useTheme();

	const shell = useSshStore(
		(s) => s.shells[`${connectionId}-${channelId}` as const],
	);
	const connection = useSshStore((s) => s.connections[connectionId]);

	useEffect(() => {
		if (shell && connection) return;
		logger.info('shell or connection not found, replacing route with /shell');
		router.back();
	}, [connection, router, shell]);

	useEffect(() => {
		const xterm = xtermRef.current;
		return () => {
			if (shell && listenerIdRef.current != null)
				shell.removeListener(listenerIdRef.current);
			listenerIdRef.current = null;
			if (xterm) xterm.flush();
		};
	}, [shell]);

	const marginBottom = useBottomTabSpacing();

	const [modifierKeysActive, setModifierKeysActive] = useState<
		KeyboardToolbarModifierButtonProps[]
	>([]);

	const sendBytes = useCallback(
		(bytes: Uint8Array<ArrayBuffer>) => {
			if (!shell) return;

			modifierKeysActive
				.sort((a, b) => a.orderPreference - b.orderPreference)
				.forEach((m) => {
					if (!m.canApplyModifierToBytes(bytes)) return;
					bytes = m.applyModifierToBytes(bytes);
				});

			shell.sendData(bytes.buffer).catch((e: unknown) => {
				logger.warn('sendData failed', e);
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
					marginBottom,
					flex: 1,
				}}
			>
				<Stack.Screen
					options={{
						headerBackVisible: true,
						headerRight: () => (
							<Pressable
								accessibilityLabel="Disconnect"
								hitSlop={10}
								onPress={async () => {
									logger.info('Disconnect button pressed');
									if (!connection) return;
									try {
										await connection.disconnect();
									} catch (e) {
										logger.warn('Failed to disconnect', e);
									}
								}}
							>
								<Ionicons name="power" size={20} color={theme.colors.primary} />
							</Pressable>
						),
					}}
				/>
				<KeyboardAvoidingView
					behavior="height"
					keyboardVerticalOffset={120}
					style={{ flex: 1, gap: 4 }}
				>
					<KeyboardToolBarContext value={toolbarContext}>
						<View
							style={{
								flex: 1,
								borderWidth: 2,
								borderColor: theme.colors.border,
							}}
						>
							<XtermJsWebView
								ref={xtermRef}
								style={{ flex: 1 }}
								webViewOptions={{
									// Prevent iOS from adding automatic top inset inside WebView
									contentInsetAdjustmentBehavior: 'never',
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
									},
								}}
								onInitialized={() => {
									if (!shell) throw new Error('Shell not found');

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
									if (xr2) xr2.focus();
								}}
								onData={(terminalMessage) => {
									if (!shell) return;
									const bytes = encoder.encode(terminalMessage);
									sendBytes(bytes);
								}}
							/>
						</View>
						<KeyboardToolbar />
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

type KeyboardToolbarContextType = {
	modifierKeysActive: KeyboardToolbarModifierButtonProps[];
	setModifierKeysActive: React.Dispatch<
		React.SetStateAction<KeyboardToolbarModifierButtonProps[]>
	>;
	sendBytes: (bytes: Uint8Array<ArrayBuffer>) => void;
};
const KeyboardToolBarContext = createContext<KeyboardToolbarContextType | null>(
	null,
);

function KeyboardToolbar() {
	return (
		<View
			style={{
				height: 100,
			}}
		>
			<KeyboardToolbarRow>
				<KeyboardToolbarButtonPreset preset="esc" />
				<KeyboardToolbarButtonPreset preset="/" />
				<KeyboardToolbarButtonPreset preset="|" />
				<KeyboardToolbarButtonPreset preset="home" />
				<KeyboardToolbarButtonPreset preset="up" />
				<KeyboardToolbarButtonPreset preset="end" />
				<KeyboardToolbarButtonPreset preset="pgup" />
			</KeyboardToolbarRow>
			<KeyboardToolbarRow>
				<KeyboardToolbarButtonPreset preset="tab" />
				<KeyboardToolbarButtonPreset preset="ctrl" />
				<KeyboardToolbarButtonPreset preset="alt" />
				<KeyboardToolbarButtonPreset preset="left" />
				<KeyboardToolbarButtonPreset preset="down" />
				<KeyboardToolbarButtonPreset preset="right" />
				<KeyboardToolbarButtonPreset preset="pgdn" />
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
	| 'fn'
	| 'tab'
	| 'ctrl'
	| 'alt'
	| 'left'
	| 'down'
	| 'right'
	| 'insert'
	| 'delete'
	| 'pageup'
	| 'pagedown'
	| 'fn';

function KeyboardToolbarButtonPreset({
	preset,
}: {
	preset: KeyboardToolbarButtonPresetType;
}) {
	return (
		<KeyboardToolbarButton {...keyboardToolbarButtonPresetToProps[preset]} />
	);
}

type ModifierContract = {
	canApplyModifierToBytes: (bytes: Uint8Array<ArrayBuffer>) => boolean;
	applyModifierToBytes: (
		bytes: Uint8Array<ArrayBuffer>,
	) => Uint8Array<ArrayBuffer>;
	orderPreference: number;
};

const noOpModifier: ModifierContract = {
	canApplyModifierToBytes: (_) => false,
	applyModifierToBytes: (bytes) => bytes,
	orderPreference: 0,
};

const escapeByte = 27;

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
	fn: {
		label: 'FN',
		type: 'modifier',
		...noOpModifier,
	},
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

function KeyboardToolbarButton(props: KeyboardToolbarButtonProps) {
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
		props.type === 'modifier' && modifierKeysActive.includes(props);

	return (
		<Pressable
			onPress={() => {
				if (props.type === 'modifier') {
					setModifierKeysActive((modifierKeysActive) =>
						modifierKeysActive.includes(props)
							? modifierKeysActive.filter((m) => m !== props)
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
			style={[
				{
					flex: 1,
					alignItems: 'center',
					justifyContent: 'center',
					borderWidth: 1,
					borderColor: theme.colors.border,
				},
				modifierActive && { backgroundColor: theme.colors.primary },
			]}
		>
			{children}
		</Pressable>
	);
}
