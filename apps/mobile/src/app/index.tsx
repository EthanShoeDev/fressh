import SSHClient, { PtyType } from '@dylankenneally/react-native-ssh-sftp';
import { Picker } from '@react-native-picker/picker';
import { useStore } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAppForm, withFieldGroup } from '../components/form-components';
import { KeyManagerModal } from '../components/key-manager-modal';
import {
	type ConnectionDetails,
	connectionDetailsSchema,
	secretsManager,
} from '../lib/secrets-manager';
import { sshConnectionManager } from '../lib/ssh-connection-manager';

const defaultValues: ConnectionDetails = {
	host: 'test.rebex.net',
	port: 22,
	username: 'demo',
	security: {
		type: 'password',
		password: 'password',
	},
};

export default function Index() {
	const router = useRouter();
	const storedConnectionsQuery = useQuery(
		secretsManager.connections.query.list,
	);

	const preferredStoredConnection = storedConnectionsQuery.data?.[0];
	const connectionForm = useAppForm({
		// https://tanstack.com/form/latest/docs/framework/react/guides/async-initial-values
		defaultValues: preferredStoredConnection
			? preferredStoredConnection.value
			: defaultValues,
		validators: {
			onChange: connectionDetailsSchema,
			onSubmitAsync: async ({ value }) => {
				try {
					console.log('Connecting to SSH server...');
					const sshClientConnection = await (async () => {
						if (value.security.type === 'password') {
							return await SSHClient.connectWithPassword(
								value.host,
								value.port,
								value.username,
								value.security.password,
							);
						}
						const privateKey = await secretsManager.keys.utils.getPrivateKey(
							value.security.keyId,
						);
						return await SSHClient.connectWithKey(
							value.host,
							value.port,
							value.username,
							privateKey.value,
						);
					})();

					await secretsManager.connections.utils.upsertConnection({
						id: 'default',
						details: value,
						priority: 0,
					});
					await sshClientConnection.startShell(PtyType.XTERM);
					const sshConn = sshConnectionManager.addSession({
						client: sshClientConnection,
					});
					console.log('Connected to SSH server', sshConn.sessionId);
					router.push({
						pathname: '/shell',
						params: {
							sessionId: sshConn.sessionId,
						},
					});
				} catch (error) {
					console.error('Error connecting to SSH server', error);
					throw error;
				}
			},
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
		<View style={styles.container}>
			<ScrollView
				contentContainerStyle={styles.scrollContent}
				keyboardShouldPersistTaps="handled"
			>
				<View style={styles.header}>
					<Text style={styles.appName}>fressh</Text>
					<Text style={styles.appTagline}>A fast, friendly SSH client</Text>
				</View>
				<View style={styles.card}>
					<Text style={styles.title}>Connect to SSH Server</Text>
					<Text style={styles.subtitle}>Enter your server credentials</Text>

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
								<field.PickerField label="Security Type">
									<Picker.Item label="Password" value="password" />
									<Picker.Item label="Key" value="key" />
								</field.PickerField>
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
							<KeyPairSection
								form={connectionForm}
								fields={{
									keyId: 'security.keyId',
									type: 'security.type',
								}}
							/>
						)}

						<View style={styles.actions}>
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
			</ScrollView>
		</View>
	);
}

// Yes, HOCs are weird. Its what the docs recommend.
// https://tanstack.com/form/v1/docs/framework/react/guides/form-composition#withform-faq
const KeyPairSection = withFieldGroup({
	defaultValues: {
		type: 'key',
		keyId: '',
	},
	props: {},
	render: function Render({ group }) {
		const listPrivateKeysQuery = useQuery(secretsManager.keys.query.list);
		const [showManager, setShowManager] = React.useState(false);

		return (
			<group.AppField name="keyId">
				{(field) => {
					if (listPrivateKeysQuery.isLoading) {
						return <Text style={styles.mutedText}>Loading keys...</Text>;
					}
					if (listPrivateKeysQuery.isError) {
						return (
							<Text style={styles.errorText}>
								Error: {listPrivateKeysQuery.error.message}
							</Text>
						);
					}
					return (
						<>
							<field.PickerField label="Key">
								{listPrivateKeysQuery.data?.map((key) => {
									const label = `${key.metadata?.label ?? key.id}${
										key.metadata?.isDefault ? ' • Default' : ''
									}`;
									return (
										<Picker.Item key={key.id} label={label} value={key.id} />
									);
								})}
							</field.PickerField>
							<Pressable
								style={styles.secondaryButton}
								onPress={() => setShowManager(true)}
							>
								<Text style={styles.secondaryButtonText}>Manage Keys</Text>
							</Pressable>
							<KeyManagerModal
								visible={showManager}
								onClose={() => {
									setShowManager(false);
									if (!field.state.value && listPrivateKeysQuery.data) {
										const def = listPrivateKeysQuery.data.find(
											(k) => k.metadata?.isDefault,
										);
										if (def) field.handleChange(def.id);
									}
								}}
							/>
						</>
					);
				}}
			</group.AppField>
		);
	},
});

