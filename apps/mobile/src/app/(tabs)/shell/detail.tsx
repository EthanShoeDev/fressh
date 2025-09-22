import { Ionicons } from '@expo/vector-icons';
import { type ListenerEvent } from '@fressh/react-native-uniffi-russh';
import {
	XtermJsWebView,
	type XtermWebViewHandle,
} from '@fressh/react-native-xtermjs-webview';

import {
	Stack,
	useLocalSearchParams,
	useRouter,
	useFocusEffect,
} from 'expo-router';
import React, { startTransition, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
	KeyboardAvoidingView,
	KeyboardToolbar,
} from 'react-native-keyboard-controller';
import { useSshStore } from '@/lib/ssh-store';
import { useTheme } from '@/lib/theme';
import { useBottomTabSpacing } from '@/lib/useBottomTabSpacing';

export default function TabsShellDetail() {
	const [ready, setReady] = useState(false);

	useFocusEffect(
		React.useCallback(() => {
			startTransition(() => {
				setTimeout(() => {
					// TODO: This is gross. It would be much better to switch
					// after the navigation animation completes.
					setReady(true);
				}, 16);
			});

			return () => {
				setReady(false);
			};
		}, []),
	);

	if (!ready) return <RouteSkeleton />;
	return <ShellDetail />;
}

function RouteSkeleton() {
	const theme = useTheme();
	return (
		<View
			style={{
				flex: 1,
				justifyContent: 'center',
				alignItems: 'center',
				backgroundColor: theme.colors.background,
			}}
		>
			<Text style={{ color: theme.colors.textPrimary, fontSize: 20 }}>
				Loading
			</Text>
		</View>
	);
}

const encoder = new TextEncoder();

function ShellDetail() {
	const xtermRef = useRef<XtermWebViewHandle>(null);
	const terminalReadyRef = useRef(false);
	const listenerIdRef = useRef<bigint | null>(null);

	const searchParams = useLocalSearchParams<{
		connectionId?: string;
		channelId?: string;
	}>();

	if (!searchParams.connectionId || !searchParams.channelId)
		throw new Error('Missing connectionId or channelId');

	const connectionId = searchParams.connectionId;
	const channelId = parseInt(searchParams.channelId);

	const router = useRouter();
	const theme = useTheme();

	const shell = useSshStore(
		(s) => s.shells[`${connectionId}-${channelId}` as const],
	);
	const connection = useSshStore((s) => s.connections[connectionId]);

	useEffect(() => {
		if (shell && connection) return;
		console.log('shell or connection not found, replacing route with /shell');
		router.back();
	}, [connection, router, shell]);

	useEffect(() => {
		const xterm = xtermRef.current;
		return () => {
			if (shell && listenerIdRef.current != null)
				shell.removeListener(listenerIdRef.current);
			listenerIdRef.current = null;
			if (xterm) xterm.flush();
		};
	}, [shell]);

	const marginBottom = useBottomTabSpacing();

	return (
		<>
			<View
				style={{
					justifyContent: 'flex-start',
					backgroundColor: theme.colors.background,
					paddingTop: 2,
					paddingLeft: 8,
					paddingRight: 8,
					paddingBottom: 0,
					marginBottom,
					flex: 1,
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
										await connection.disconnect();
									} catch (e) {
										console.warn('Failed to disconnect', e);
									}
								}}
							>
								<Ionicons name="power" size={20} color={theme.colors.primary} />
							</Pressable>
						),
					}}
				/>
				<KeyboardAvoidingView
					behavior="height"
					keyboardVerticalOffset={210}
					style={{ flex: 1 }}
				>
					<XtermJsWebView
						ref={xtermRef}
						style={{ flex: 1 }}
						webViewOptions={{
							// Prevent iOS from adding automatic top inset inside WebView
							contentInsetAdjustmentBehavior: 'never',
						}}
						logger={{
							log: console.log,
							// debug: console.log,
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

							if (!shell) throw new Error('Shell not found');

							// Replay from head, then attach live listener
							void (async () => {
								const res = shell.readBuffer({ mode: 'head' });
								console.log('readBuffer(head)', {
									chunks: res.chunks.length,
									nextSeq: res.nextSeq,
									dropped: res.dropped,
								});
								if (res.chunks.length) {
									const chunks = res.chunks.map((c) => c.bytes);
									const xr = xtermRef.current;
									if (xr) {
										xr.writeMany(chunks.map((c) => new Uint8Array(c)));
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
										if (xr3) xr3.write(new Uint8Array(chunk.bytes));
									},
									{ cursor: { mode: 'seq', seq: res.nextSeq } },
								);
								console.log('shell listener attached', id.toString());
								listenerIdRef.current = id;
							})();
							// Focus to pop the keyboard (iOS needs the prop we set)
							const xr2 = xtermRef.current;
							if (xr2) xr2.focus();
						}}
						onData={(terminalMessage) => {
							if (!shell) return;
							const bytes = encoder.encode(terminalMessage);
							shell.sendData(bytes.buffer).catch((e: unknown) => {
								console.warn('sendData failed', e);
								router.back();
							});
						}}
					/>
				</KeyboardAvoidingView>
			</View>
			<KeyboardToolbar
				offset={{
					opened: -80,
				}}
			/>
		</>
	);
}
