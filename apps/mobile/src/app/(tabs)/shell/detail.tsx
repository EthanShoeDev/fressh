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
	const terminalReadyRef = useRef(false); // gate for initial SSH output buffering
	const pendingOutputRef = useRef<Uint8Array[]>([]); // bytes we got before xterm init

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
	 * If xterm isn't ready yet, buffer and flush on 'initialized'.
	 */
	useEffect(() => {
		if (!connection) return;
		const xterm = xtermRef.current;

		const listenerId = connection.addChannelListener((ab: ArrayBuffer) => {
			const bytes = new Uint8Array(ab);
			if (!terminalReadyRef.current) {
				// Buffer until WebView->xterm has signaled 'initialized'
				pendingOutputRef.current.push(bytes);
				// Debug
				console.log('SSH->buffer', { len: bytes.length });
				return;
			}
			// Forward bytes immediately
			console.log('SSH->xterm', { len: bytes.length });
			xterm?.write(bytes);
		});

		return () => {
			connection.removeChannelListener(listenerId);
			xterm?.flush?.();
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
					// WebView controls that make terminals feel right:
					keyboardDisplayRequiresUserAction={false}
					setSupportMultipleWindows={false}
					overScrollMode="never"
					pullToRefreshEnabled={false}
					bounces={false}
					setBuiltInZoomControls={false}
					setDisplayZoomControls={false}
					textZoom={100}
					allowsLinkPreview={false}
					textInteractionEnabled={false}
					onRenderProcessGone={() => {
						console.log('WebView render process gone, clearing terminal');
						xtermRef.current?.clear?.();
					}}
					onContentProcessDidTerminate={() => {
						console.log(
							'WKWebView content process terminated, clearing terminal',
						);
						xtermRef.current?.clear?.();
					}}
					// xterm-flavored props for styling/behavior
					fontFamily="Menlo, ui-monospace, monospace"
					fontSize={15}
					cursorBlink
					scrollback={10000}
					themeBackground={theme.colors.background}
					themeForeground={theme.colors.textPrimary}
					// page load => we can push initial options/theme right away;
					// xterm itself will still send 'initialized' once it's truly ready.
					onLoadEnd={() => {
						console.log('WebView onLoadEnd');
					}}
					onMessage={(m) => {
						console.log('received msg', m);
						if (m.type === 'initialized') {
							terminalReadyRef.current = true;

							// Flush any buffered SSH output (welcome banners, etc.)
							if (pendingOutputRef.current.length) {
								const total = pendingOutputRef.current.reduce(
									(n, a) => n + a.length,
									0,
								);
								console.log('Flushing buffered output', {
									chunks: pendingOutputRef.current.length,
									bytes: total,
								});
								for (const chunk of pendingOutputRef.current) {
									xtermRef.current?.write(chunk);
								}
								pendingOutputRef.current = [];
								xtermRef.current?.flush?.();
							}

							// Focus after ready to pop the soft keyboard (iOS needs this prop)
							xtermRef.current?.focus?.();
							return;
						}
						if (m.type === 'data') {
							// xterm user input -> SSH
							// NOTE: msg.data is a fresh Uint8Array starting at offset 0
							console.log('xterm->SSH', { len: m.data.length });
							void shell?.sendData(m.data.buffer as ArrayBuffer);
							return;
						}
						if (m.type === 'debug') {
							console.log('xterm.debug', m.message);
						}
					}}
				/>
			</View>
		</SafeAreaView>
	);
}
