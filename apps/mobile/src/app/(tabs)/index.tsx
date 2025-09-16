import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { useStore } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppForm, useFieldContext } from '@/components/form-components';
import { KeyList } from '@/components/key-manager/KeyList';
import { useSshConnMutation } from '@/lib/query-fns';
import {
	connectionDetailsSchema,
	secretsManager,
	type InputConnectionDetails,
} from '@/lib/secrets-manager';
import { useTheme } from '@/lib/theme';

export default function TabsIndex() {
	return <Host />;
}

const defaultValues: InputConnectionDetails = {
	host: 'test.rebex.net',
	port: 22,
	username: 'demo',
	security: {
		type: 'password',
		password: 'password',
	},
};

function Host() {
	const theme = useTheme();
	// const insets = useSafeAreaInsets();
	const sshConnMutation = useSshConnMutation();
	const connectionForm = useAppForm({
		// https://tanstack.com/form/latest/docs/framework/react/guides/async-initial-values
		defaultValues,
		validators: {
			onChange: connectionDetailsSchema,
			onSubmitAsync: async ({ value }) => sshConnMutation.mutateAsync(value),
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

	return (
		<SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<ScrollView
				contentContainerStyle={[{ paddingBottom: 32 }]}
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
						<Text
							style={{
								fontSize: 24,
								fontWeight: '700',
								color: theme.colors.textPrimary,
								marginBottom: 6,
								letterSpacing: 0.5,
							}}
						>
							Connect to SSH Server
						</Text>
						<Text
							style={{
								fontSize: 15,
								color: theme.colors.muted,
								marginBottom: 24,
								lineHeight: 20,
							}}
						>
							Enter your server credentials
						</Text>

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
									testID="connect"
									onPress={() => {
										if (isSubmitting) return;
										void connectionForm.handleSubmit();
									}}
								/>
							</View>
						</connectionForm.AppForm>
					</View>
					<PreviousConnectionsSection
						onSelect={(connection) => {
							connectionForm.setFieldValue('host', connection.host);
							connectionForm.setFieldValue('port', connection.port);
							connectionForm.setFieldValue('username', connection.username);
							connectionForm.setFieldValue(
								'security.type',
								connection.security.type,
							);
							if (connection.security.type === 'password') {
								connectionForm.setFieldValue(
									'security.password',
									connection.security.password,
								);
							} else {
								connectionForm.setFieldValue(
									'security.keyId',
									connection.security.keyId,
								);
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
		const def = keys.find((k) => k.metadata?.isDefault);
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

	const computedSelectedId = field.state.value ?? defaultPick?.id;
	const selected = keys.find((k) => k.id === computedSelectedId);
	const display = selected ? (selected.metadata?.label ?? selected.id) : 'None';

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
			<Modal
				visible={open}
				transparent
				animationType="slide"
				onRequestClose={() => setOpen(false)}
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
								onPress={() => setOpen(false)}
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
							onSelect={async (id) => {
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
	onSelect: (connection: InputConnectionDetails) => void;
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
					{listConnectionsQuery.data?.map((conn) => (
						<ConnectionRow
							key={conn.id}
							id={conn.id}
							onSelect={props.onSelect}
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
	onSelect: (connection: InputConnectionDetails) => void;
}) {
	const theme = useTheme();
	const detailsQuery = useQuery(secretsManager.connections.query.get(props.id));
	const details = detailsQuery.data?.value;

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
				if (details) props.onSelect(details);
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
			<Text
				style={{
					color: theme.colors.muted,
					fontSize: 22,
					paddingHorizontal: 4,
				}}
			>
				›
			</Text>
		</Pressable>
	);
}
