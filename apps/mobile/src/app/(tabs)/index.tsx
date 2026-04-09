import { type SshConnectionProgress } from '@fressh/react-native-uniffi-russh';
import { useStore } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import {
	Modal,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppForm, useFieldContext } from '@/components/form-components';
import { KeyPickerSheet } from '@/components/key-manager/KeyPickerSheet';
import { pickLatestConnection } from '@/lib/connection-utils';
import {
	getEmptyKeyPickerMessage,
	getInitialSelectedKeyId,
	getKeyPickerViewState,
} from '@/lib/key-picker-state';
import { rootLogger } from '@/lib/logger';
import { useSshConnMutation } from '@/lib/query-fns';
import {
	connectionDetailsSchema,
	secretsManager,
	type InputConnectionDetails,
	type StoredConnectionDetails,
} from '@/lib/secrets-manager';
import { useTheme } from '@/lib/theme';
import { useBottomTabSpacing } from '@/lib/useBottomTabSpacing';

const logger = rootLogger.extend('TabsIndex');

export default function TabsIndex() {
	return <Host />;
}

const defaultValues: InputConnectionDetails = {
	host: 'dev-remote-machine-1',
	port: 22,
	username: 'muly',
	security: {
		type: 'key',
		keyId: '',
	},
	useTmux: true,
	tmuxSessionName: 'main',
	autoConnect: false,
};

