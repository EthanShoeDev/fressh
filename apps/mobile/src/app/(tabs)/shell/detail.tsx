import { Ionicons } from '@expo/vector-icons';
import { type ListenerEvent } from '@fressh/react-native-uniffi-russh';
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
import { Dimensions, Platform, Pressable, Text, View } from 'react-native';

import {
	SafeAreaView,
	useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { disconnectSshConnectionAndInvalidateQuery } from '@/lib/query-fns';
import { useSshStore, makeSessionKey } from '@/lib/ssh-store';
import { useTheme } from '@/lib/theme';

export default function TabsShellDetail() {
	const [ready, setReady] = useState(false);

	useFocusEffect(
		React.useCallback(() => {
			startTransition(() => {
				setReady(true);
			}); // React 19: non-urgent

			return () => {
				setReady(false);
			};
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

const encoder = new TextEncoder();

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
	const sess = useSshStore((s) =>
		connectionId && channelId
			? s.getByKey(makeSessionKey(connectionId, channelIdNum))
			: undefined,
	);
	const connection = sess?.connection;
	const shell = sess?.shell;

	// If the shell disconnects, leave this screen to the list view
	useEffect(() => {
		if (!sess) return;
		if (sess.status === 'disconnected') {
			// Replace so the detail screen isn't on the stack anymore
			router.replace('/shell');
		}
	}, [router, sess]);

	// SSH -> xterm: on initialized, replay ring head then attach live listener
	useEffect(() => {
		const xterm = xtermRef.current;
		return () => {
			if (shell && listenerIdRef.current != null)
				shell.removeListener(listenerIdRef.current);
			listenerIdRef.current = null;
			if (xterm) xterm.flush();
		};
	}, [shell]);

	const queryClient = useQueryClient();
	const insets = useSafeAreaInsets();
	const estimatedTabBarHeight = Platform.select({
		ios: 49,
		android: 80,
		default: 56,
	});
	const windowH = Dimensions.get('window').height;
	const computeBottomExtra = (y: number, height: number) => {
		const extra = windowH - (y + height);
		return extra > 0 ? extra : 0;
	};

	// Measure any bottom overlap (e.g., native tab bar) and add padding to avoid it
	const [bottomExtra, setBottomExtra] = useState(0);

	return (
		<SafeAreaView
			onLayout={(e) => {
				const { y, height } = e.nativeEvent.layout;
				const extra = computeBottomExtra(y, height);
				if (extra !== bottomExtra) setBottomExtra(extra);
			}}
			style={{
				flex: 1,
				backgroundColor: theme.colors.background,
				padding: 0,
				paddingBottom:
					4 + insets.bottom + (bottomExtra || estimatedTabBarHeight),
			}}
		>
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
			<XtermJsWebView
				ref={xtermRef}
				style={{ flex: 1 }}
				logger={{
					log: console.log,
					debug: console.log,
					warn: console.warn,
					error: console.error,
				}}
				// xterm options
				xtermOptions={{
					theme: {
						background: theme.colors.background,
						foreground: theme.colors.textPrimary,
					},
				}}
				onInitialized={() => {
					if (terminalReadyRef.current) return;
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
								const xr = xtermRef.current;
								if (xr) {
									xr.writeMany(chunks);
									xr.flush();
								}
							}
							const id = shell.addListener(
								(ev: ListenerEvent) => {
									if ('kind' in ev) {
										console.log('listener.dropped', ev);
										return;
									}
									const chunk = ev;
									const xr3 = xtermRef.current;
									if (xr3) xr3.write(chunk.bytes);
								},
								{ cursor: { mode: 'seq', seq: res.nextSeq } },
							);
							console.log('shell listener attached', id.toString());
							listenerIdRef.current = id;
						})();
					}

					// Focus to pop the keyboard (iOS needs the prop we set)
					const xr2 = xtermRef.current;
					if (xr2) xr2.focus();
					return;
				}}
				onData={(terminalMessage) => {
					if (!shell) return;
					const bytes = encoder.encode(terminalMessage);
					if (shell) {
						shell.sendData(bytes.buffer).catch((e: unknown) => {
							console.warn('sendData failed', e);
							router.back();
						});
					}
					return;
				}}
			/>
		</SafeAreaView>
	);
}
