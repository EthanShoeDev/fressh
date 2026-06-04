import { useAtomRefresh, useAtomValue } from '@effect/atom-react';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { useStore } from '@tanstack/react-form';
import { useRouter } from 'expo-router';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import React from 'react';
import { Modal, Pressable, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { ScreenHeader } from '@/components/themed/ScreenHeader';
import { ThemedScreen } from '@/components/themed/ThemedScreen';
import { ThemedText } from '@/components/themed/ThemedText';
import { useAppForm, useFieldContext } from '@/components/form-components';
import { KeyList } from '@/components/key-manager/KeyList';
import { rootLogger } from '@/lib/logger';
import {
	useSshConnMutation,
	type SshConnectionProgress,
} from '@/lib/query-fns';
import {
	connectionDetailsStandardSchema,
	secretsManager,
	type InputConnectionDetails,
} from '@/lib/secrets-manager';

const logger = rootLogger.extend('ServersConnect');

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
	const [lastConnectionProgressEvent, setLastConnectionProgressEvent] =
		React.useState<SshConnectionProgress | null>(null);

	const sshConnMutation = useSshConnMutation({
		onConnectionProgress: (s) => setLastConnectionProgressEvent(s),
	});

	const connectionForm = useAppForm({
		defaultValues,
		validators: {
			onChange: connectionDetailsStandardSchema,
			onSubmitAsync: ({ value }) =>
				sshConnMutation.mutateAsync(value).then((success) => {
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

	const securityType = useStore(
		connectionForm.store,
		(state) => state.values.security.type,
	);
	const isSubmitting = useStore(
		connectionForm.store,
		(state) => state.isSubmitting,
	);

	const buttonLabel = (() => {
		if (!sshConnMutation.isPending) {
			return 'Connect';
		}
		if (lastConnectionProgressEvent === null) {
			return 'TCP Connecting...';
		}
		if (lastConnectionProgressEvent === 'tcpConnected') {
			return 'SSH Handshake...';
		}
		if (lastConnectionProgressEvent === 'sshHandshake') {
			return 'Authenticating...';
		}
		return 'Connected!';
	})();

	return (
		<ThemedScreen edges={['top', 'bottom']}>
			<ScreenHeader onBack={() => router.back()} title='New Connection' />
			<KeyboardAwareScrollView
				keyboardShouldPersistTaps='handled'
				bottomOffset={24}
				contentContainerStyle={{ padding: 20 }}
			>
				<connectionForm.AppForm>
					<connectionForm.AppField name='host'>
						{(field) => (
							<field.TextField
								label='Host'
								testID='host'
								placeholder='example.com or 192.168.0.10'
								autoCapitalize='none'
								autoCorrect={false}
							/>
						)}
					</connectionForm.AppField>
					<connectionForm.AppField name='port'>
						{(field) => (
							<field.NumberField label='Port' placeholder='22' testID='port' />
						)}
					</connectionForm.AppField>
					<connectionForm.AppField name='username'>
						{(field) => (
							<field.TextField
								label='Username'
								testID='username'
								placeholder='root'
								autoCapitalize='none'
								autoCorrect={false}
							/>
						)}
					</connectionForm.AppField>
					<connectionForm.AppField name='security.type'>
						{(field) => (
							<View className='mb-3'>
								<SegmentedControl
									values={['Password', 'Private Key']}
									selectedIndex={field.state.value === 'password' ? 0 : 1}
									onChange={(event) => {
										field.handleChange(
											event.nativeEvent.selectedSegmentIndex === 0
												? 'password'
												: 'key',
										);
									}}
								/>
							</View>
						)}
					</connectionForm.AppField>
					{securityType === 'password' ? (
						<connectionForm.AppField name='security.password'>
							{(field) => (
								<field.TextField
									label='Password'
									testID='password'
									placeholder='••••••••'
									secureTextEntry
								/>
							)}
						</connectionForm.AppField>
					) : (
						<connectionForm.AppField name='security.keyId'>
							{() => <KeyIdPickerField />}
						</connectionForm.AppField>
					)}

					<View className='mt-5'>
						<connectionForm.SubmitButton
							title='Connect'
							submittingTitle={buttonLabel}
							testID='connect'
							onPress={() => {
								logger.info('Connect button pressed', { isSubmitting });
								if (isSubmitting) {
									return;
								}
								void connectionForm.handleSubmit();
							}}
						/>
					</View>
					{sshConnMutation.isError ? (
						<ThemedText className='mt-2 text-danger'>
							{sshConnMutation.error?.message ?? 'Failed to connect'}
						</ThemedText>
					) : null}
				</connectionForm.AppForm>
			</KeyboardAwareScrollView>
		</ThemedScreen>
	);
}

function KeyIdPickerField() {
	const field = useFieldContext<string>();
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

	const computedSelectedId = field.state.value;
	const selected = keys.find((k) => k.id === computedSelectedId);
	const display = selected ? (selected.metadata.label ?? selected.id) : 'None';
	const meta = field.state.meta as { errors?: unknown[] };
	const firstErr = meta?.errors?.[0] as { message: string } | undefined;
	const fieldError =
		firstErr &&
		typeof firstErr === 'object' &&
		typeof firstErr.message === 'string'
			? firstErr.message
			: null;

	return (
		<>
			<View className='mb-3'>
				<ThemedText className='mb-1.5 text-sm font-semibold text-text-secondary'>
					Private Key
				</ThemedText>
				<Pressable
					className='justify-center rounded-[10px] border border-border bg-input-background px-3 py-3'
					onPress={() => {
						refreshKeys();
						setOpen(true);
					}}
				>
					<ThemedText className='text-text-primary'>{display}</ThemedText>
				</Pressable>
				{!selected && (
					<ThemedText className='text-sm text-muted'>
						Open the Keys tab to add a key
					</ThemedText>
				)}
			</View>
			{fieldError ? (
				<ThemedText className='mt-1.5 text-xs text-danger'>{fieldError}</ThemedText>
			) : null}
			<Modal
				visible={open}
				transparent
				animationType='slide'
				onRequestClose={() => {
					setOpen(false);
				}}
			>
				<View className='flex-1 justify-end bg-overlay'>
					<View className='max-h-[85%] rounded-t-2xl border border-border-strong bg-background p-4'>
						<View className='mb-2 flex-row items-center justify-between'>
							<ThemedText className='text-lg font-bold text-text-primary'>
								Select Key
							</ThemedText>
							<Pressable
								className='rounded-lg border border-border px-2 py-1.5'
								onPress={() => {
									setOpen(false);
								}}
							>
								<ThemedText className='font-semibold text-text-secondary'>Close</ThemedText>
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
		</>
	);
}
