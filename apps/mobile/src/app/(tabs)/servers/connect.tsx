import { useAtomRefresh, useAtomValue } from '@effect/atom-react';
import { FontAwesome6, MaterialCommunityIcons } from '@expo/vector-icons';
import { useStore } from '@tanstack/react-form';
import { useRouter } from 'expo-router';
import * as Effect from 'effect/Effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import React from 'react';
import {
	Modal,
	Pressable,
	ScrollView,
	type TextInput as RNTextInput,
	TextInput,
	View,
} from 'react-native';
import {
	KeyboardAvoidingView,
	useKeyboardState,
} from 'react-native-keyboard-controller';
import { useCSSVariable } from 'uniwind';
import { Button } from '@/components/themed/Button';
import { ScreenHeader } from '@/components/themed/ScreenHeader';
import {
	ThemedScreen,
	useSurfaceStyle,
} from '@/components/themed/ThemedScreen';
import { ThemedText } from '@/components/themed/ThemedText';
import { useAppForm, useFieldContext } from '@/components/form-components';
import { KeyList } from '@/components/key-manager/KeyList';
import { useHostKeyPromptPending } from '@/lib/host-keys';
import { preferences } from '@/lib/preferences';
import {
	useSshConnMutation,
	type SshConnectionProgress,
} from '@/lib/query-fns';
import { appRuntime } from '@/lib/runtime';
import {
	connectionDetailsStandardSchema,
	secretsManager,
	type InputConnectionDetails,
} from '@/lib/secrets-manager';
import { JS_TAB_BAR_HEIGHT } from '@/lib/tab-bar-config';
import { useThemeSkin } from '@/lib/theme-skin';
import { useJsTabBarOverlay } from '@/lib/useBottomTabSpacing';

const defaultValues: InputConnectionDetails = {
	host: '',
	port: 22,
	username: '',
	security: {
		type: 'password',
		password: '',
	},
};