function Host() {
	const theme = useTheme();
	const searchParams = useLocalSearchParams<{
		editConnectionId?: string;
	}>();
	const editConnectionId = searchParams.editConnectionId;
	const [lastConnectionProgressEvent, setLastConnectionProgressEvent] =
		React.useState<SshConnectionProgress | null>(null);

	const sshConnMutation = useSshConnMutation({
		onConnectionProgress: (s) => setLastConnectionProgressEvent(s),
	});
	const listConnectionsQuery = useQuery(secretsManager.connections.query.list);
	const editConnectionQuery = useQuery({
		...(editConnectionId
			? secretsManager.connections.query.get(editConnectionId)
			: {
					queryKey: ['connections', 'edit', 'none'],
					queryFn: async () => null,
				}),
		enabled: Boolean(editConnectionId),
	});
	const marginBottom = useBottomTabSpacing();
	const connectionForm = useAppForm({
		// https://tanstack.com/form/latest/docs/framework/react/guides/async-initial-values
		defaultValues,
		validators: {
			onChange: connectionDetailsSchema,
			onSubmitAsync: async ({ value }) =>
				sshConnMutation.mutateAsync(value).then(() => {
					setLastConnectionProgressEvent(null);
				}),
		},
	});

	const isPristine = useStore(
		connectionForm.store,
		(state) => state.isPristine,
	);
	const setFieldValue = connectionForm.setFieldValue;
	const formErrors = useStore(connectionForm.store, (state) => state.errorMap);
	useEffect(() => {
		if (!formErrors || Object.keys(formErrors).length === 0) return;
		logger.info('formErrors', JSON.stringify(formErrors, null, 2));
	}, [formErrors]);

	const isSubmitting = useStore(
		connectionForm.store,
		(state) => state.isSubmitting,
	);

	const buttonLabel = (() => {
		if (!sshConnMutation.isPending) return 'Connect';
		if (lastConnectionProgressEvent === null) return 'TCP Connecting...';
		if (lastConnectionProgressEvent === 'tcpConnected')
			return 'SSH Handshake...';
		if (lastConnectionProgressEvent === 'sshHandshake')
			return 'Authenticating...';
		return 'Connected!';
	})();

	const latestSavedConnection = React.useMemo(() => {
		const latestEntry = pickLatestConnection(listConnectionsQuery.data);
		return latestEntry?.value ?? null;
	}, [listConnectionsQuery.data]);

	const applyConnectionToForm = React.useCallback(
		(connection: StoredConnectionDetails) => {
			setFieldValue('host', connection.host);
			setFieldValue('port', connection.port);
			setFieldValue('username', connection.username);
			setFieldValue('security.keyId', connection.security.keyId);

			const tmuxSessionName = connection.tmuxSessionName?.trim().length
				? connection.tmuxSessionName
				: 'main';

			setFieldValue('useTmux', connection.useTmux ?? true);
			setFieldValue('tmuxSessionName', tmuxSessionName);
			setFieldValue(
				'autoConnect',
				typeof connection.autoConnect === 'boolean'
					? connection.autoConnect
					: false,
			);
		},
		[setFieldValue],
	);

	useEffect(() => {
		// Only prefill when the user hasn't edited the form yet.
		if (!isPristine) return;
		if (editConnectionId) return;
		if (!latestSavedConnection) return;
		applyConnectionToForm(latestSavedConnection);
	}, [
		applyConnectionToForm,
		editConnectionId,
		isPristine,
		latestSavedConnection,
	]);

	useEffect(() => {
		if (!editConnectionId) return;
		const details = editConnectionQuery.data?.value ?? null;
		if (!details) return;
		applyConnectionToForm(details);
	}, [applyConnectionToForm, editConnectionId, editConnectionQuery.data]);

	return (
		<SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<ScrollView
				contentContainerStyle={[{ marginBottom }]}
				keyboardShouldPersistTaps="handled"
				style={{ backgroundColor: theme.colors.background }}
			>
				<View
					style={[
						{
							flex: 1,
							padding: 24,
							backgroundColor: theme.colors.background,
							justifyContent: 'center',
						},
						{ backgroundColor: theme.colors.background },
					]}
				>
					<View style={{ marginBottom: 16, alignItems: 'center' }}>
						<Text
							style={{
								fontSize: 28,
								fontWeight: '800',
								color: theme.colors.textPrimary,
								letterSpacing: 1,
							}}
						>
							fressh
						</Text>
						<Text
							style={{ marginTop: 4, fontSize: 13, color: theme.colors.muted }}
						>
							A fast, friendly SSH client
						</Text>
					</View>
					<View
						style={{
							backgroundColor: theme.colors.surface,
							borderRadius: 20,
							padding: 24,
							marginHorizontal: 4,
							shadowColor: theme.colors.shadow,
							shadowOpacity: 0.3,
							shadowRadius: 16,
							shadowOffset: { width: 0, height: 4 },
							elevation: 8,
							borderWidth: 1,
							borderColor: theme.colors.borderStrong,
						}}
					>
						{/* Status lives inside the Connect button via submittingTitle */}

						<connectionForm.AppForm>
							<connectionForm.AppField name="host">
								{(field) => (
									<field.TextField
										label="Host"
										testID="host"
										placeholder="example.com or 192.168.0.10"
										autoCapitalize="none"
										autoCorrect={false}
									/>
								)}
							</connectionForm.AppField>
							<connectionForm.AppField name="port">
								{(field) => (
									<field.NumberField
										label="Port"
										placeholder="22"
										testID="port"
									/>
								)}
							</connectionForm.AppField>
							<connectionForm.AppField name="username">
								{(field) => (
									<field.TextField
										label="Username"
										testID="username"
										placeholder="root"
										autoCapitalize="none"
										autoCorrect={false}
									/>
								)}
							</connectionForm.AppField>
							<connectionForm.AppField name="security.keyId">
								{() => <KeyIdPickerField />}
							</connectionForm.AppField>

							<connectionForm.AppField name="useTmux">
								{(field) => (
									<field.SwitchField label="Use tmux" testID="useTmux" />
								)}
							</connectionForm.AppField>
							<connectionForm.AppField name="tmuxSessionName">
								{(field) => (
									<field.TextField
										label="Tmux session name"
										testID="tmuxSessionName"
										placeholder="main"
										autoCapitalize="none"
										autoCorrect={false}
									/>
								)}
							</connectionForm.AppField>
							<connectionForm.AppField name="autoConnect">
								{(field) => (
									<field.SwitchField
										label="Auto-connect on resume"
										testID="autoConnect"
									/>
								)}
							</connectionForm.AppField>

							<View style={{ marginTop: 20 }}>
								<connectionForm.SubmitButton
									title="Connect"
									submittingTitle={buttonLabel}
									testID="connect"
									onPress={() => {
										logger.info('Connect button pressed', { isSubmitting });
										if (isSubmitting) return;
										void connectionForm.handleSubmit();
									}}
								/>
							</View>
							{sshConnMutation.isError ? (
								<Text style={{ color: theme.colors.danger, marginTop: 8 }}>
									{String(
										(sshConnMutation.error as Error)?.message ??
											'Failed to connect',
									)}
								</Text>
							) : null}
						</connectionForm.AppForm>
					</View>
					<PreviousConnectionsSection onFillForm={applyConnectionToForm} />
				</View>
			</ScrollView>
		</SafeAreaView>
	);
}

