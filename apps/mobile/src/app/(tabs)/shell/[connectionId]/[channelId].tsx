import { RnRussh } from '@fressh/react-native-uniffi-russh';
import {
	Link,
	Stack,
	useLocalSearchParams,
	useNavigation,
	useRouter,
} from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

export default function TabsShellDetail() {
	return <ShellDetail />;
}

function ShellDetail() {
	const { connectionId, channelId } = useLocalSearchParams<{
		connectionId: string;
		channelId: string;
	}>();
	const router = useRouter();
	const theme = useTheme();

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

	const scrollViewRef = useRef<ScrollView | null>(null);

	useEffect(() => {
		scrollViewRef.current?.scrollToEnd({ animated: true });
	}, [shellData]);

	return (
		<SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Stack.Screen
				options={{
					headerLeft: () => (
						<Pressable
							onPress={async () => {
								router.back();
							}}
						>
							<Text style={{ color: theme.colors.primary, fontWeight: '700' }}>
								Back
							</Text>
						</Pressable>
					),

					headerRight: () => (
						<Pressable
							onPress={async () => {
								try {
									await connection?.disconnect();
								} catch {}
								router.replace('/shell');
							}}
						>
							<Text style={{ color: theme.colors.primary, fontWeight: '700' }}>
								Disconnect
							</Text>
						</Pressable>
					),
				}}
			/>
			<View
				style={[styles.container, { backgroundColor: theme.colors.background }]}
			>
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
						await shell?.sendData(
							Uint8Array.from(new TextEncoder().encode(command + '\n')).buffer,
						);
					}}
				/>
			</View>
		</SafeAreaView>
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
		<View>
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
				style={[styles.executeButton, { marginTop: 8 }]}
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