export default function ConnectScreen() {
	const router = useRouter();
	const onPrimary = useCSSVariable('--color-button-text-on-primary') as string;
	const mutedColor = useCSSVariable('--color-muted') as string;
	const [lastConnectionProgressEvent, setLastConnectionProgressEvent] =
		React.useState<SshConnectionProgress | null>(null);

	// When the JS tab bar overlays the scene (canvas themes), the pinned footer
	// must clear it while the keyboard is down. SafeAreaView (edges includes
	// 'bottom') already supplies insets.bottom, so only the bar height remains.
	// With the keyboard up it covers the bar, and the KeyboardAvoidingView's
	// padding alone places the footer right above the keyboard — clearance off.
	const jsBarOverlay = useJsTabBarOverlay();
	const keyboardVisible = useKeyboardState((state) => state.isVisible);
	const footerClearance =
		jsBarOverlay && !keyboardVisible ? JS_TAB_BAR_HEIGHT : 0;

	// Honour the design's "Save to my servers" toggle. The connect mutation always
	// saved before; now it's conditional. A ref keeps the submit closure current.
	const [saveToServers, setSaveToServers] = React.useState(true);
	const saveRef = React.useRef(saveToServers);
	saveRef.current = saveToServers;

	// Per-host shell integration, seeded from the app-wide default. Stored with the
	// host (when saved) and used (ANDed with the global setting) for this connect.
	const [shellIntegration, setShellIntegration] = React.useState(() =>
		preferences.shellIntegrationEnabled.get(),
	);
	const shellIntegrationRef = React.useRef(shellIntegration);
	shellIntegrationRef.current = shellIntegration;

	const sshConnMutation = useSshConnMutation({
		onConnectionProgress: (s) => setLastConnectionProgressEvent(s),
	});

	const connectionForm = useAppForm({
		defaultValues,
		validators: {
			onChange: connectionDetailsStandardSchema,
			onSubmitAsync: ({ value }) =>
				sshConnMutation
					.mutateAsync(value, {
						save: saveRef.current,
						shellIntegration: shellIntegrationRef.current,
					})
					.then((success) => {
						setLastConnectionProgressEvent(null);
						// Swap this form for the terminal it just opened so backing out of
						// the terminal returns to the Servers list, not here.
						router.replace({
							pathname: '/servers/terminal',
							params: {
								connectionId: success.connectionId,
								channelId: String(success.channelId),
							},
						});
					}),
		},
	});

	const values = useStore(connectionForm.store, (state) => state.values);
	const securityType = values.security.type;
	const hostKeyPromptPending = useHostKeyPromptPending();
	const isSubmitting = useStore(
		connectionForm.store,
		(state) => state.isSubmitting,
	);

	const buttonLabel = (() => {
		if (!sshConnMutation.isPending) {
			return 'Connect';
		}
		if (lastConnectionProgressEvent === null) {
			return 'TCP Connecting…';
		}
		if (lastConnectionProgressEvent === 'tcpConnected') {
			return 'SSH Handshake…';
		}
		if (lastConnectionProgressEvent === 'sshHandshake') {
			return 'Authenticating…';
		}
		return 'Connected!';
	})();

	const submit = () => {
		appRuntime.runSync(
			Effect.logInfo('Connect button pressed', { isSubmitting }).pipe(
				Effect.annotateLogs({ module: 'ServersConnect' }),
			),
		);
		if (isSubmitting) {
			return;
		}
		void connectionForm.handleSubmit();
	};

	return (
		<ThemedScreen edges={['top', 'bottom']}>
			<ScreenHeader onBack={() => router.back()} title='New server' />
			<connectionForm.AppForm>
				{/* `padding` behavior shrinks this container by the keyboard's overlap
				    with its own frame (so the tab bar / safe-area inset is accounted for
				    — no phantom gap). The footer below the ScrollView then rises to sit
				    right on top of the keyboard, while the fields scroll. */}
				<KeyboardAvoidingView behavior='padding' style={{ flex: 1 }}>
					<ScrollView
						className='flex-1'
						keyboardShouldPersistTaps='handled'
						showsVerticalScrollIndicator={false}
						contentContainerStyle={{ padding: 18, gap: 16 }}
					>
						<View className='flex-row gap-3'>
							<connectionForm.AppField name='host'>
								{(field) => (
									<ConnectField
										label='Host'
										flex={2.4}
										mono
										placeholder='example.com'
										testID='host'
										autoCapitalize='none'
										autoCorrect={false}
										value={field.state.value}
										onChangeText={field.handleChange}
										onBlur={field.handleBlur}
										error={firstError(field.state.meta.errors)}
									/>
								)}
							</connectionForm.AppField>
							<connectionForm.AppField name='port'>
								{(field) => (
									<ConnectField
										label='Port'
										flex={1}
										mono
										placeholder='22'
										testID='port'
										keyboardType='numeric'
										value={String(field.state.value)}
										onChangeText={(t) => field.handleChange(Number(t))}
										onBlur={field.handleBlur}
										error={firstError(field.state.meta.errors)}
									/>
								)}
							</connectionForm.AppField>
						</View>

						<connectionForm.AppField name='username'>
							{(field) => (
								<ConnectField
									label='Username'
									mono
									placeholder='root'
									testID='username'
									autoCapitalize='none'
									autoCorrect={false}
									value={field.state.value}
									onChangeText={field.handleChange}
									onBlur={field.handleBlur}
									error={firstError(field.state.meta.errors)}
								/>
							)}
						</connectionForm.AppField>

						<View className='gap-2'>
							<FieldLabel>Authentication</FieldLabel>
							<connectionForm.AppField name='security.type'>
								{(field) => (
									<AuthSegment
										value={field.state.value}
										onChange={(v) => field.handleChange(v)}
									/>
								)}
							</connectionForm.AppField>
						</View>

						{securityType === 'password' ? (
							<connectionForm.AppField name='security.password'>
								{(field) => (
									<ConnectField
										label='Password'
										mono
										placeholder='••••••••'
										testID='password'
										secureTextEntry
										value={field.state.value}
										onChangeText={field.handleChange}
										onBlur={field.handleBlur}
										error={firstError(field.state.meta.errors)}
										right={
											<FontAwesome6 name='lock' size={14} color={mutedColor} />
										}
									/>
								)}
							</connectionForm.AppField>
						) : (
							<connectionForm.AppField name='security.keyId'>
								{() => <KeyIdPickerField />}
							</connectionForm.AppField>
						)}

						<SaveToggle on={saveToServers} onChange={setSaveToServers} />

						<ShellIntegrationToggle
							on={shellIntegration}
							onChange={setShellIntegration}
						/>

						{sshConnMutation.isError && sshConnMutation.error ? (
							<View className='gap-1'>
								<ThemedText className='font-semibold text-danger'>
									{sshConnMutation.error.title}
								</ThemedText>
								{sshConnMutation.error.hint ? (
									<ThemedText className='text-sm text-text-secondary'>
										{sshConnMutation.error.hint}
									</ThemedText>
								) : null}
							</View>
						) : null}
					</ScrollView>

					{/* Pinned footer — rides up with the KeyboardAvoidingView so Connect
					    sits right above the keyboard, never covered. */}
					<View
						className='bg-background px-[18px] pb-2 pt-3'
						style={{ marginBottom: footerClearance }}
					>
						<Button
							title='Connect'
							loadingTitle={buttonLabel}
							loading={isSubmitting}
							testID='connect'
							icon={<FontAwesome6 name='bolt' size={16} color={onPrimary} />}
							onPress={submit}
						/>
					</View>
				</KeyboardAvoidingView>
			</connectionForm.AppForm>

			{/* Hidden while a host-key trust prompt is up: this Modal would block the
			    in-tree prompt (iOS presents one modal at a time), leaving the user
			    stuck on "Connecting…" with the question invisible underneath. */}
			<ConnectingOverlay
				visible={sshConnMutation.isPending && !hostKeyPromptPending}
				target={`${values.username || 'user'}@${values.host || 'host'}:${values.port}`}
				progress={lastConnectionProgressEvent}
			/>
		</ThemedScreen>
	);
}

