import SSHClient, { PtyType } from '@dylankenneally/react-native-ssh-sftp'
import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { useFresshAppForm } from '../lib/app-form'
import { sshConnectionManager } from '../lib/ssh-connection-manager'

export default function Index() {
	const router = useRouter()
	const connectionForm = useFresshAppForm({
		defaultValues: {
			// host: '',
			// port: 22,
			// username: '',
			// password: '',
			// TODO:  Remove this weird default
			host: 'test.rebex.net',
			port: 22,
			username: 'demo',
			password: 'password',
		},
		validators: {
			// TODO: Add a zod validator here
			// onChange: z.object({
			// 	email: z.email(),
			//   }),
			onSubmitAsync: async ({ value }) => {
				console.log('Connecting to SSH server...')
				const sshClientConnection = await SSHClient.connectWithPassword(
					value.host,
					value.port,
					value.username,
					value.password,
				)
				console.log('Connected to SSH server')

				// sshClientConnection.on('Shell', (data) => {
				// 	console.log(data)
				// })
				await sshClientConnection.startShell(PtyType.XTERM)
				const sshConn = sshConnectionManager.addSession({
					client: sshClientConnection,
				})
				router.push(`/shell`)
			},
		},
	})

	return (
		<View style={styles.container}>
			<View style={styles.card}>
				<Text style={styles.title}>Connect to SSH Server</Text>
				<Text style={styles.subtitle}>Enter your server credentials</Text>

				<connectionForm.AppForm>
					<connectionForm.AppField name="host">
						{(field) => (
							<field.TextField
								label="Host"
								placeholder="example.com or 192.168.0.10"
								field={field}
								autoCapitalize="none"
								autoCorrect={false}
								value={field.state.value}
								onChangeText={field.handleChange}
								onBlur={field.handleBlur}
							/>
						)}
					</connectionForm.AppField>
					<connectionForm.AppField name="port">
						{(field) => (
							<field.NumberField
								label="Port"
								placeholder="22"
								field={field}
								value={field.state.value.toString()}
								onChangeText={(text) => field.handleChange(Number(text))}
								onBlur={field.handleBlur}
							/>
						)}
					</connectionForm.AppField>
					<connectionForm.AppField name="username">
						{(field) => (
							<field.TextField
								label="Username"
								placeholder="root"
								field={field}
								autoCapitalize="none"
								autoCorrect={false}
								value={field.state.value}
								onChangeText={field.handleChange}
								onBlur={field.handleBlur}
							/>
						)}
					</connectionForm.AppField>
					<connectionForm.AppField name="password">
						{(field) => (
							<field.TextField
								label="Password"
								placeholder="••••••••"
								field={field}
								secureTextEntry
								value={field.state.value}
								onChangeText={field.handleChange}
								onBlur={field.handleBlur}
							/>
						)}
					</connectionForm.AppField>

					<View style={styles.actions}>
						<connectionForm.SubmitButton
							title="Connect"
							onPress={() => {
								connectionForm.handleSubmit()
							}}
						/>
					</View>
				</connectionForm.AppForm>
			</View>
		</View>
	)
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		padding: 24,
		backgroundColor: '#0B1324',
		justifyContent: 'center',
	},
	card: {
		backgroundColor: '#111B34',
		borderRadius: 16,
		padding: 20,
		shadowColor: '#000',
		shadowOpacity: 0.2,
		shadowRadius: 12,
		elevation: 6,
	},
	title: {
		fontSize: 22,
		fontWeight: '700',
		color: '#E5E7EB',
		marginBottom: 4,
	},
	subtitle: {
		fontSize: 14,
		color: '#9AA0A6',
		marginBottom: 16,
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
		marginTop: 8,
	},
	submitButton: {
		backgroundColor: '#2563EB',
		borderRadius: 10,
		paddingVertical: 14,
		alignItems: 'center',
	},
	submitButtonText: {
		color: '#FFFFFF',
		fontWeight: '700',
		fontSize: 16,
	},
	buttonDisabled: {
		backgroundColor: '#3B82F6',
		opacity: 0.6,
	},
})
