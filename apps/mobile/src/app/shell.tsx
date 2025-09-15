/**
 * This is the page that is shown after an ssh connection
 */
import { RnRussh } from '@fressh/react-native-uniffi-russh';
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

export default function Shell() {
	// https://docs.expo.dev/router/reference/url-parameters/
	const { connectionId, channelId } = useLocalSearchParams<{
		connectionId: string;
		channelId: string;
	}>();

	const channelIdNum = Number(channelId);
	const connection = RnRussh.getSshConnection(connectionId);
	const shell = RnRussh.getSshShell(connectionId, channelIdNum);

	const [shellData, setShellData] = useState('');

	// Subscribe to data frames on the connection
	useEffect(() => {
		if (!connection) return;
		const decoder = new TextDecoder('utf-8');
		const channelListenerId = connection.addChannelListener(
			(data: ArrayBuffer) => {
				try {
					const bytes = new Uint8Array(data);
					const chunk = decoder.decode(bytes);
					console.log('Received data (on Shell):', chunk.length, 'chars');
					setShellData((prev) => prev + chunk);
				} catch (e) {
					console.warn('Failed to decode shell data', e);
				}
			},
		);
		return () => {
			connection.removeChannelListener(channelListenerId);
		};
	}, [connection]);

	// Cleanup when leaving screen
	useEffect(() => {
		return () => {
			if (connection) void connection.disconnect().catch(() => {});
		};
	}, [connection, shell]);

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
					await shell?.sendData(
						Uint8Array.from(new TextEncoder().encode(command + '\n')).buffer,
					);
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