function KeyIdPickerField() {
	const router = useRouter();
	const theme = useTheme();
	const field = useFieldContext<string>();
	const [open, setOpen] = React.useState(false);

	const listPrivateKeysQuery = useQuery(secretsManager.keys.query.list);
	const keys = listPrivateKeysQuery.data;
	const fieldValue = field.state.value;
	const fieldHandleChange = field.handleChange;
	const computedSelectedId = getInitialSelectedKeyId({
		keys,
		currentValue: fieldValue,
		hasLoadedKeys: listPrivateKeysQuery.status === 'success',
	});
	const viewState = getKeyPickerViewState({
		keys,
		currentValue: fieldValue,
		hasLoadedKeys: listPrivateKeysQuery.status === 'success',
	});

	React.useEffect(() => {
		if (listPrivateKeysQuery.status !== 'success') return;
		if (fieldValue === computedSelectedId) return;
		fieldHandleChange(computedSelectedId);
	}, [
		computedSelectedId,
		fieldHandleChange,
		fieldValue,
		listPrivateKeysQuery.status,
	]);

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
			<View style={{ marginBottom: 12 }}>
				<Text
					style={{
						marginBottom: 6,
						fontSize: 14,
						color: theme.colors.textSecondary,
						fontWeight: '600',
					}}
				>
					Private Key
				</Text>
				<Pressable
					style={[
						{
							borderWidth: 1,
							borderColor: theme.colors.border,
							backgroundColor: theme.colors.inputBackground,
							borderRadius: 10,
							paddingHorizontal: 12,
							paddingVertical: 12,
							justifyContent: 'center',
						},
					]}
					onPress={() => {
						void listPrivateKeysQuery.refetch();
						setOpen(true);
					}}
				>
					<Text style={{ color: theme.colors.textPrimary }}>
						{viewState.display}
					</Text>
				</Pressable>
				{listPrivateKeysQuery.status === 'success' &&
				viewState.showEmptyState ? (
					<Text style={{ color: theme.colors.muted, fontSize: 14 }}>
						{getEmptyKeyPickerMessage()}
					</Text>
				) : null}
			</View>
			{fieldError ? (
				<Text
					style={{ color: theme.colors.danger, fontSize: 12, marginTop: 6 }}
				>
					{fieldError}
				</Text>
			) : null}
			<KeyPickerSheet
				open={open}
				keys={keys ?? []}
				selectedId={viewState.selectedId}
				onClose={() => {
					setOpen(false);
				}}
				onSelect={(id) => {
					fieldHandleChange(id);
					setOpen(false);
				}}
				onManagePress={() => {
					setOpen(false);
					router.push('/(tabs)/settings/security-center');
				}}
			/>
		</>
	);
}