function PreviousConnectionsSection(props: {
	onSelect: (connection: ConnectionDetails) => void;
}) {
	const listConnectionsQuery = useQuery(secretsManager.connections.query.list);

	return (
		<View style={styles.listSection}>
			<Text style={styles.listTitle}>Previous Connections</Text>
			{listConnectionsQuery.isLoading ? (
				<Text style={styles.mutedText}>Loading connections...</Text>
			) : listConnectionsQuery.isError ? (
				<Text style={styles.errorText}>Error loading connections</Text>
			) : listConnectionsQuery.data?.length ? (
				<View style={styles.listContainer}>
					{listConnectionsQuery.data?.map((conn) => (
						<ConnectionRow
							key={conn.id}
							id={conn.id}
							onSelect={props.onSelect}
						/>
					))}
				</View>
			) : (
				<Text style={styles.mutedText}>No saved connections yet</Text>
			)}
		</View>
	);
}

function ConnectionRow(props: {
	id: string;
	onSelect: (connection: ConnectionDetails) => void;
}) {
	const detailsQuery = useQuery(secretsManager.connections.query.get(props.id));
	const details = detailsQuery.data?.value;

	return (
		<Pressable
			style={styles.row}
			onPress={() => {
				if (details) props.onSelect(details);
			}}
			disabled={!details}
		>
			<View style={styles.rowTextContainer}>
				<Text style={styles.rowTitle}>
					{details ? `${details.username}@${details.host}` : 'Loading...'}
				</Text>
				<Text style={styles.rowSubtitle}>
					{details ? `Port ${details.port} • ${details.security.type}` : ''}
				</Text>
			</View>
			<Text style={styles.rowChevron}>›</Text>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		padding: 24,
		backgroundColor: '#0B1324',
		justifyContent: 'center',
	},
	scrollContent: {
		paddingBottom: 32,
	},
	header: {
		marginBottom: 16,
		alignItems: 'center',
	},
	appName: {
		fontSize: 28,
		fontWeight: '800',
		color: '#E5E7EB',
		letterSpacing: 1,
	},
	appTagline: {
		marginTop: 4,
		fontSize: 13,
		color: '#9AA0A6',
	},
	card: {
		backgroundColor: '#111B34',
		borderRadius: 20,
		padding: 24,
		marginHorizontal: 4,
		shadowColor: '#000',
		shadowOpacity: 0.3,
		shadowRadius: 16,
		shadowOffset: { width: 0, height: 4 },
		elevation: 8,
		borderWidth: 1,
		borderColor: '#1E293B',
	},
	title: {
		fontSize: 24,
		fontWeight: '700',
		color: '#E5E7EB',
		marginBottom: 6,
		letterSpacing: 0.5,
	},
	subtitle: {
		fontSize: 15,
		color: '#9AA0A6',
		marginBottom: 24,
		lineHeight: 20,
	},
	inputGroup: {
		marginBottom: 12,
	},
	label: {
		marginBottom: 6,
		fontSize: 14,
		color: '#C6CBD3',
		fontWeight: '600',
	},
	input: {
		borderWidth: 1,
		borderColor: '#2A3655',
		backgroundColor: '#0E172B',
		color: '#E5E7EB',
		borderRadius: 10,
		paddingHorizontal: 12,
		paddingVertical: 12,
		fontSize: 16,
	},
	errorText: {
		marginTop: 6,
		color: '#FCA5A5',
		fontSize: 12,
	},
	actions: {
		marginTop: 20,
	},
	mutedText: {
		color: '#9AA0A6',
		fontSize: 14,
	},
	submitButton: {
		backgroundColor: '#2563EB',
		borderRadius: 12,
		paddingVertical: 16,
		alignItems: 'center',
		shadowColor: '#2563EB',
		shadowOpacity: 0.3,
		shadowRadius: 8,
		shadowOffset: { width: 0, height: 2 },
		elevation: 4,
	},
	submitButtonText: {
		color: '#FFFFFF',
		fontWeight: '700',
		fontSize: 16,
		letterSpacing: 0.5,
	},
	buttonDisabled: {
		backgroundColor: '#3B82F6',
		opacity: 0.6,
	},
	secondaryButton: {
		backgroundColor: 'transparent',
		borderWidth: 1,
		borderColor: '#2A3655',
		borderRadius: 12,
		paddingVertical: 14,
		alignItems: 'center',
		marginTop: 12,
	},
	secondaryButtonText: {
		color: '#C6CBD3',
		fontWeight: '600',
		fontSize: 14,
		letterSpacing: 0.3,
	},
	listSection: {
		marginTop: 20,
	},
	listTitle: {
		fontSize: 16,
		fontWeight: '700',
		color: '#E5E7EB',
		marginBottom: 8,
	},
	listContainer: {
		// Intentionally empty for RN compatibility
	},
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		backgroundColor: '#0E172B',
		borderWidth: 1,
		borderColor: '#2A3655',
		borderRadius: 12,
		paddingHorizontal: 12,
		paddingVertical: 12,
		marginBottom: 8,
	},
	rowTextContainer: {
		flex: 1,
		marginRight: 12,
	},
	rowTitle: {
		color: '#E5E7EB',
		fontSize: 15,
		fontWeight: '600',
	},
	rowSubtitle: {
		color: '#9AA0A6',
		marginTop: 2,
		fontSize: 12,
	},
	rowChevron: {
		color: '#9AA0A6',
		fontSize: 22,
		paddingHorizontal: 4,
	},
});
