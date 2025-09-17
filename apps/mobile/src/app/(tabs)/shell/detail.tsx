import { Ionicons } from '@expo/vector-icons';
import { RnRussh } from '@fressh/react-native-uniffi-russh';
import {
	XtermJsWebView,
	type XtermWebViewHandle,
} from '@fressh/react-native-xtermjs-webview';

import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import PQueue from 'p-queue';
import React, { useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { disconnectSshConnectionAndInvalidateQuery } from '@/lib/query-fns';
import { useTheme } from '@/lib/theme';

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

	function sendDataToXterm(data: ArrayBuffer) {
		try {
			const bytes = new Uint8Array(data.slice());
			console.log('sendDataToXterm', new TextDecoder().decode(bytes.slice()));
			xtermWebViewRef.current?.write(bytes.slice());
		} catch (e) {
			console.warn('Failed to decode shell data', e);
		}
	}

	const queueRef = useRef<PQueue>(null);

	useEffect(() => {
		if (!queueRef.current)
			queueRef.current = new PQueue({
				concurrency: 1,
				intervalCap: 1, // <= one task per interval
				interval: 100, // <= 100ms between tasks
				autoStart: false, // <= buffer until we start()
			});
		const xtermQueue = queueRef.current;
		if (!connection || !xtermQueue) return;
		const listenerId = connection.addChannelListener((data: ArrayBuffer) => {
			console.log(
				'ssh.onData',
				new TextDecoder().decode(new Uint8Array(data.slice())),
			);
			void xtermQueue.add(() => {
				sendDataToXterm(data);
			});
		});
		return () => {
			connection.removeChannelListener(listenerId);
			xtermQueue.pause();
			xtermQueue.clear();
		};
	}, [connection, queueRef]);

	const queryClient = useQueryClient();

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
								if (!connection) return;
								try {
									await disconnectSshConnectionAndInvalidateQuery({
										connectionId: connection.connectionId,
										queryClient: queryClient,
									});
								} catch (e) {
									console.warn('Failed to disconnect', e);
								}
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
				<XtermJsWebView
					ref={xtermWebViewRef}
					style={{ flex: 1, height: 400 }}
					// textZoom={0}
					injectedJavaScript={`
document.body.style.backgroundColor = '${theme.colors.background}';
const termDiv = document.getElementById('terminal');
window.terminal.options.fontSize = 50;
setTimeout(() => {
	window.fitAddon?.fit();
}, 1_000);
							`}
					onMessage={(message) => {
						if (message.type === 'initialized') {
							console.log('xterm.onMessage initialized');
							queueRef.current?.start();
							return;
						}
						const data = message.data;
						console.log('xterm.onMessage', new TextDecoder().decode(data));
						void shell?.sendData(data.slice().buffer as ArrayBuffer);
					}}
				/>
			</View>
		</SafeAreaView>
	);
}