function PreviousConnectionsSection(props: {
	onFillForm: (connection: StoredConnectionDetails) => void;
}) {
	const theme = useTheme();
	const listConnectionsQuery = useQuery(secretsManager.connections.query.list);

	return (
		<View style={{ marginTop: 20 }}>
			<Text
				style={{
					fontSize: 16,
					fontWeight: '700',
					color: theme.colors.textPrimary,
					marginBottom: 8,
				}}
			>
				Previous Connections
			</Text>
			{listConnectionsQuery.isLoading ? (
				<Text style={{ color: theme.colors.muted, fontSize: 14 }}>
					Loading connections...
				</Text>
			) : listConnectionsQuery.isError ? (
				<Text
					style={{ marginTop: 6, color: theme.colors.danger, fontSize: 12 }}
				>
					Error loading connections
				</Text>
			) : listConnectionsQuery.data?.length ? (
				<View>
					{listConnectionsQuery.data.map((conn) => (
						<ConnectionRow
							key={conn.id}
							id={conn.id}
							onFillForm={props.onFillForm}
						/>
					))}
				</View>
			) : (
				<Text style={{ color: theme.colors.muted, fontSize: 14 }}>
					No saved connections yet
				</Text>
			)}
		</View>
	);
}

function ConnectionRow(props: {
	id: string;
	onFillForm: (connection: StoredConnectionDetails) => void;
}) {
	const theme = useTheme();
	const detailsQuery = useQuery(secretsManager.connections.query.get(props.id));
	const details = detailsQuery.data?.value ?? null;
	const [open, setOpen] = React.useState(false);
	const [renameOpen, setRenameOpen] = React.useState(false);
	const [newId, setNewId] = React.useState(props.id);
	const listQuery = useQuery(secretsManager.connections.query.list);

	return (
		<Pressable
			style={{
				flexDirection: 'row',
				alignItems: 'center',
				justifyContent: 'space-between',
				backgroundColor: theme.colors.inputBackground,
				borderWidth: 1,
				borderColor: theme.colors.border,
				borderRadius: 12,
				paddingHorizontal: 12,
				paddingVertical: 12,
				marginBottom: 8,
			}}
			onPress={() => {
				if (details) props.onFillForm(details);
			}}
			disabled={!details}
		>
			<View style={{ flex: 1, marginRight: 12 }}>
				<Text
					style={{
						color: theme.colors.textPrimary,
						fontSize: 15,
						fontWeight: '600',
					}}
				>
					{details ? `${details.username}@${details.host}` : 'Loading...'}
				</Text>
				<Text style={{ color: theme.colors.muted, marginTop: 2, fontSize: 12 }}>
					{details ? `Port ${details.port} • key` : ''}
				</Text>
			</View>
			<Pressable onPress={() => setOpen(true)} hitSlop={8}>
				<Text
					style={{
						color: theme.colors.muted,
						fontSize: 22,
						paddingHorizontal: 4,
					}}
				>
					⋯
				</Text>
			</Pressable>

			{/* Actions Modal */}
			<Modal
				transparent
				visible={open}
				animationType="fade"
				onRequestClose={() => setOpen(false)}
			>
				<Pressable
					style={{ flex: 1, backgroundColor: theme.colors.overlay }}
					onPress={() => setOpen(false)}
				>
					<View
						style={{
							marginTop: 'auto',
							backgroundColor: theme.colors.background,
							padding: 16,
							borderTopLeftRadius: 16,
							borderTopRightRadius: 16,
							borderWidth: 1,
							borderColor: theme.colors.borderStrong,
						}}
					>
						<Text
							style={{
								color: theme.colors.textPrimary,
								fontWeight: '700',
								fontSize: 16,
								marginBottom: 12,
							}}
						>
							Connection Actions
						</Text>
						<View style={{ gap: 8 }}>
							{/* Keep only rename/delete/cancel. Tap row fills the form */}
							<Pressable
								onPress={() => {
									setOpen(false);
									setRenameOpen(true);
									setNewId(props.id);
								}}
								style={{
									backgroundColor: theme.colors.transparent,
									borderWidth: 1,
									borderColor: theme.colors.border,
									borderRadius: 10,
									paddingVertical: 12,
									alignItems: 'center',
								}}
							>
								<Text
									style={{
										color: theme.colors.textSecondary,
										fontWeight: '600',
									}}
								>
									Rename
								</Text>
							</Pressable>
							<Pressable
								onPress={async () => {
									setOpen(false);
									await secretsManager.connections.utils.deleteConnection(
										props.id,
									);
									await listQuery.refetch();
								}}
								style={{
									backgroundColor: theme.colors.transparent,
									borderWidth: 1,
									borderColor: theme.colors.danger,
									borderRadius: 10,
									paddingVertical: 12,
									alignItems: 'center',
								}}
							>
								<Text style={{ color: theme.colors.danger, fontWeight: '700' }}>
									Delete
								</Text>
							</Pressable>
							<Pressable
								onPress={() => setOpen(false)}
								style={{
									backgroundColor: theme.colors.transparent,
									borderWidth: 1,
									borderColor: theme.colors.border,
									borderRadius: 10,
									paddingVertical: 12,
									alignItems: 'center',
								}}
							>
								<Text
									style={{
										color: theme.colors.textSecondary,
										fontWeight: '600',
									}}
								>
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
				animationType="fade"
				onRequestClose={() => setRenameOpen(false)}
			>
				<Pressable
					style={{ flex: 1, backgroundColor: theme.colors.overlay }}
					onPress={() => setRenameOpen(false)}
				>
					<View
						style={{
							marginTop: 'auto',
							backgroundColor: theme.colors.background,
							padding: 16,
							borderTopLeftRadius: 16,
							borderTopRightRadius: 16,
							borderWidth: 1,
							borderColor: theme.colors.borderStrong,
						}}
					>
						<Text
							style={{
								color: theme.colors.textPrimary,
								fontWeight: '700',
								fontSize: 16,
								marginBottom: 8,
							}}
						>
							Rename Connection
						</Text>
						<Text
							style={{
								color: theme.colors.muted,
								fontSize: 12,
								marginBottom: 8,
							}}
						>
							Enter a new identifier for this saved connection
						</Text>
						<TextInput
							value={newId}
							onChangeText={setNewId}
							autoCapitalize="none"
							style={{
								backgroundColor: theme.colors.inputBackground,
								color: theme.colors.textPrimary,
								borderWidth: 1,
								borderColor: theme.colors.border,
								borderRadius: 10,
								paddingHorizontal: 12,
								paddingVertical: 10,
								marginBottom: 12,
							}}
						/>
						<View style={{ flexDirection: 'row', gap: 8 }}>
							<Pressable
								onPress={async () => {
									if (!details) return;
									if (!newId || newId === props.id) {
										setRenameOpen(false);
										return;
									}
									// Recreate under new id then delete old
									await secretsManager.connections.utils.upsertConnection({
										details,
										priority: 0,
										label: newId,
									});
									await listQuery.refetch();
									setRenameOpen(false);
								}}
								style={{
									backgroundColor: theme.colors.primary,
									borderRadius: 10,
									paddingVertical: 12,
									paddingHorizontal: 16,
									alignItems: 'center',
									flex: 1,
								}}
							>
								<Text
									style={{
										color: theme.colors.buttonTextOnPrimary,
										fontWeight: '700',
										textAlign: 'center',
									}}
								>
									Save
								</Text>
							</Pressable>
							<Pressable
								onPress={() => setRenameOpen(false)}
								style={{
									backgroundColor: theme.colors.transparent,
									borderWidth: 1,
									borderColor: theme.colors.border,
									borderRadius: 10,
									paddingVertical: 12,
									paddingHorizontal: 16,
									alignItems: 'center',
									flex: 1,
								}}
							>
								<Text
									style={{
										color: theme.colors.textSecondary,
										fontWeight: '600',
										textAlign: 'center',
									}}
								>
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