// ---------------------------------------------------------------------------
// Field primitives (themed to the active skin, matching the design)
// ---------------------------------------------------------------------------

function firstError(errors: readonly unknown[] | undefined) {
	const first = errors?.[0];
	if (
		first &&
		typeof first === 'object' &&
		'message' in first &&
		typeof (first as { message: unknown }).message === 'string'
	) {
		return (first as { message: string }).message;
	}
	if (typeof first === 'string') return first;
	if (typeof first === 'number') return String(first);
	return null;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
	return (
		<ThemedText
			className='text-[11px] font-semibold uppercase text-muted'
			style={{ letterSpacing: 0.6 }}
		>
			{children}
		</ThemedText>
	);
}

function ConnectField({
	label,
	value,
	onChangeText,
	onBlur,
	placeholder,
	flex,
	mono,
	keyboardType,
	secureTextEntry,
	autoCapitalize,
	autoCorrect,
	testID,
	right,
	error,
}: {
	label: string;
	value: string;
	onChangeText: (t: string) => void;
	onBlur?: () => void;
	placeholder?: string;
	flex?: number;
	mono?: boolean;
	keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType'];
	secureTextEntry?: boolean;
	autoCapitalize?: React.ComponentProps<typeof TextInput>['autoCapitalize'];
	autoCorrect?: boolean;
	testID?: string;
	right?: React.ReactNode;
	error?: string | null;
}) {
	const skin = useThemeSkin();
	const [focused, setFocused] = React.useState(false);
	const primary = useCSSVariable('--color-primary') as string;
	const border = useCSSVariable('--color-border') as string;
	const danger = useCSSVariable('--color-danger') as string;
	const inputRef = React.useRef<RNTextInput>(null);

	const borderColor = error ? danger : focused ? primary : border;

	return (
		<View style={flex ? { flex } : undefined}>
			<View className='mb-1.5'>
				<FieldLabel>{label}</FieldLabel>
			</View>
			<Pressable
				// Not an accessibility element: grouping the subtree here makes the
				// inner TextInput's `testID` invisible to UI automation on iOS (the
				// wrapper swallows the child identifier). Opting the wrapper out lets
				// each field's `testID` (host/port/username/password) surface so the
				// screenshot/e2e flows can use clean cross-platform `id:` selectors.
				// Touch handling is unaffected — `accessible` only changes the a11y tree.
				accessible={false}
				onPress={() => inputRef.current?.focus()}
				className='flex-row items-center gap-2 px-3.5 py-3'
				style={{
					borderWidth: 1.5,
					borderColor,
					borderRadius: skin.controlRadius,
					backgroundColor: 'rgba(0,0,0,0.25)',
					boxShadow: focused && skin.glow ? skin.glow : undefined,
				}}
			>
				<TextInput
					ref={inputRef}
					testID={testID}
					value={value}
					onChangeText={onChangeText}
					onFocus={() => setFocused(true)}
					onBlur={() => {
						setFocused(false);
						onBlur?.();
					}}
					placeholder={placeholder}
					placeholderTextColorClassName='accent-muted'
					keyboardType={keyboardType}
					secureTextEntry={secureTextEntry}
					autoCapitalize={autoCapitalize}
					autoCorrect={autoCorrect}
					className='flex-1 p-0 text-[15px] text-text-primary'
					style={mono ? { fontFamily: skin.monoFamily } : undefined}
				/>
				{right}
			</Pressable>
			{error ? (
				<ThemedText className='mt-1.5 text-xs text-danger'>{error}</ThemedText>
			) : null}
		</View>
	);
}

