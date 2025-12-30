import { type SshConnectionProgress } from '@fressh/react-native-uniffi-russh';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { useStore } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
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
import { KeyList } from '@/components/key-manager/KeyList';
import { rootLogger } from '@/lib/logger';
import { useSshConnMutation } from '@/lib/query-fns';
import {
	connectionDetailsSchema,
	secretsManager,
	type InputConnectionDetails,
} from '@/lib/secrets-manager';
import { useTheme } from '@/lib/theme';
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
	const theme = useTheme();
	const [lastConnectionProgressEvent, setLastConnectionProgressEvent] =
		React.useState<SshConnectionProgress | null>(null);

	// Preload keys so they're ready when switching to key mode
	const listPrivateKeysQuery = useQuery(secretsManager.keys.query.list);
	const getDefaultKeyId = React.useCallback(() => {
		const keys = listPrivateKeysQuery.data ?? [];
		const def = keys.find((k) => k.metadata.isDefault);
		return def?.id ?? keys[0]?.id;
	}, [listPrivateKeysQuery.data]);

	const sshConnMutation = useSshConnMutation({
		onConnectionProgress: (s) => setLastConnectionProgressEvent(s),
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

	const securityType = useStore(
		connectionForm.store,
		(state) => state.values.security.type,
	);
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
							<connectionForm.AppField name="security.type">
								{(field) => (
									<View style={{ marginBottom: 12 }}>
										<SegmentedControl
											values={['Password', 'Private Key']}
											selectedIndex={field.state.value === 'password' ? 0 : 1}
											onChange={(event) => {
												const isKey =
													event.nativeEvent.selectedSegmentIndex === 1;
												field.handleChange(isKey ? 'key' : 'password');
												// Set the default keyId when switching to key mode
												if (isKey) {
													const defaultKeyId = getDefaultKeyId();
													if (defaultKeyId) {
														connectionForm.setFieldValue(
															'security.keyId',
															defaultKeyId,
														);
													}
												}
											}}
										/>
									</View>
								)}
							</connectionForm.AppField>
							{securityType === 'password' ? (
								<connectionForm.AppField name="security.password">
									{(field) => (
										<field.TextField
											label="Password"
											testID="password"
											placeholder="••••••••"
											secureTextEntry
										/>
									)}
								</connectionForm.AppField>
							) : (
								<connectionForm.AppField name="security.keyId">
									{() => <KeyIdPickerField />}
								</connectionForm.AppField>
							)}

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
			</ScrollView>
		</SafeAreaView>
	);
}

function KeyIdPickerField() {
	const theme = useTheme();
	const field = useFieldContext<string>();
	const [open, setOpen] = React.useState(false);

	const listPrivateKeysQuery = useQuery(secretsManager.keys.query.list);
	const defaultPick = React.useMemo(() => {
		const keys = listPrivateKeysQuery.data ?? [];
		const def = keys.find((k) => k.metadata.isDefault);
		return def ?? keys[0];
	}, [listPrivateKeysQuery.data]);
	const keys = listPrivateKeysQuery.data ?? [];

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
					<Text style={{ color: theme.colors.textPrimary }}>{display}</Text>
				</Pressable>
				{!selected && (
					<Text style={{ color: theme.colors.muted, fontSize: 14 }}>
						Open Key Manager to add/select a key
					</Text>
				)}
			</View>
			{fieldError ? (
				<Text
					style={{ color: theme.colors.danger, fontSize: 12, marginTop: 6 }}
				>
					{fieldError}
				</Text>
			) : null}
			<Modal
				visible={open}
				transparent
				animationType="slide"
				onRequestClose={() => {
					setOpen(false);
				}}
			>
				<View
					style={{
						flex: 1,
						backgroundColor: theme.colors.overlay,
						justifyContent: 'flex-end',
					}}
				>
					<View
						style={{
							backgroundColor: theme.colors.background,
							borderTopLeftRadius: 16,
							borderTopRightRadius: 16,
							padding: 16,
							borderColor: theme.colors.borderStrong,
							borderWidth: 1,
							maxHeight: '85%',
						}}
					>
						<View
							style={{
								flexDirection: 'row',
								justifyContent: 'space-between',
								alignItems: 'center',
								marginBottom: 8,
							}}
						>
							<Text
								style={{
									color: theme.colors.textPrimary,
									fontSize: 18,
									fontWeight: '700',
								}}
							>
								Select Key
							</Text>
							<Pressable
								style={{
									paddingHorizontal: 8,
									paddingVertical: 6,
									borderRadius: 8,
									borderWidth: 1,
									borderColor: theme.colors.border,
								}}
								onPress={() => {
									setOpen(false);
								}}
							>
								<Text
									style={{
										color: theme.colors.textSecondary,
										fontWeight: '600',
									}}
								>
									Close
								</Text>
							</Pressable>
						</View>
						<KeyList
							mode="select"
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
	onFillForm: (connection: InputConnectionDetails) => void;
}) {
	const theme = useTheme();
	const detailsQuery = useQuery(secretsManager.connections.query.get(props.id));
	const details = detailsQuery.data?.value;
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
					{details ? `Port ${details.port} • ${details.security.type}` : ''}
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
