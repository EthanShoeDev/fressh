/**
 * This is the page that is shown after an ssh connection
 */
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from 'react-native';
import { sshConnectionManager } from '../lib/ssh-connection-manager';

export default function Shell() {
	// https://docs.expo.dev/router/reference/url-parameters/
	const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
	const sshConn = sshConnectionManager.getSession({ sessionId }); // this throws if the session is not found

	const [shellData, setShellData] = useState('');

	useEffect(() => {
		sshConn.client.on('Shell', (data) => {
			console.log('Received data (on Shell):', data);
			setShellData((prev) => prev + data);
		});
		//  return () => {
		// 	sshConn.client.off('Shell')
		//  }
	}, [setShellData, sshConn.client]);

	useEffect(() => {
		return () => {
			setTimeout(() => {
				try {
					sshConnectionManager.removeAndDisconnectSession({ sessionId });
					console.log('Disconnected from SSH server');
				} catch (error) {
					console.error('Error disconnecting from SSH server', error);
				}
			}, 3_000);
		};
	}, [sessionId]);

	const scrollViewRef = useRef<ScrollView | null>(null);

	useEffect(() => {
		// Auto-scroll to bottom when new data arrives
		scrollViewRef.current?.scrollToEnd({ animated: true });
	}, [shellData]);

	return (
		<View style={styles.container}>
			<Text style={styles.title}>SSH Shell</Text>
			<View style={styles.terminal}>
				<ScrollView
					ref={scrollViewRef}
					contentContainerStyle={styles.terminalContent}
					keyboardShouldPersistTaps="handled"
				>
					<Text selectable style={styles.terminalText}>
						{shellData || 'Connected. Output will appear here...'}
					</Text>
				</ScrollView>
			</View>
			<CommandInput
				executeCommand={async (command) => {
					console.log('Executing command:', command);
					await sshConn.client.writeToShell(command + '\n');
				}}
			/>
		</View>
	);
}

function CommandInput(props: {
	executeCommand: (command: string) => Promise<void>;
}) {
	const [command, setCommand] = useState('');

	async function handleExecute() {
		if (!command.trim()) return;
		await props.executeCommand(command);
		setCommand('');
	}

	return (
		<View style={styles.commandBar}>
			<TextInput
				testID="command-input"
				style={styles.commandInput}
				value={command}
				onChangeText={setCommand}
				placeholder="Type a command and press Enter or Execute"
				placeholderTextColor="#9AA0A6"
				autoCapitalize="none"
				autoCorrect={false}
				returnKeyType="send"
				onSubmitEditing={handleExecute}
			/>
			<Pressable
				style={styles.executeButton}
				onPress={handleExecute}
				testID="execute-button"
			>
				<Text style={styles.executeButtonText}>Execute</Text>
			</Pressable>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: '#0B1324',
		padding: 16,
	},
	title: {
		color: '#E5E7EB',
		fontSize: 18,
		fontWeight: '700',
		marginBottom: 12,
	},
	terminal: {
		flex: 1,
		backgroundColor: '#0E172B',
		borderRadius: 12,
		borderWidth: 1,
		borderColor: '#2A3655',
		overflow: 'hidden',
		marginBottom: 12,
	},
	terminalContent: {
		padding: 12,
	},
	terminalText: {
		color: '#D1D5DB',
		fontSize: 14,
		lineHeight: 18,
		fontFamily: Platform.select({
			ios: 'Menlo',
			android: 'monospace',
			default: 'monospace',
		}),
	},
	commandBar: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
	},
	commandInput: {
		flex: 1,
		backgroundColor: '#0E172B',
		borderWidth: 1,
		borderColor: '#2A3655',
		borderRadius: 10,
		paddingHorizontal: 12,
		paddingVertical: 12,
		color: '#E5E7EB',
		fontSize: 16,
		fontFamily: Platform.select({
			ios: 'Menlo',
			android: 'monospace',
			default: 'monospace',
		}),
	},
	executeButton: {
		backgroundColor: '#2563EB',
		borderRadius: 10,
		paddingHorizontal: 16,
		paddingVertical: 12,
		alignItems: 'center',
		justifyContent: 'center',
	},
	executeButtonText: {
		color: '#FFFFFF',
		fontWeight: '700',
		fontSize: 14,
	},
});