function AuthSegment({
	value,
	onChange,
}: {
	value: 'password' | 'key';
	onChange: (v: 'password' | 'key') => void;
}) {
	const skin = useThemeSkin();
	const primary = useCSSVariable('--color-primary') as string;
	const onPrimary = useCSSVariable('--color-button-text-on-primary') as string;
	const muted = useCSSVariable('--color-muted') as string;
	const border = useCSSVariable('--color-border') as string;
	const inner = Math.max(0, skin.controlRadius - 4);
	const opts: [string, 'password' | 'key'][] = [
		['Password', 'password'],
		['Private key', 'key'],
	];
	return (
		<View
			className='flex-row gap-1 p-1'
			style={{
				backgroundColor: 'rgba(0,0,0,0.25)',
				borderWidth: 1,
				borderColor: border,
				borderRadius: skin.controlRadius,
			}}
		>
			{opts.map(([label, val]) => {
				const on = value === val;
				return (
					<Pressable
						key={val}
						onPress={() => onChange(val)}
						className='flex-1 items-center py-2.5'
						style={{
							borderRadius: inner,
							backgroundColor: on ? primary : 'transparent',
							boxShadow: on && skin.glow ? skin.glow : undefined,
						}}
					>
						<ThemedText
							className='text-[13.5px] font-semibold'
							style={{ color: on ? onPrimary : muted }}
						>
							{label}
						</ThemedText>
					</Pressable>
				);
			})}
		</View>
	);
}

function PillToggle({ on, onPress }: { on: boolean; onPress: () => void }) {
	const skin = useThemeSkin();
	const primary = useCSSVariable('--color-primary') as string;
	const border = useCSSVariable('--color-border') as string;
	return (
		<Pressable
			accessibilityRole='switch'
			accessibilityState={{ checked: on }}
			onPress={onPress}
			style={{
				width: 44,
				height: 26,
				borderRadius: 13,
				backgroundColor: on ? primary : 'rgba(255,255,255,0.08)',
				borderWidth: 1,
				borderColor: on ? primary : border,
				justifyContent: 'center',
				boxShadow: on && skin.glow ? skin.glow : undefined,
			}}
		>
			<View
				style={{
					position: 'absolute',
					top: 3,
					left: on ? 21 : 3,
					width: 18,
					height: 18,
					borderRadius: 9,
					backgroundColor: '#fff',
				}}
			/>
		</Pressable>
	);
}

