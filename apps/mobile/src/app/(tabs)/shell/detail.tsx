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
	const terminalReadyRef = useRef(false);
	const pendingOutputRef = useRef<Uint8Array[]>([]);

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

	// SSH -> xterm (remote output). Buffer until xterm is initialized.
	useEffect(() => {
		if (!connection) return;

		const xterm = xtermRef.current;

		const listenerId = connection.addChannelListener((ab: ArrayBuffer) => {
			const bytes = new Uint8Array(ab);
			if (!terminalReadyRef.current) {
				pendingOutputRef.current.push(bytes);
				console.log('SSH->buffer', { len: bytes.length });
				return;
			}
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
					// WebView behavior that suits terminals
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
					// xterm-ish props (applied via setOptions inside the page)
					fontFamily="Menlo, ui-monospace, monospace"
					fontSize={18} // bump if it still feels small
					cursorBlink
					scrollback={10000}
					themeBackground={theme.colors.background}
					themeForeground={theme.colors.textPrimary}
					onRenderProcessGone={() => {
						console.log('WebView render process gone -> clear()');
						xtermRef.current?.clear?.();
					}}
					onContentProcessDidTerminate={() => {
						console.log('WKWebView content process terminated -> clear()');
						xtermRef.current?.clear?.();
					}}
					onLoadEnd={() => {
						console.log('WebView onLoadEnd');
					}}
					onMessage={(m) => {
						console.log('received msg', m);
						if (m.type === 'initialized') {
							terminalReadyRef.current = true;

							// Flush buffered banner/welcome lines
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

							// Focus to pop the keyboard (iOS needs the prop we set)
							xtermRef.current?.focus?.();
							return;
						}
						if (m.type === 'data') {
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
