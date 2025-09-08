import { createFormHook, createFormHookContexts } from '@tanstack/react-form'
import { Button, TextInput, View } from 'react-native'

const { fieldContext, formContext } = createFormHookContexts()

function TextField() {
	return <TextInput />
}

function NumberField() {
	return <TextInput keyboardType="numeric" />
}

function SubmitButton() {
	return <Button title="Submit" onPress={() => {}} />
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
			onSubmitAsync: async (values) => {
				console.log(values)
			},
		},
	})

	return (
		<View
			style={{
				flex: 1,
				justifyContent: 'center',
				alignItems: 'center',
			}}
		>
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
			<connectionForm.AppForm>
				<connectionForm.AppField
					name="host"
					children={(field) => <field.TextField />}
				/>
				<connectionForm.AppField
					name="port"
					children={(field) => <field.NumberField />}
				/>
				<connectionForm.AppField
					name="username"
					children={(field) => <field.TextField />}
				/>
				<connectionForm.AppField
					name="password"
					children={(field) => <field.TextField />}
				/>

				<connectionForm.SubmitButton />
			</connectionForm.AppForm>
		</View>
	)
}