function SaveToggle({
	on,
	onChange,
}: {
	on: boolean;
	onChange: (v: boolean) => void;
}) {
	const cardStyle = useSurfaceStyle();
	return (
		<Pressable
			onPress={() => onChange(!on)}
			className='flex-row items-center gap-3 px-3.5 py-3.5'
			style={cardStyle}
		>
			<View className='flex-1'>
				<ThemedText className='text-sm font-semibold text-text-primary'>
					Save to my servers
				</ThemedText>
				<ThemedText className='mt-0.5 text-xs text-muted'>
					Quick-connect next time
				</ThemedText>
			</View>
			<PillToggle on={on} onPress={() => onChange(!on)} />
		</Pressable>
	);
}

function ShellIntegrationToggle({
	on,
	onChange,
}: {
	on: boolean;
	onChange: (v: boolean) => void;
}) {
	const cardStyle = useSurfaceStyle();
	return (
		<Pressable
			onPress={() => onChange(!on)}
			className='flex-row items-center gap-3 px-3.5 py-3.5'
			style={cardStyle}
		>
			<View className='flex-1'>
				<ThemedText className='text-sm font-semibold text-text-primary'>
					Smart terminal
				</ThemedText>
				<ThemedText className='mt-0.5 text-xs text-muted'>
					Track folder, command status & timing — nothing changed on the server
				</ThemedText>
			</View>
			<PillToggle on={on} onPress={() => onChange(!on)} />
		</Pressable>
	);
}

// ---------------------------------------------------------------------------
// Private-key picker — a card showing the selected key, "Change ›" opens the
// Keys-tab select list.
// ---------------------------------------------------------------------------

