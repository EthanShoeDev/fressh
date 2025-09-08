/**
 * This is the page that is shown after an ssh connection
 */
import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { sshConnectionManager } from '../lib/ssh-connection-manager'

export default function Shell() {
	// https://docs.expo.dev/router/reference/url-parameters/
	// const { session: sessionId } = useLocalSearchParams<{ session: string }>()
	const sessionId = '123'
	const sshConn = sshConnectionManager.getSession({ sessionId }) // this throws if the session is not found

	const [shellData, setShellData] = useState('')

	useEffect(() => {
		sshConn.client.on('Shell', (data) => {
			setShellData((prev) => prev + data)
		})
		//  return () => {
		// 	sshConn.client.off('Shell')
		//  }
	}, [setShellData, sshConn.client])

	return (
		<View style={{ flex: 1, margin: 16 }}>
			<Text>{shellData}</Text>
		</View>
	)
}
