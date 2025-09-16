import { Ionicons } from '@expo/vector-icons';
import { RnRussh } from '@fressh/react-native-uniffi-russh';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
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
import { useTheme } from '@/lib/theme';

export default function TabsShellDetail() {
	return <ShellDetail />;
}

function ShellDetail() {
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
	const [inputValue, setInputValue] = useState('');
	const hiddenInputRef = useRef<TextInput | null>(null);

	useEffect(() => {
		if (!connection) return;
		const decoder = new TextDecoder('utf-8');
		const listenerId = connection.addChannelListener((data: ArrayBuffer) => {
			try {
				const bytes = new Uint8Array(data);
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

	useEffect(() => {
		const focusTimeout = setTimeout(() => {
			hiddenInputRef.current?.focus();
		}, 0);
		return () => clearTimeout(focusTimeout);
	}, []);

	async function sendChunk(chunk: string) {
		if (!shell || !chunk) return;
		const bytes = Uint8Array.from(new TextEncoder().encode(chunk)).buffer;
		try {
			await shell.sendData(bytes);
		} catch {}
	}

	return (
		<SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Stack.Screen
				options={{
					headerBackVisible: true,
					headerLeft:
						Platform.OS === 'android'
							? () => (
									<Pressable
										onPress={() => router.back()}
										hitSlop={10}
										style={{ paddingHorizontal: 4, paddingVertical: 4 }}
									>
										<Ionicons
											name="chevron-back"
											size={22}
											color={theme.colors.textPrimary}
										/>
									</Pressable>
								)
							: undefined,
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
				style={[styles.container, { backgroundColor: theme.colors.background }]}
			>
				<View
					style={styles.terminal}
					onStartShouldSetResponder={() => {
						hiddenInputRef.current?.focus();
						return false;
					}}
				>
					<ScrollView
						ref={scrollViewRef}
						contentContainerStyle={styles.terminalContent}
						keyboardShouldPersistTaps="handled"
					>
						<Text selectable style={styles.terminalText}>
							{shellData || 'Connected. Output will appear here...'}
						</Text>
					</ScrollView>
					<TextInput
						ref={hiddenInputRef}
						value={inputValue}
						onChangeText={async (text) => {
							if (!text) return;
							await sendChunk(text);
							setInputValue('');
						}}
						onKeyPress={async (e) => {
							const key = e.nativeEvent.key;
							if (key === 'Backspace') {
								await sendChunk('\b');
							}
						}}
						onSubmitEditing={async () => {
							await sendChunk('\n');
						}}
						style={styles.hiddenInput}
						autoFocus
						multiline
						caretHidden
						autoCorrect={false}
						autoCapitalize="none"
						keyboardType="visible-password"
						blurOnSubmit={false}
					/>
				</View>
			</View>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: '#0B1324',
		padding: 12,
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
		paddingHorizontal: 12,
		paddingTop: 4,
		paddingBottom: 12,
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
	hiddenInput: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		opacity: 0,
		color: 'transparent',
	},
});