function KeyIdPickerField() {
	const field = useFieldContext<string>();
	const skin = useThemeSkin();
	const cardStyle = useSurfaceStyle();
	const primary = useCSSVariable('--color-primary') as string;
	const [open, setOpen] = React.useState(false);

	const listResult = useAtomValue(secretsManager.keys.atoms.list);
	const refreshKeys = useAtomRefresh(secretsManager.keys.atoms.list);
	const keys = AsyncResult.isSuccess(listResult) ? listResult.value : [];
	const defaultPick = React.useMemo(() => {
		const ks = AsyncResult.isSuccess(listResult) ? listResult.value : [];
		const def = ks.find((k) => k.metadata.isDefault);
		return def ?? ks[0];
	}, [listResult]);

	const fieldValue = field.state.value;
	const defaultPickId = defaultPick?.id;
	const fieldHandleChange = field.handleChange;

	React.useEffect(() => {
		if (!fieldValue && defaultPickId) {
			fieldHandleChange(defaultPickId);
		}
	}, [fieldValue, defaultPickId, fieldHandleChange]);

	const selected = keys.find((k) => k.id === field.state.value);
	const hasKeys = keys.length > 0;
	const meta = field.state.meta as { errors?: unknown[] };
	const fieldError = firstError(meta?.errors);

	return (
		<View>
			<View className='mb-1.5'>
				<FieldLabel>Private key</FieldLabel>
			</View>
			<Pressable
				onPress={() => {
					refreshKeys();
					setOpen(true);
				}}
				className='flex-row items-center gap-3 px-3.5 py-3'
				style={cardStyle}
			>
				<View
					style={{
						width: 34,
						height: 34,
						borderRadius: skin.controlRadius,
						backgroundColor: 'rgba(0,0,0,0.28)',
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					<MaterialCommunityIcons
						name='key-variant'
						size={17}
						color={primary}
					/>
				</View>
				<View className='min-w-0 flex-1'>
					{selected ? (
						<ThemedText
							numberOfLines={1}
							className='text-[14.5px] font-semibold text-text-primary'
						>
							{selected.metadata.label ?? selected.id}
							{selected.metadata.isDefault ? '  · DEFAULT' : ''}
						</ThemedText>
					) : (
						<ThemedText className='text-[14.5px] font-semibold text-muted'>
							{hasKeys ? 'Choose a key' : 'No keys yet'}
						</ThemedText>
					)}
					<ThemedText className='mt-0.5 text-xs text-muted'>
						{hasKeys ? 'Tap to change' : 'Add one in the Keys tab'}
					</ThemedText>
				</View>
				<ThemedText className='text-[13px] font-bold text-primary'>
					Change ›
				</ThemedText>
			</Pressable>
			{fieldError ? (
				<ThemedText className='mt-1.5 text-xs text-danger'>
					{fieldError}
				</ThemedText>
			) : null}

			<Modal
				visible={open}
				transparent
				animationType='slide'
				onRequestClose={() => setOpen(false)}
			>
				<View className='flex-1 justify-end bg-overlay'>
					<View className='max-h-[85%] rounded-t-2xl border border-border-strong bg-background p-4'>
						<View className='mb-2 flex-row items-center justify-between'>
							<ThemedText className='text-lg font-bold text-text-primary'>
								Select Key
							</ThemedText>
							<Pressable
								className='rounded-lg border border-border px-2 py-1.5'
								onPress={() => setOpen(false)}
							>
								<ThemedText className='font-semibold text-text-secondary'>
									Close
								</ThemedText>
							</Pressable>
						</View>
						<KeyList
							mode='select'
							onSelect={(id) => {
								field.handleChange(id);
								setOpen(false);
							}}
						/>
					</View>
				</View>
			</Modal>
		</View>
	);
}

// ---------------------------------------------------------------------------
// Connecting overlay — TCP → handshake → auth, matching the design board.
// ---------------------------------------------------------------------------

type StepState = 'done' | 'active' | 'pending';

function ConnectingOverlay({
	visible,
	target,
	progress,
}: {
	visible: boolean;
	target: string;
	progress: SshConnectionProgress | null;
}) {
	const skin = useThemeSkin();
	const surface = useCSSVariable('--color-surface') as string;
	const border = useCSSVariable('--color-border-strong') as string;
	const primary = useCSSVariable('--color-primary') as string;
	const onPrimary = useCSSVariable('--color-button-text-on-primary') as string;
	const muted = useCSSVariable('--color-muted') as string;

	// Map the single in-flight progress event onto three discrete steps.
	const tcp: StepState = progress === null ? 'active' : 'done';
	const handshake: StepState =
		progress === 'tcpConnected'
			? 'active'
			: progress === 'sshHandshake'
				? 'done'
				: 'pending';
	const auth: StepState = progress === 'sshHandshake' ? 'active' : 'pending';
	const steps: [string, StepState][] = [
		['TCP Connecting', tcp],
		['SSH Handshake', handshake],
		['Authenticating', auth],
	];

	return (
		<Modal transparent visible={visible} animationType='fade'>
			<View className='flex-1 items-center justify-center bg-overlay p-7'>
				<View
					className='w-full p-6'
					style={{
						backgroundColor: surface,
						borderColor: border,
						borderWidth: 1,
						borderRadius: skin.radius,
					}}
				>
					<ThemedText
						mono
						className='text-[13px] font-bold text-primary'
						style={{ letterSpacing: 0.4 }}
					>
						{target}
					</ThemedText>
					<ThemedText className='mb-5 mt-1 text-lg font-bold text-text-primary'>
						Connecting…
					</ThemedText>
					<View className='gap-4'>
						{steps.map(([label, st]) => (
							<View key={label} className='flex-row items-center gap-3'>
								<View
									style={{
										width: 24,
										height: 24,
										borderRadius: 12,
										alignItems: 'center',
										justifyContent: 'center',
										backgroundColor: st === 'done' ? primary : 'transparent',
										borderWidth: st === 'pending' ? 2 : st === 'active' ? 2 : 0,
										borderColor: st === 'pending' ? border : primary,
										boxShadow:
											st === 'active' && skin.glow ? skin.glow : undefined,
									}}
								>
									{st === 'done' ? (
										<FontAwesome6 name='check' size={12} color={onPrimary} />
									) : st === 'active' ? (
										<View
											style={{
												width: 8,
												height: 8,
												borderRadius: 4,
												backgroundColor: primary,
											}}
										/>
									) : null}
								</View>
								<ThemedText
									className='flex-1 text-[15px]'
									style={{
										color: st === 'pending' ? muted : undefined,
										fontWeight: st === 'active' ? '700' : '500',
									}}
								>
									{label}
									{st === 'active' ? '…' : ''}
								</ThemedText>
							</View>
						))}
					</View>
				</View>
			</View>
		</Modal>
	);
}
