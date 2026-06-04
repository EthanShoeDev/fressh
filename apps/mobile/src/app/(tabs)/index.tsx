import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { useStore } from '@tanstack/react-form';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import React, { useEffect } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
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
import { useBottomTabSpacing } from '@/lib/useBottomTabSpacing';

const logger = rootLogger.extend('TabsIndex');

export default function TabsIndex() {
	return <Host />;
}

const defaultValues: InputConnectionDetails = {
	host: '',
	port: 22,
	username: '',
	security: {
		type: 'password',
		password: '',
	},
};

function Host() {
	const backgroundColor = useCSSVariable('--color-background') as string;
	const shadowColor = useCSSVariable('--color-shadow') as string;
	const [lastConnectionProgressEvent, setLastConnectionProgressEvent] =
		React.useState<SshConnectionProgress | null>(null);

	const sshConnMutation = useSshConnMutation({
		onConnectionProgress: (s) => setLastConnectionProgressEvent(s),
	});
	const marginBottom = useBottomTabSpacing();
	const connectionForm = useAppForm({
		// https://tanstack.com/form/latest/docs/framework/react/guides/async-initial-values
		defaultValues,
		validators: {
			onChange: connectionDetailsStandardSchema,
			onSubmitAsync: ({ value }) =>
				sshConnMutation.mutateAsync(value).then(() => {
					setLastConnectionProgressEvent(null);
				}),
		},
	});

	const securityType = useStore(
		connectionForm.store,
		(state) => state.values.security.type,
	);
	const formErrors = useStore(connectionForm.store, (state) => state.errorMap);
	useEffect(() => {
		if (!formErrors || Object.keys(formErrors).length === 0) {
			return;
		}
		logger.info('formErrors', JSON.stringify(formErrors, null, 2));
	}, [formErrors]);

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
		<SafeAreaView style={{ flex: 1, backgroundColor }}>
			<KeyboardAwareScrollView
				contentContainerStyle={[{ marginBottom }]}
				keyboardShouldPersistTaps='handled'
				bottomOffset={24}
				className='bg-background'
			>
				<View className='flex-1 justify-center bg-background p-6'>
					<View className='mb-4 items-center'>
						<Text className='text-[28px] font-extrabold tracking-[1px] text-text-primary'>
							fressh
						</Text>
						<Text className='mt-1 text-[13px] text-muted'>
							A fast, friendly SSH client
						</Text>
					</View>
					<View
						className='mx-1 rounded-[20px] border border-border-strong bg-surface p-6'
						style={{
							shadowColor,
							shadowOpacity: 0.3,
							shadowRadius: 16,
							shadowOffset: { width: 0, height: 4 },
							elevation: 8,
						}}
					>
						{/* Status lives inside the Connect button via submittingTitle */}

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
									<field.NumberField
										label='Port'
										placeholder='22'
										testID='port'
									/>
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
								<Text className='mt-2 text-danger'>
									{sshConnMutation.error?.message ?? 'Failed to connect'}
								</Text>
							) : null}
						</connectionForm.AppForm>
					</View>
					<PreviousConnectionsSection
						onFillForm={(connection) => {
							connectionForm.setFieldValue('host', connection.host);
							connectionForm.setFieldValue('port', connection.port);
							connectionForm.setFieldValue('username', connection.username);
							if (connection.security.type === 'password') {
								connectionForm.setFieldValue(
									'security.password',
									connection.security.password,
								);
								connectionForm.setFieldValue('security.type', 'password');
							} else {
								connectionForm.setFieldValue(
									'security.keyId',
									connection.security.keyId,
								);
								connectionForm.setFieldValue('security.type', 'key');
							}
						}}
					/>
				</View>
			</KeyboardAwareScrollView>
		</SafeAreaView>
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
				<Text className='mb-1.5 text-sm font-semibold text-text-secondary'>
					Private Key
				</Text>
				<Pressable
					className='justify-center rounded-[10px] border border-border bg-input-background px-3 py-3'
					onPress={() => {
						refreshKeys();
						setOpen(true);
					}}
				>
					<Text className='text-text-primary'>{display}</Text>
				</Pressable>
				{!selected && (
					<Text className='text-sm text-muted'>
						Open Key Manager to add/select a key
					</Text>
				)}
			</View>
			{fieldError ? (
				<Text className='mt-1.5 text-xs text-danger'>{fieldError}</Text>
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
							<Text className='text-lg font-bold text-text-primary'>
								Select Key
							</Text>
							<Pressable
								className='rounded-lg border border-border px-2 py-1.5'
								onPress={() => {
									setOpen(false);
								}}
							>
								<Text className='font-semibold text-text-secondary'>Close</Text>
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

function PreviousConnectionsSection(props: {
	onFillForm: (connection: InputConnectionDetails) => void;
}) {
	const listResult = useAtomValue(secretsManager.connections.atoms.list);
	const connections = AsyncResult.isSuccess(listResult) ? listResult.value : [];

	return (
		<View className='mt-5'>
			<Text className='mb-2 text-base font-bold text-text-primary'>
				Previous Connections
			</Text>
			{AsyncResult.isInitial(listResult) ? (
				<Text className='text-sm text-muted'>Loading connections...</Text>
			) : AsyncResult.isFailure(listResult) ? (
				<Text className='mt-1.5 text-xs text-danger'>
					Error loading connections
				</Text>
			) : connections.length ? (
				<View>
					{connections.map((conn) => (
						<ConnectionRow
							key={conn.id}
							id={conn.id}
							onFillForm={props.onFillForm}
						/>
					))}
				</View>
			) : (
				<Text className='text-sm text-muted'>No saved connections yet</Text>
			)}
		</View>
	);
}

function ConnectionRow(props: {
	id: string;
	onFillForm: (connection: InputConnectionDetails) => void;
}) {
	const detailsResult = useAtomValue(
		secretsManager.connections.atoms.get(props.id),
	);
	const details = AsyncResult.isSuccess(detailsResult)
		? detailsResult.value.value
		: undefined;
	const deleteConnection = useAtomSet(
		secretsManager.connections.atoms.delete(props.id),
	);
	const upsertConnection = useAtomSet(secretsManager.connections.atoms.upsert);
	const [open, setOpen] = React.useState(false);
	const [renameOpen, setRenameOpen] = React.useState(false);
	const [newId, setNewId] = React.useState(props.id);

	return (
		<Pressable
			className='mb-2 flex-row items-center justify-between rounded-xl border border-border bg-input-background px-3 py-3'
			onPress={() => {
				if (details) {
					props.onFillForm(details);
				}
			}}
			disabled={!details}
		>
			<View className='mr-3 flex-1'>
				<Text className='text-[15px] font-semibold text-text-primary'>
					{details ? `${details.username}@${details.host}` : 'Loading...'}
				</Text>
				<Text className='mt-0.5 text-xs text-muted'>
					{details ? `Port ${details.port} • ${details.security.type}` : ''}
				</Text>
			</View>
			<Pressable onPress={() => setOpen(true)} hitSlop={8}>
				<Text className='px-1 text-[22px] text-muted'>⋯</Text>
			</Pressable>

			{/* Actions Modal */}
			<Modal
				transparent
				visible={open}
				animationType='fade'
				onRequestClose={() => setOpen(false)}
			>
				<Pressable className='flex-1 bg-overlay' onPress={() => setOpen(false)}>
					<View className='mt-auto rounded-t-2xl border border-border-strong bg-background p-4'>
						<Text className='mb-3 text-base font-bold text-text-primary'>
							Connection Actions
						</Text>
						<View className='gap-2'>
							{/* Keep only rename/delete/cancel. Tap row fills the form */}
							<Pressable
								onPress={() => {
									setOpen(false);
									setRenameOpen(true);
									setNewId(props.id);
								}}
								className='items-center rounded-[10px] border border-border bg-transparent py-3'
							>
								<Text className='font-semibold text-text-secondary'>
									Rename
								</Text>
							</Pressable>
							<Pressable
								onPress={() => {
									setOpen(false);
									deleteConnection();
								}}
								className='items-center rounded-[10px] border border-danger bg-transparent py-3'
							>
								<Text className='font-bold text-danger'>Delete</Text>
							</Pressable>
							<Pressable
								onPress={() => setOpen(false)}
								className='items-center rounded-[10px] border border-border bg-transparent py-3'
							>
								<Text className='font-semibold text-text-secondary'>
									Cancel
								</Text>
							</Pressable>
						</View>
					</View>
				</Pressable>
			</Modal>

			{/* Rename Modal */}
			<Modal
				transparent
				visible={renameOpen}
				animationType='fade'
				onRequestClose={() => setRenameOpen(false)}
			>
				<Pressable
					className='flex-1 bg-overlay'
					onPress={() => setRenameOpen(false)}
				>
					<View className='mt-auto rounded-t-2xl border border-border-strong bg-background p-4'>
						<Text className='mb-2 text-base font-bold text-text-primary'>
							Rename Connection
						</Text>
						<Text className='mb-2 text-xs text-muted'>
							Enter a new identifier for this saved connection
						</Text>
						<TextInput
							value={newId}
							onChangeText={setNewId}
							autoCapitalize='none'
							className='mb-3 rounded-[10px] border border-border bg-input-background px-3 py-2.5 text-text-primary'
						/>
						<View className='flex-row gap-2'>
							<Pressable
								onPress={() => {
									if (!details) {
										return;
									}
									if (!newId || newId === props.id) {
										setRenameOpen(false);
										return;
									}
									// Recreate under new id then delete old
									upsertConnection({
										details,
										priority: 0,
										label: newId,
									});
									setRenameOpen(false);
								}}
								className='flex-1 items-center rounded-[10px] bg-primary px-4 py-3'
							>
								<Text className='text-center font-bold text-button-text-on-primary'>
									Save
								</Text>
							</Pressable>
							<Pressable
								onPress={() => setRenameOpen(false)}
								className='flex-1 items-center rounded-[10px] border border-border bg-transparent px-4 py-3'
							>
								<Text className='text-center font-semibold text-text-secondary'>
									Cancel
								</Text>
							</Pressable>
						</View>
					</View>
				</Pressable>
			</Modal>
		</Pressable>
	);
}
