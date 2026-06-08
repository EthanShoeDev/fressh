import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { FontAwesome6 } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { Button } from '@/components/themed/Button';
import { ScreenHeader } from '@/components/themed/ScreenHeader';
import {
	ThemedScreen,
	useSurfaceStyle,
} from '@/components/themed/ThemedScreen';
import { ThemedText } from '@/components/themed/ThemedText';
import { RenameDialog } from '@/components/RenameDialog';
import { Section, ToggleRow } from '@/components/settings-controls';
import { rootLogger } from '@/lib/logger';
import { preferences } from '@/lib/preferences';
import { useSshConnMutation } from '@/lib/query-fns';
import { secretsManager } from '@/lib/secrets-manager';
import { useConnectionShells, useLiveConnection } from '@/lib/server-status';
import { useSshStore, type StoreShell } from '@/lib/ssh-store';
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

	// This host's stored shell-integration choice (absent ⇒ inherit default on),
	// with an optimistic override so the toggle flips instantly before the keychain
	// write + reactivity round-trip settles.
	const storedShellIntegration = entry?.metadata.shellIntegration ?? true;
	const [siOverride, setSiOverride] = React.useState<boolean | null>(null);
	const shellIntegration = siOverride ?? storedShellIntegration;

	const setShellIntegrationMeta = useAtomSet(
		secretsManager.connections.atoms.updateMetadata(id),
		{ mode: 'promise' },
	);
	const onToggleShellIntegration = React.useCallback(
		(next: boolean) => {
			setSiOverride(next);
			void setShellIntegrationMeta({ shellIntegration: next }).catch(
				(error: unknown) => {
					logger.warn('Failed to save shell-integration preference', error);
					setSiOverride(null); // revert the optimistic flip
				},
			);
		},
		[setShellIntegrationMeta],
	);

	const onNewShell = React.useCallback(async () => {
		if (busy || !details) {
			return;
		}
		setBusy(true);
		try {
			if (live) {
				// New shell on an already-live connection calls the store directly, so
				// it gets the EFFECTIVE value (global kill-switch ∧ this host's choice).
				const effective =
					preferences.shellIntegrationEnabled.get() && shellIntegration;
				const shell = await live.startShell({ shellIntegration: effective });
				openTerminal(live.connectionId, shell.channelId);
			} else {
				// Reconnect goes through the mutation, which ANDs the global setting in
				// itself — pass the per-host CHOICE.
				const success = await sshConnMutation.mutateAsync(details, {
					shellIntegration,
				});
				openTerminal(success.connectionId, success.channelId);
			}
		} catch (error) {
			logger.warn('Failed to start shell', error);
		} finally {
			setBusy(false);
		}
	}, [busy, details, live, openTerminal, sshConnMutation, shellIntegration]);

	const monoFamily = skin.mono ? skin.monoFamily : undefined;

	if (AsyncResult.isFailure(detailsResult)) {
		return (
			<View className='flex-1 items-center justify-center'>
				<ThemedText className='text-danger'>
					Couldn’t load this server.
				</ThemedText>
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

				{/* Per-host settings */}
				<View className='mt-6'>
					<Section title='Smart terminal'>
						<ToggleRow
							label='Shell integration'
							value={shellIntegration}
							onChange={onToggleShellIntegration}
						/>
						<ThemedText className='mt-1.5 px-1 text-xs text-muted'>
							Track folder, command status & timing for this host. Set up
							automatically on connect — nothing changed on your server.
						</ThemedText>
					</Section>
				</View>

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
				<ThemedText className='text-xs font-semibold text-warning'>
					idle
				</ThemedText>
			</View>
		);
	}
	return (
		<View className='flex-row items-center gap-1.5'>
			<View className='h-2 w-2 rounded-full bg-muted' />
			<ThemedText className='text-xs font-semibold text-muted'>
				offline
			</ThemedText>
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
	const renameShell = useSshStore((s) => s.renameShell);
	const [renaming, setRenaming] = React.useState(false);
	const since = formatDistanceToNow(new Date(shell.createdAtMs), {
		addSuffix: true,
	});
	// `label` is stored as undefined when cleared (never ''), so ?? is safe.
	const name = shell.label ?? shell.pty;
	return (
		<>
			<Pressable
				onPress={onResume}
				onLongPress={() => setRenaming(true)}
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
						{name}
					</ThemedText>
					<ThemedText className='mt-0.5 text-xs text-muted'>
						Started {since}
					</ThemedText>
				</View>
				<ThemedText className='text-[13px] font-bold text-primary'>
					{applyCase(skin, 'Resume')} ›
				</ThemedText>
			</Pressable>

			{renaming ? (
				<RenameDialog
					title='Rename session'
					description='A local name for this shell — only shown in fressh.'
					initial={shell.label ?? ''}
					placeholder={shell.pty}
					onClose={() => setRenaming(false)}
					onSave={(next) => {
						renameShell(shell.shellId, next);
						setRenaming(false);
					}}
				/>
			) : null}
		</>
	);
}
