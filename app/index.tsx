import SSHClient, { PtyType } from '@dylankenneally/react-native-ssh-sftp'
import {
	AnyFieldApi,
	createFormHook,
	createFormHookContexts,
} from '@tanstack/react-form'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

const { fieldContext, formContext } = createFormHookContexts()

// https://tanstack.com/form/latest/docs/framework/react/quick-start
function TextField(
	props: React.ComponentProps<typeof TextInput> & {
		label?: string
		field: AnyFieldApi
	},
) {
	const { label, field, style, ...rest } = props
	const meta = field.state.meta
	const errorMessage = meta?.errors?.[0] // TODO: typesafe errors

	return (
		<View style={styles.inputGroup}>
			{label ? <Text style={styles.label}>{label}</Text> : null}
			<TextInput
				{...rest}
				style={[styles.input, style]}
				placeholderTextColor="#9AA0A6"
			/>
			{errorMessage ? (
				<Text style={styles.errorText}>{String(errorMessage)}</Text>
			) : null}
		</View>
	)
}

function NumberField(
	props: React.ComponentProps<typeof TextInput> & {
		label?: string
		field: AnyFieldApi
	},
) {
	const { label, field, style, keyboardType, onChangeText, ...rest } = props
	const meta = field.state.meta
	const errorMessage = meta?.errors?.[0]

	return (
		<View style={styles.inputGroup}>
			{label ? <Text style={styles.label}>{label}</Text> : null}
			<TextInput
				{...rest}
				keyboardType={keyboardType ?? 'numeric'}
				style={[styles.input, style]}
				placeholderTextColor="#9AA0A6"
				onChangeText={(text) => {
					if (onChangeText) onChangeText(text)
				}}
			/>
			{errorMessage ? (
				<Text style={styles.errorText}>{String(errorMessage)}</Text>
			) : null}
		</View>
	)
}

function SubmitButton(props: {
	onPress?: () => void
	title?: string
	disabled?: boolean
}) {
	const { onPress, title = 'Connect', disabled } = props
	return (
		<Pressable
			style={[
				styles.submitButton,
				disabled ? styles.buttonDisabled : undefined,
			]}
			onPress={onPress}
			disabled={disabled}
		>
			<Text style={styles.submitButtonText}>{title}</Text>
		</Pressable>
	)
}

// Allow us to bind components to the form to keep type safety but reduce production boilerplate
// Define this once to have a generator of consistent form instances throughout your app
const { useAppForm } = createFormHook({
	fieldComponents: {
		TextField,
		NumberField,
	},
	formComponents: {
		SubmitButton,
	},
	fieldContext,
	formContext,
})

export default function Index() {
	const connectionForm = useAppForm({
		defaultValues: {
			host: '',
			port: 22,
			username: '',
			password: '',
		},
		validators: {
			onSubmitAsync: async ({ value }) => {
				// we will connect here.
				// if connection fails, tanstack form will know the form is in an error state.

				// we can read that state from the field.state.meta.errors (or errorMap)
				//
				SSHClient.connectWithPassword(
					value.host,
					value.port,
					value.username,
					value.password,
				).then(async (client) => {
					alert('Connected')
					client.on('Shell', (data) => {
						console.log(data)
					})
					await client.startShell(PtyType.XTERM)

					setTimeout(() => {
						client.disconnect()
					}, 5_000)
				})
			},
		},
	})

	return (
		<View style={styles.container}>
			{/* <Button
				title="Click me"
				onPress={() => {
					console.log('Connecting...')
					SSHClient.connectWithPassword(
						'test.rebex.net',
						22,
						'demo',
						'password',
					).then(async (client) => {
						alert('Connected')
						client.on('Shell', (data) => {
							console.log(data)
						})
						await client.startShell(PtyType.XTERM)

						setTimeout(() => {
							client.disconnect()
						}, 5_000)
					})
				}}
			/> */}
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
							/>
						)}
					</connectionForm.AppField>
					<connectionForm.AppField name="port">
						{(field) => (
							<field.NumberField label="Port" placeholder="22" field={field} />
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
