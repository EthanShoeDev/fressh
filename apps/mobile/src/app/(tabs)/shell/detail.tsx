import { Ionicons } from '@expo/vector-icons';
import { Terminal } from '@fressh/react-native-terminal';

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
	KeyboardAvoidingView,
	Pressable,
	Text,
	TextInput,
	View,
	type StyleProp,
	type ViewStyle,
} from 'react-native';
import { rootLogger } from '@/lib/logger';
import { preferences } from '@/lib/preferences';
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
	const [terminalFontSize] =
		preferences.terminalFontSize.useTerminalFontSizePref();

	useEffect(() => {
		if (shell && connection) {
			return;
		}
		logger.info('shell or connection not found, navigating back');
		router.back();
	}, [connection, router, shell]);

	const marginBottom = useBottomTabSpacing();

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
					marginBottom,
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
				<KeyboardAvoidingView
					behavior='height'
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
							{shell ? (
								<Pressable
									style={{ flex: 1 }}
									onPress={() => inputRef.current?.focus()}
								>
									<Terminal
										shellId={shell.shellId}
										fontPath=''
										fontSize={terminalFontSize}
										style={{ flex: 1 }}
									/>
								</Pressable>
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
