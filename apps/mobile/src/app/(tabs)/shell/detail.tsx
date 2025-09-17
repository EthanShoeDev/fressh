import { Ionicons } from '@expo/vector-icons';
import { RnRussh } from '@fressh/react-native-uniffi-russh';
import {
	XtermJsWebView,
	type XtermWebViewHandle,
} from '@fressh/react-native-xtermjs-webview';

import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { disconnectSshConnectionAndInvalidateQuery } from '@/lib/query-fns';
import { useTheme } from '@/lib/theme';

export default function TabsShellDetail() {
	return <ShellDetail />;
}

function ShellDetail() {
	const xtermRef = useRef<XtermWebViewHandle>(null);
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

	/**
	 * SSH -> xterm (remote output)
	 * Send bytes only; batching is handled inside XtermJsWebView.
	 */
	useEffect(() => {
		if (!connection) return;

		const listenerId = connection.addChannelListener((data: ArrayBuffer) => {
			// Forward bytes to terminal (no string conversion)
			xtermRef.current?.write(new Uint8Array(data));
		});

		return () => {
			connection.removeChannelListener(listenerId);
			// Flush any buffered writes on unmount
			xtermRef.current?.flush?.();
		};
	}, [connection]);

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
										queryClient,
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
					ref={xtermRef}
					style={{ flex: 1 }}
					// Optional: set initial theme/font
					onLoadEnd={() => {
						// Set theme bg/fg and font settings once WebView loads; the page will
						// still send 'initialized' after xterm is ready.
						xtermRef.current?.setTheme?.(
							theme.colors.background,
							theme.colors.text,
						);
						xtermRef.current?.setFont?.('Menlo, ui-monospace, monospace', 14);
					}}
					onMessage={(message) => {
						if (message.type === 'initialized') {
							// Terminal is ready; you could send a greeting or focus it
							xtermRef.current?.focus?.();
							return;
						}
						if (message.type === 'data') {
							// xterm user input -> SSH
							// NOTE: msg.data is a fresh Uint8Array starting at offset 0
							void shell?.sendData(message.data.buffer as ArrayBuffer);
							return;
						}
						if (message.type === 'debug') {
							console.log('xterm.debug', message.message);
						}
					}}
				/>
			</View>
		</SafeAreaView>
	);
}
