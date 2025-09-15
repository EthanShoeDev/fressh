import { RnRussh } from '@fressh/react-native-uniffi-russh';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { useStore } from '@tanstack/react-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AbortSignalTimeout } from '@/lib/utils';
import { useAppForm, useFieldContext } from '../components/form-components';
import { KeyManagerModal } from '../components/key-manager-modal';
import {
	type ConnectionDetails,
	connectionDetailsSchema,
	secretsManager,
} from '../lib/secrets-manager';
// import { sshConnectionManager } from '../lib/ssh-connection-manager';

const defaultValues: ConnectionDetails = {
	host: 'test.rebex.net',
	port: 22,
	username: 'demo',
	security: {
		type: 'password',
		password: 'password',
	},
};

const useSshConnMutation = () => {
	const router = useRouter();

	return useMutation({
		mutationFn: async (connectionDetails: ConnectionDetails) => {
			try {
				console.log('Connecting to SSH server...');
				const sshConnection = await RnRussh.connect({
					host: connectionDetails.host,
					port: connectionDetails.port,
					username: connectionDetails.username,
					security:
						connectionDetails.security.type === 'password'
							? {
									type: 'password',
									password: connectionDetails.security.password,
								}
							: { type: 'key', privateKey: 'TODO' },
					onStatusChange: (status) => {
						console.log('SSH connection status', status);
					},
					abortSignal: AbortSignalTimeout(5_000),
				});

				await secretsManager.connections.utils.upsertConnection({
					id: 'default',
					details: connectionDetails,
					priority: 0,
				});
				const shellInterface = await sshConnection.startShell({
					pty: 'Xterm',
					onStatusChange: (status) => {
						console.log('SSH shell status', status);
					},
					abortSignal: AbortSignalTimeout(5_000),
				});

				const channelId = shellInterface.channelId as number;
				const connectionId =
					sshConnection.connectionId ??
					`${sshConnection.connectionDetails.username}@${sshConnection.connectionDetails.host}:${sshConnection.connectionDetails.port}|${Math.floor(sshConnection.createdAtMs)}`;
				console.log('Connected to SSH server', connectionId, channelId);
				router.push({
					pathname: '/shell',
					params: {
						connectionId,
						channelId: String(channelId),
					},
				});
			} catch (error) {
				console.error('Error connecting to SSH server', error);
				throw error;
			}
		},
	});
};

export default function Index() {
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
		<ScrollView
			contentContainerStyle={styles.scrollContent}
			keyboardShouldPersistTaps="handled"
		>
			<View style={styles.container}>
				<SafeAreaView style={styles.header}>
					<Text style={styles.appName}>fressh</Text>
					<Text style={styles.appTagline}>A fast, friendly SSH client</Text>
				</SafeAreaView>
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
								<View style={styles.inputGroup}>
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
								{() => <KeyIdPicker />}
							</connectionForm.AppField>
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
			</View>
		</ScrollView>
	);
}

function KeyIdPicker() {
	const field = useFieldContext<string>();
	const hasInteractedRef = React.useRef(false);
	const [manualVisible, setManualVisible] = React.useState(false);

	const listPrivateKeysQuery = useQuery(secretsManager.keys.query.list);
	const defaultPick = React.useMemo(() => {
		const keys = listPrivateKeysQuery.data ?? [];
		const def = keys.find((k) => k.metadata?.isDefault);
		return def ?? keys[0];
	}, [listPrivateKeysQuery.data]);
	const keys = listPrivateKeysQuery.data ?? [];

	const computedSelectedId = field.state.value ?? defaultPick?.id;
	const selected = keys.find((k) => k.id === computedSelectedId);
	const display = selected ? (selected.metadata?.label ?? selected.id) : 'None';

	const isEmpty = (listPrivateKeysQuery.data?.length ?? 0) === 0;
	const visible = manualVisible || (!hasInteractedRef.current && isEmpty);

	return (
		<>
			<View style={styles.inputGroup}>
				<Text style={styles.label}>Private Key</Text>
				<Pressable
					style={[styles.input, { justifyContent: 'center' }]}
					onPress={() => {
						hasInteractedRef.current = true;
						setManualVisible(true);
					}}
				>
					<Text style={{ color: '#E5E7EB' }}>{display}</Text>
				</Pressable>
				{!selected && (
					<Text style={styles.mutedText}>
						Open Key Manager to add/select a key
					</Text>
				)}
			</View>
			<KeyManagerModal
				visible={visible}
				selectedKeyId={computedSelectedId}
				onSelect={(id) => {
					hasInteractedRef.current = true;
					field.handleChange(id);
				}}
				onClose={() => {
					hasInteractedRef.current = true;
					setManualVisible(false);
				}}
			/>
		</>
	);
}

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
