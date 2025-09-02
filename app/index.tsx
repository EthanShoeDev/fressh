import SSHClient, { PtyType } from '@dylankenneally/react-native-ssh-sftp'
import { Button, Text, View } from 'react-native'

export default function Index() {
	return (
		<View
			style={{
				flex: 1,
				justifyContent: 'center',
				alignItems: 'center',
			}}
		>
			<Text>Edit app/index.tsx to edit this screen.</Text>
			<Button
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
			/>
		</View>
	)
}
