import { useAtomValue } from '@effect/atom-react';
import { FontAwesome6 } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { Button } from '@/components/themed/Button';
import { ScreenHeader } from '@/components/themed/ScreenHeader';
import { ThemedScreen, useSurfaceStyle } from '@/components/themed/ThemedScreen';
import { ThemedText } from '@/components/themed/ThemedText';
import { rootLogger } from '@/lib/logger';
import { useSshConnMutation } from '@/lib/query-fns';
import { secretsManager } from '@/lib/secrets-manager';
import { useConnectionShells, useLiveConnection } from '@/lib/server-status';
import type { StoreShell } from '@/lib/ssh-store';
import { applyCase, useThemeSkin } from '@/lib/theme-skin';
import { useBottomTabSpacing } from '@/lib/useBottomTabSpacing';

const logger = rootLogger.extend('ServerDetail');

export default function ServerDetailScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	return (
		<ThemedScreen edges={['top']}>
			<ServerDetailContent id={id} />
		</ThemedScreen>
	);
}

function ServerDetailContent({ id }: { id: string }) {
	const router = useRouter();
	const skin = useThemeSkin();
	const marginBottom = useBottomTabSpacing();
	const onPrimaryColor = useCSSVariable(
		'--color-button-text-on-primary',
	) as string;
	const detailsResult = useAtomValue(secretsManager.connections.atoms.get(id));
	const entry = AsyncResult.isSuccess(detailsResult)
		? detailsResult.value
		: undefined;
	const details = entry?.value;
	const rawName =
		entry?.metadata.label ??
		(details ? `${details.username}@${details.host}` : 'Server');
	const subtitle = details
		? `${details.username}@${details.host}:${details.port} · ${details.security.type === 'key' ? 'key' : 'password'}`
		: undefined;

	const match = details
		? { host: details.host, port: details.port, username: details.username }
		: undefined;
	const live = useLiveConnection(match);
	const shells = useConnectionShells(live?.connectionId);

	const [busy, setBusy] = React.useState(false);
	const sshConnMutation = useSshConnMutation();

	const openTerminal = React.useCallback(
		(connectionId: string, channelId: number) => {
			router.push({
				pathname: '/servers/terminal',
				params: { connectionId, channelId: String(channelId) },
			});
		},
		[router],
	);

	const onNewShell = React.useCallback(async () => {
		if (busy || !details) {
			return;
		}
		setBusy(true);
		try {
			if (live) {
				const shell = await live.startShell();
				openTerminal(live.connectionId, shell.channelId);
			} else {
				const success = await sshConnMutation.mutateAsync(details);
				openTerminal(success.connectionId, success.channelId);
			}
		} catch (error) {
			logger.warn('Failed to start shell', error);
		} finally {
			setBusy(false);
		}
	}, [busy, details, live, openTerminal, sshConnMutation]);

	const monoFamily = skin.mono ? skin.monoFamily : undefined;

	if (AsyncResult.isFailure(detailsResult)) {
		return (
			<View className='flex-1 items-center justify-center'>
				<ThemedText className='text-danger'>Couldn’t load this server.</ThemedText>
			</View>
		);
	}

	return (
		<View className='flex-1'>
			<ScreenHeader
				onBack={() => router.back()}
				title={rawName}
				subtitle={subtitle}
				right={<LiveBadge shellCount={shells.length} connected={!!live} />}
			/>
			<ScrollView
				className='flex-1'
				contentContainerStyle={{
					paddingHorizontal: 20,
					paddingTop: 12,
					paddingBottom: marginBottom,
				}}
			>
				{/* New shell */}
				<Button
					title={live ? 'New shell' : 'Connect new shell'}
					loading={busy}
					loadingTitle='Connecting…'
					disabled={!details}
					onPress={() => {
						void onNewShell();
					}}
					icon={<FontAwesome6 name='plus' size={15} color={onPrimaryColor} />}
				/>

				{/* Active shells */}
				<ThemedText
					className='mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-muted'
					style={monoFamily ? { fontFamily: monoFamily } : undefined}
				>
					{applyCase(skin, 'Active shells · resume')}
				</ThemedText>
				{shells.length === 0 ? (
					<ThemedText className='text-sm text-muted'>
						{applyCase(skin, 'No active shells. Start one above.')}
					</ThemedText>
				) : (
					<View className='gap-2.5'>
						{shells.map((shell) => (
							<ShellRow
								key={`${shell.connectionId}:${shell.channelId}`}
								shell={shell}
								onResume={() =>
									openTerminal(shell.connectionId, shell.channelId)
								}
							/>
						))}
					</View>
				)}
			</ScrollView>
		</View>
	);
}

function LiveBadge({
	shellCount,
	connected,
}: {
	shellCount: number;
	connected: boolean;
}) {
	const successColor = useCSSVariable('--color-success') as string;
	if (shellCount > 0) {
		return (
			<View className='flex-row items-center gap-1.5'>
				<View
					className='h-2 w-2 rounded-full bg-success'
					style={{ boxShadow: `0px 0px 8px ${successColor}` }}
				/>
				<ThemedText className='text-xs font-semibold text-success'>
					{shellCount} live
				</ThemedText>
			</View>
		);
	}
	if (connected) {
		return (
			<View className='flex-row items-center gap-1.5'>
				<View className='h-2 w-2 rounded-full bg-warning' />
				<ThemedText className='text-xs font-semibold text-warning'>idle</ThemedText>
			</View>
		);
	}
	return (
		<View className='flex-row items-center gap-1.5'>
			<View className='h-2 w-2 rounded-full bg-muted' />
			<ThemedText className='text-xs font-semibold text-muted'>offline</ThemedText>
		</View>
	);
}

function ShellRow({
	shell,
	onResume,
}: {
	shell: StoreShell;
	onResume: () => void;
}) {
	const skin = useThemeSkin();
	const cardStyle = useSurfaceStyle();
	const primaryColor = useCSSVariable('--color-primary') as string;
	const since = formatDistanceToNow(new Date(shell.createdAtMs), {
		addSuffix: true,
	});
	return (
		<Pressable
			onPress={onResume}
			className='flex-row items-center gap-3 px-4 py-3'
			style={cardStyle}
		>
			<FontAwesome6 name='terminal' size={15} color={primaryColor} />
			<View className='min-w-0 flex-1'>
				<ThemedText
					className='text-[14px] font-semibold text-text-primary'
					numberOfLines={1}
					style={skin.mono ? { fontFamily: skin.monoFamily } : undefined}
				>
					{shell.pty}
				</ThemedText>
				<ThemedText className='mt-0.5 text-xs text-muted'>Started {since}</ThemedText>
			</View>
			<ThemedText className='text-[13px] font-bold text-primary'>
				{applyCase(skin, 'Resume')} ›
			</ThemedText>
		</Pressable>
	);
}
