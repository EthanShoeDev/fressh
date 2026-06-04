import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { formatDistanceToNow } from 'date-fns';
import { Link, Stack, useRouter } from 'expo-router';
import React from 'react';
import {
	ActionSheetIOS,
	Modal,
	Platform,
	Pressable,
	Text,
	View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { useShallow } from 'zustand/react/shallow';
import { rootLogger } from '@/lib/logger';
import { preferences } from '@/lib/preferences';

import {
	useSshStore,
	type StoreConnection,
	type StoreShell,
} from '@/lib/ssh-store';

const logger = rootLogger.extend('TabsShellList');

export default function TabsShellList() {
	const background = useCSSVariable('--color-background') as string;
	return (
		<SafeAreaView style={{ flex: 1, backgroundColor: background }}>
			<ShellContent />
		</SafeAreaView>
	);
}

function ShellContent() {
	const connections = useSshStore(
		useShallow((s) => Object.values(s.connections)),
	);
	logger.debug('list view connections', connections.length);

	return (
		<View className='flex-1'>
			<Stack.Screen
				options={{
					headerRight: () => <HeaderViewModeButton />,
				}}
			/>
			{connections.length === 0 ? <EmptyState /> : <LoadedState />}
		</View>
	);
}

type ActionTarget =
	| {
			shell: StoreShell;
	  }
	| {
			connection: StoreConnection;
	  };

function LoadedState() {
	const [actionTarget, setActionTarget] = React.useState<null | ActionTarget>(
		null,
	);
	const [shellListViewMode] =
		preferences.shellListViewMode.useShellListViewModePref();

	const router = useRouter();

	return (
		<View className='flex-1'>
			{shellListViewMode === 'flat' ? (
				<FlatView setActionTarget={setActionTarget} />
			) : (
				<GroupedView setActionTarget={setActionTarget} />
			)}
			<ShellActionsSheet
				target={actionTarget && 'shell' in actionTarget ? actionTarget : null}
				onClose={() => {
					setActionTarget(null);
				}}
				onCloseShell={() => {
					if (!actionTarget) {
						return;
					}
					if (!('shell' in actionTarget)) {
						return;
					}
					void actionTarget.shell.close();
					setActionTarget(null);
				}}
			/>
			<ConnectionActionsSheet
				target={
					actionTarget && 'connection' in actionTarget ? actionTarget : null
				}
				onClose={() => {
					setActionTarget(null);
				}}
				onDisconnect={() => {
					if (!actionTarget) {
						return;
					}
					if (!('connection' in actionTarget)) {
						return;
					}
					void actionTarget.connection.disconnect();
					setActionTarget(null);
				}}
				onStartShell={() => {
					if (!actionTarget) {
						return;
					}
					if (!('connection' in actionTarget)) {
						return;
					}
					void actionTarget.connection.startShell().then((shellHandle) => {
						router.push({
							pathname: '/shell/detail',
							params: {
								connectionId: actionTarget.connection.connectionId,
								channelId: shellHandle.channelId,
							},
						});
					});
					setActionTarget(null);
				}}
			/>
		</View>
	);
}

function FlatView({
	setActionTarget,
}: {
	setActionTarget: (target: ActionTarget) => void;
}) {
	const shells = useSshStore(useShallow((s) => Object.values(s.shells)));

	return (
		<FlashList<StoreShell>
			data={shells}
			keyExtractor={(item) => `${item.connectionId}:${item.channelId}`}
			renderItem={({ item }) => (
				<ShellCard
					shell={item}
					onLongPress={() => {
						setActionTarget({
							shell: item,
						});
					}}
				/>
			)}
			ItemSeparatorComponent={() => <View className='h-3' />}
			contentContainerStyle={{
				paddingVertical: 16,
				paddingHorizontal: 16,
			}}
			style={{ flex: 1 }}
		/>
	);
}

function GroupedView({
	setActionTarget,
}: {
	setActionTarget: (target: ActionTarget) => void;
}) {
	const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
	const connections = useSshStore(
		useShallow((s) => Object.values(s.connections)),
	);
	const shells = useSshStore(useShallow((s) => Object.values(s.shells)));
	return (
		<FlashList<StoreConnection>
			data={connections}
			// estimatedItemSize={80}
			keyExtractor={(item) => item.connectionId}
			renderItem={({ item }) => {
				const connectionShells = shells.filter(
					(s) => s.connectionId === item.connectionId,
				);
				return (
					<View className='gap-3'>
						<Pressable
							className='flex-row items-center justify-between rounded-xl border border-border bg-surface px-3 py-3'
							onPress={() => {
								setExpanded((prev) => ({
									...prev,
									[item.connectionId]: !prev[item.connectionId],
								}));
							}}
							onLongPress={() => {
								setActionTarget({
									connection: item,
								});
							}}
						>
							<View>
								<Text className='text-base font-bold text-text-primary'>
									{item.connectionDetails.username}@
									{item.connectionDetails.host}
								</Text>
								<Text className='mt-0.5 text-xs text-muted'>
									Port {item.connectionDetails.port} • {connectionShells.length}{' '}
									shell
									{connectionShells.length === 1 ? '' : 's'}
								</Text>
							</View>
							<Text className='text-lg text-muted'>
								{expanded[item.connectionId] ? '▾' : '▸'}
							</Text>
						</Pressable>
						{expanded[item.connectionId] && (
							<View className='gap-3'>
								{connectionShells.map((sh) => {
									const shellWithConnection = { ...sh, connection: item };
									return (
										<ShellCard
											key={`${sh.connectionId}:${sh.channelId}`}
											shell={shellWithConnection}
											onLongPress={() => {
												setActionTarget({
													shell: shellWithConnection,
												});
											}}
										/>
									);
								})}
							</View>
						)}
					</View>
				);
			}}
			ItemSeparatorComponent={() => <View className='h-4' />}
			contentContainerStyle={{ paddingVertical: 16, paddingHorizontal: 16 }}
			style={{ flex: 1 }}
		/>
	);
}

function EmptyState() {
	return (
		<View className='flex-1 items-center justify-center gap-3'>
			<Text className='text-muted'>
				No active shells. Connect from Host tab.
			</Text>
			<Link href='/' className='font-semibold text-primary'>
				Go to Hosts
			</Link>
		</View>
	);
}

function ShellCard({
	shell,
	onLongPress,
}: {
	shell: StoreShell;
	onLongPress?: () => void;
}) {
	const router = useRouter();
	const since = formatDistanceToNow(new Date(shell.createdAtMs), {
		addSuffix: true,
	});
	const connection = useSshStore((s) => s.connections[shell.connectionId]);
	if (!connection) {
		return null;
	}
	return (
		<Pressable
			className='flex-row items-center justify-between rounded-xl border border-border bg-input-background px-3 py-3'
			onPress={() => {
				router.push({
					pathname: '/shell/detail',
					params: {
						connectionId: shell.connectionId,
						channelId: String(shell.channelId),
					},
				});
			}}
			onLongPress={onLongPress}
		>
			<View className='flex-1'>
				<Text
					className='text-[15px] font-semibold text-text-primary'
					numberOfLines={1}
				>
					{connection.connectionDetails.username}@
					{connection.connectionDetails.host}
				</Text>
				<Text className='mt-0.5 text-xs text-text-secondary' numberOfLines={1}>
					Port {connection.connectionDetails.port} • {shell.pty}
				</Text>
				<Text className='mt-1.5 text-xs text-muted'>Started {since}</Text>
			</View>
			<Text className='px-1 text-[22px] text-muted'>›</Text>
		</Pressable>
	);
}

function ShellActionsSheet({
	target,
	onClose,
	onCloseShell,
}: {
	target: null | {
		shell: StoreShell;
	};
	onClose: () => void;
	onCloseShell: () => void;
}) {
	const open = !!target;

	return (
		<ActionSheetModal
			title='Shell Actions'
			actions={[
				{ label: 'Close Shell', onPress: onCloseShell },
				{ label: 'Cancel', onPress: onClose, variant: 'outline' },
			]}
			onClose={onClose}
			open={open}
		/>
	);
}

function ConnectionActionsSheet({
	target,
	onClose,
	onDisconnect,
	onStartShell,
}: {
	target: null | {
		connection: StoreConnection;
	};
	onClose: () => void;
	onDisconnect: () => void;
	onStartShell: () => void;
}) {
	const open = !!target;

	return (
		<ActionSheetModal
			title='Connection Actions'
			actions={[
				{ label: 'Disconnect', onPress: onDisconnect },
				{ label: 'Start Shell', onPress: onStartShell },
				{ label: 'Cancel', onPress: onClose, variant: 'outline' },
			]}
			onClose={onClose}
			open={open}
			extraFooterSpacing={8}
		/>
	);
}

type ActionSheetButtonVariant = 'primary' | 'outline';

interface ActionSheetAction {
	label: string;
	onPress: () => void;
	variant?: ActionSheetButtonVariant;
}

function ActionSheetModal({
	open,
	title,
	onClose,
	actions,
	extraFooterSpacing = 0,
}: {
	open: boolean;
	title: string;
	onClose: () => void;
	actions: ActionSheetAction[];
	extraFooterSpacing?: number;
}) {
	return (
		<Modal
			transparent
			visible={open}
			animationType='slide'
			onRequestClose={onClose}
		>
			<View className='flex-1 justify-end bg-overlay'>
				<View className='rounded-t-2xl border border-border-strong bg-background p-4'>
					<Text className='text-lg font-bold text-text-primary'>{title}</Text>
					<View className='h-3' />
					{actions.map((action, index) => (
						<React.Fragment key={`${action.label}-${index.toString()}`}>
							<ActionSheetButton {...action} />
							{index < actions.length - 1 ? <View className='h-2' /> : null}
						</React.Fragment>
					))}
					{extraFooterSpacing > 0 ? (
						<View style={{ height: extraFooterSpacing }} />
					) : null}
				</View>
			</View>
		</Modal>
	);
}

function ActionSheetButton({
	label,
	onPress,
	variant = 'primary',
}: ActionSheetAction) {
	const pressableClassName =
		variant === 'outline'
			? 'items-center rounded-xl border border-border bg-transparent py-3.5'
			: 'items-center rounded-xl bg-primary py-3.5';

	const textClassName =
		variant === 'outline'
			? 'text-sm font-semibold tracking-[0.3px] text-text-secondary'
			: 'text-sm font-bold tracking-[0.3px] text-button-text-on-primary';

	return (
		<Pressable className={pressableClassName} onPress={onPress}>
			<Text className={textClassName}>{label}</Text>
		</Pressable>
	);
}

function HeaderViewModeButton() {
	const textPrimary = useCSSVariable('--color-text-primary') as string;
	const [shellListViewMode, setShellListViewMode] =
		preferences.shellListViewMode.useShellListViewModePref();

	const accessibilityLabel =
		shellListViewMode === 'flat'
			? 'Switch to grouped view'
			: 'Switch to flat list view';

	const handleToggle = React.useCallback(() => {
		const nextMode = shellListViewMode === 'flat' ? 'grouped' : 'flat';
		setShellListViewMode(nextMode);
	}, [setShellListViewMode, shellListViewMode]);

	const handleLongPress = React.useCallback(() => {
		if (Platform.OS !== 'ios') {
			return;
		}
		ActionSheetIOS.showActionSheetWithOptions(
			{
				title: 'View Mode',
				options: ['Flat list', 'Grouped by connection', 'Cancel'],
				cancelButtonIndex: 2,
			},
			(buttonIndex) => {
				if (buttonIndex === 0) {
					setShellListViewMode('flat');
				}
				if (buttonIndex === 1) {
					setShellListViewMode('grouped');
				}
			},
		);
	}, [setShellListViewMode]);

	return (
		<Pressable
			onPress={handleToggle}
			onLongPress={handleLongPress}
			hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
			accessibilityRole='button'
			accessibilityLabel={accessibilityLabel}
			style={({ pressed }) => ({
				opacity: pressed ? 0.4 : 1,
			})}
		>
			{shellListViewMode === 'grouped' ? (
				<MaterialCommunityIcons
					name='file-tree-outline'
					size={22}
					color={textPrimary}
				/>
			) : (
				<Ionicons name='list-outline' size={22} color={textPrimary} />
			)}
		</Pressable>
	);
}
