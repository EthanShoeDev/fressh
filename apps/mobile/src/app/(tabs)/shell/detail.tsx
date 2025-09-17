import { Ionicons } from '@expo/vector-icons';
import { RnRussh } from '@fressh/react-native-uniffi-russh';
import {
	XtermJsWebView,
	type XtermWebViewHandle,
} from '@fressh/react-native-xtermjs-webview';

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
	Platform,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';

const renderer: 'xtermjs' | 'rn-text' = 'xtermjs';
const decoder = new TextDecoder('utf-8');

export default function TabsShellDetail() {
	return <ShellDetail />;
}

function ShellDetail() {
	const xtermWebViewRef = useRef<XtermWebViewHandle>(null);
	const { connectionId, channelId } = useLocalSearchParams<{
		connectionId?: string;
		channelId?: string;
	}>();
	const router = useRouter();
	const theme = useTheme();

	const channelIdNum = Number(channelId);
	const connection = connectionId
		? RnRussh.getSshConnection(String(connectionId))
		: undefined;
	const shell =
		connectionId && channelId
			? RnRussh.getSshShell(String(connectionId), channelIdNum)
			: undefined;

	const [shellData, setShellData] = useState('');

	useEffect(() => {
		if (!connection) return;
		const listenerId = connection.addChannelListener((data: ArrayBuffer) => {
			try {
				const bytes = new Uint8Array(data);
				xtermWebViewRef.current?.write(bytes);
				const chunk = decoder.decode(bytes);
				setShellData((prev) => prev + chunk);
			} catch (e) {
				console.warn('Failed to decode shell data', e);
			}
		});
		return () => {
			connection.removeChannelListener(listenerId);
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
					headerBackVisible: true,
					headerRight: () => (
						<Pressable
							accessibilityLabel="Disconnect"
							hitSlop={10}
							onPress={async () => {
								try {
									await connection?.disconnect();
								} catch {}
								router.replace('/shell');
							}}
						>
							<Ionicons name="power" size={20} color={theme.colors.primary} />
						</Pressable>
					),
				}}
			/>
			<View
				style={[
					{ flex: 1, backgroundColor: '#0B1324', padding: 12 },
					{ backgroundColor: theme.colors.background },
				]}
			>
				<ScrollView>
					{renderer === 'xtermjs' ? (
						<XtermJsWebView
							ref={xtermWebViewRef}
							style={{ flex: 1, height: 400 }}
							// textZoom={0}
							// injectedJavaScript={`
							// setTimeout(() => {
							// 	document.body.style.backgroundColor = '${theme.colors.background}';
							// 	document.body.style.color = '${theme.colors.textPrimary}';
							// 	document.body.style.fontSize = '80px';
							// 	const termDiv = document.getElementById('terminal');
							// 	termDiv.style.backgroundColor = '${theme.colors.background}';
							// 	termDiv.style.color = '${theme.colors.textPrimary}';
							// 	window.terminal.options.fontSize = 50;
							// }, 50);
							// `}
							onMessage={(event) => {
								console.log('onMessage', event.nativeEvent.data);
							}}
						/>
					) : (
						<View
							style={{
								flex: 1,
								backgroundColor: '#0E172B',
								borderRadius: 12,
								height: 400,
								borderWidth: 1,
								borderColor: '#2A3655',
								overflow: 'hidden',
								marginBottom: 12,
							}}
						>
							<ScrollView
								ref={scrollViewRef}
								contentContainerStyle={{
									paddingHorizontal: 12,
									paddingTop: 4,
									paddingBottom: 12,
								}}
								keyboardShouldPersistTaps="handled"
							>
								<Text
									selectable
									style={{
										color: '#D1D5DB',
										fontSize: 14,
										lineHeight: 18,
										fontFamily: Platform.select({
											ios: 'Menlo',
											android: 'monospace',
											default: 'monospace',
										}),
									}}
								>
									{shellData || 'Connected. Output will appear here...'}
								</Text>
							</ScrollView>
						</View>
					)}
					<CommandInput
						executeCommand={async (command) => {
							await shell?.sendData(
								Uint8Array.from(new TextEncoder().encode(command + '\n'))
									.buffer,
							);
						}}
					/>
				</ScrollView>
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
		<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
			<TextInput
				testID="command-input"
				style={{
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
				}}
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
				style={[
					{
						backgroundColor: '#2563EB',
						borderRadius: 10,
						paddingHorizontal: 16,
						paddingVertical: 12,
						alignItems: 'center',
						justifyContent: 'center',
					},
					{ marginTop: 8 },
				]}
				onPress={handleExecute}
				testID="execute-button"
			>
				<Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>
					Execute
				</Text>
			</Pressable>
		</View>
	);
}
