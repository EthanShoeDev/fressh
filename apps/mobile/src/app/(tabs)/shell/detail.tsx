import { Ionicons } from '@expo/vector-icons';
import {
	type ListenerEvent,
	type TerminalChunk,
} from '@fressh/react-native-uniffi-russh';
import {
	XtermJsWebView,
	type XtermWebViewHandle,
} from '@fressh/react-native-xtermjs-webview';

import { useQueryClient } from '@tanstack/react-query';
import {
	Stack,
	useLocalSearchParams,
	useRouter,
	useFocusEffect,
} from 'expo-router';
import React, { startTransition, useEffect, useRef, useState } from 'react';
import { Pressable, View, Text } from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { disconnectSshConnectionAndInvalidateQuery } from '@/lib/query-fns';
import { getSession } from '@/lib/ssh-registry';
import { useTheme } from '@/lib/theme';

export default function TabsShellDetail() {
	const [ready, setReady] = useState(false);

	useFocusEffect(
		React.useCallback(() => {
			startTransition(() => setReady(true)); // React 19: non-urgent

			return () => setReady(false);
		}, []),
	);

	if (!ready) return <RouteSkeleton />;
	return <ShellDetail />;
}

function RouteSkeleton() {
	return (
		<View>
			<Text>Loading</Text>
		</View>
	);
}

function ShellDetail() {
	const xtermRef = useRef<XtermWebViewHandle>(null);
	const terminalReadyRef = useRef(false);
	// Legacy buffer no longer used; relying on Rust ring for replay
	const listenerIdRef = useRef<bigint | null>(null);

	const { connectionId, channelId } = useLocalSearchParams<{
		connectionId?: string;
		channelId?: string;
	}>();
	const router = useRouter();
	const theme = useTheme();

	const channelIdNum = Number(channelId);
	const sess =
		connectionId && channelId
			? getSession(String(connectionId), channelIdNum)
			: undefined;
	const connection = sess?.connection;
	const shell = sess?.shell;

	// SSH -> xterm: on initialized, replay ring head then attach live listener
	useEffect(() => {
		const xterm = xtermRef.current;
		return () => {
			if (shell && listenerIdRef.current != null)
				shell.removeListener(listenerIdRef.current);
			listenerIdRef.current = null;
			xterm?.flush?.();
		};
	}, [shell]);

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

							// Replay from head, then attach live listener
							if (shell) {
								void (async () => {
									const res = await shell.readBuffer({ mode: 'head' });
									console.log('readBuffer(head)', {
										chunks: res.chunks.length,
										nextSeq: res.nextSeq,
										dropped: res.dropped,
									});
									if (res.chunks.length) {
										const chunks = res.chunks.map((c) => c.bytes);
										xtermRef.current?.writeMany?.(chunks);
										xtermRef.current?.flush?.();
									}
									const id = shell.addListener(
										(ev: ListenerEvent) => {
											if ('kind' in ev && ev.kind === 'dropped') {
												console.log('listener.dropped', ev);
												return;
											}
											const chunk = ev as TerminalChunk;
											xtermRef.current?.write(chunk.bytes);
										},
										{ cursor: { mode: 'live' } },
									);
									listenerIdRef.current = id;
								})();
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
