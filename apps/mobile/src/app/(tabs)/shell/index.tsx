import { Ionicons } from '@expo/vector-icons';
import { type SshConnection } from '@fressh/react-native-uniffi-russh';
import { FlashList } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { preferences } from '@/lib/preferences';
import {
	closeSshShellAndInvalidateQuery,
	disconnectSshConnectionAndInvalidateQuery,
	listSshShellsQueryOptions,
	type ShellWithConnection,
} from '@/lib/query-fns';
import { type listConnectionsWithShells as registryList } from '@/lib/ssh-registry';
import { useTheme } from '@/lib/theme';

export default function TabsShellList() {
	const theme = useTheme();
	return (
		<SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<ShellContent />
		</SafeAreaView>
	);
}

function ShellContent() {
	const connectionsQuery = useQuery(listSshShellsQueryOptions);

	return (
		<View style={{ flex: 1 }}>
			<Stack.Screen
				options={{
					headerRight: () => <HeaderViewModeButton />,
				}}
			/>
			{!connectionsQuery.data ? (
				<LoadingState />
			) : connectionsQuery.data.length === 0 ? (
				<EmptyState />
			) : (
				<LoadedState connections={connectionsQuery.data} />
			)}
		</View>
	);
}

function LoadingState() {
	const theme = useTheme();
	return (
		<View
			style={{
				flex: 1,
				alignItems: 'center',
				justifyContent: 'center',
				gap: 12,
			}}
		>
			<Text style={{ color: theme.colors.muted }}>Loading...</Text>
		</View>
	);
}

type ActionTarget =
	| {
			shell: ShellWithConnection;
	  }
	| {
			connection: SshConnection;
	  };

type ConnectionsList = ReturnType<typeof registryList>;

function LoadedState({ connections }: { connections: ConnectionsList }) {
	const [actionTarget, setActionTarget] = React.useState<null | ActionTarget>(
		null,
	);
	const queryClient = useQueryClient();
	const [shellListViewMode] =
		preferences.shellListViewMode.useShellListViewModePref();

	return (
		<View style={{ flex: 1 }}>
			{shellListViewMode === 'flat' ? (
				<FlatView
					connectionsWithShells={connections}
					setActionTarget={setActionTarget}
				/>
			) : (
				<GroupedView
					connectionsWithShells={connections}
					setActionTarget={setActionTarget}
				/>
			)}
			<ActionsSheet
				target={actionTarget}
				onClose={() => setActionTarget(null)}
				onCloseShell={() => {
					if (!actionTarget) return;
					if (!('shell' in actionTarget)) return;
					void closeSshShellAndInvalidateQuery({
						channelId: actionTarget.shell.channelId,
						connectionId: actionTarget.shell.connectionId,
						queryClient: queryClient,
					});
				}}
				onDisconnect={() => {
					if (!actionTarget) return;
					const connectionId =
						'connection' in actionTarget
							? actionTarget.connection.connectionId
							: actionTarget.shell.connectionId;
					void disconnectSshConnectionAndInvalidateQuery({
						connectionId: connectionId,
						queryClient: queryClient,
					});
				}}
			/>
		</View>
	);
}

function FlatView({
	connectionsWithShells,
	setActionTarget,
}: {
	connectionsWithShells: ConnectionsList;
	setActionTarget: (target: ActionTarget) => void;
}) {
	const flatShells = React.useMemo(() => {
		return connectionsWithShells.reduce<ShellWithConnection[]>((acc, curr) => {
			acc.push(...curr.shells.map((shell) => ({ ...shell, connection: curr })));
			return acc;
		}, []);
	}, [connectionsWithShells]);
	return (
		<FlashList<ShellWithConnection>
			data={flatShells}
			keyExtractor={(item) => `${item.connectionId}:${item.channelId}`}
			renderItem={({ item }) => (
				<ShellCard
					shell={item}
					onLongPress={() =>
						setActionTarget({
							shell: item,
						})
					}
				/>
			)}
			ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
			contentContainerStyle={{
				paddingVertical: 16,
				paddingHorizontal: 16,
			}}
			style={{ flex: 1 }}
		/>
	);
}

function GroupedView({
	connectionsWithShells,
	setActionTarget,
}: {
	connectionsWithShells: ConnectionsList;
	setActionTarget: (target: ActionTarget) => void;
}) {
	const theme = useTheme();
	const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
	return (
		<FlashList<ConnectionsList[number]>
			data={connectionsWithShells}
			// estimatedItemSize={80}
			keyExtractor={(item) => item.connectionId}
			renderItem={({ item }) => (
				<View style={{ gap: 12 }}>
					<Pressable
						style={{
							backgroundColor: theme.colors.surface,
							borderWidth: 1,
							borderColor: theme.colors.border,
							borderRadius: 12,
							paddingHorizontal: 12,
							paddingVertical: 12,
							flexDirection: 'row',
							alignItems: 'center',
							justifyContent: 'space-between',
						}}
						onPress={() =>
							setExpanded((prev) => ({
								...prev,
								[item.connectionId]: !prev[item.connectionId],
							}))
						}
					>
						<View>
							<Text
								style={{
									color: theme.colors.textPrimary,
									fontSize: 16,
									fontWeight: '700',
								}}
							>
								{item.connectionDetails.username}@{item.connectionDetails.host}
							</Text>
							<Text
								style={{
									color: theme.colors.muted,
									fontSize: 12,
									marginTop: 2,
								}}
							>
								Port {item.connectionDetails.port} • {item.shells.length} shell
								{item.shells.length === 1 ? '' : 's'}
							</Text>
						</View>
						<Text style={{ color: theme.colors.muted, fontSize: 18 }}>
							{expanded[item.connectionId] ? '▾' : '▸'}
						</Text>
					</Pressable>
					{expanded[item.connectionId] && (
						<View style={{ gap: 12 }}>
							{item.shells.map((sh) => {
								const shellWithConnection = { ...sh, connection: item };
								return (
									<ShellCard
										key={`${sh.connectionId}:${sh.channelId}`}
										shell={shellWithConnection}
										onLongPress={() =>
											setActionTarget({
												shell: shellWithConnection,
											})
										}
									/>
								);
							})}
						</View>
					)}
				</View>
			)}
			ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
			contentContainerStyle={{ paddingVertical: 16, paddingHorizontal: 16 }}
			style={{ flex: 1 }}
		/>
	);
}

function EmptyState() {
	const theme = useTheme();
	return (
		<View
			style={{
				flex: 1,
				alignItems: 'center',
				justifyContent: 'center',
				gap: 12,
			}}
		>
			<Text style={{ color: theme.colors.muted }}>
				No active shells. Connect from Host tab.
			</Text>
			<Link href="/" style={{ color: theme.colors.primary, fontWeight: '600' }}>
				Go to Hosts
			</Link>
		</View>
	);
}

function ShellCard({
	shell,
	onLongPress,
}: {
	shell: ShellWithConnection;
	onLongPress?: () => void;
}) {
	const theme = useTheme();
	const router = useRouter();
	const since = formatDistanceToNow(new Date(shell.createdAtMs), {
		addSuffix: true,
	});
	return (
		<Pressable
			style={{
				flexDirection: 'row',
				alignItems: 'center',
				justifyContent: 'space-between',
				backgroundColor: theme.colors.inputBackground,
				borderWidth: 1,
				borderColor: theme.colors.border,
				borderRadius: 12,
				paddingHorizontal: 12,
				paddingVertical: 12,
			}}
			onPress={() =>
				router.push({
					pathname: '/shell/detail',
					params: {
						connectionId: String(shell.connectionId),
						channelId: String(shell.channelId),
					},
				})
			}
			onLongPress={onLongPress}
		>
			<View style={{ flex: 1 }}>
				<Text
					style={{
						color: theme.colors.textPrimary,
						fontSize: 15,
						fontWeight: '600',
					}}
					numberOfLines={1}
				>
					{shell.connection.connectionDetails.username}@
					{shell.connection.connectionDetails.host}
				</Text>
				<Text
					style={{
						color: theme.colors.textSecondary,
						fontSize: 12,
						marginTop: 2,
					}}
					numberOfLines={1}
				>
					Port {shell.connection.connectionDetails.port} • {shell.pty}
				</Text>
				<Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 6 }}>
					Started {since}
				</Text>
			</View>
			<Text
				style={{
					color: theme.colors.muted,
					fontSize: 22,
					paddingHorizontal: 4,
				}}
			>
				›
			</Text>
		</Pressable>
	);
}

function ActionsSheet({
	target,
	onClose,
	onCloseShell,
	onDisconnect,
}: {
	target: null | ActionTarget;
	onClose: () => void;
	onCloseShell: () => void;
	onDisconnect: () => void;
}) {
	const theme = useTheme();
	const open = !!target;
	return (
		<Modal
			transparent
			visible={open}
			animationType="slide"
			onRequestClose={onClose}
		>
			<View
				style={{
					flex: 1,
					backgroundColor: theme.colors.overlay,
					justifyContent: 'flex-end',
				}}
			>
				<View
					style={{
						backgroundColor: theme.colors.background,
						borderTopLeftRadius: 16,
						borderTopRightRadius: 16,
						padding: 16,
						borderColor: theme.colors.borderStrong,
						borderWidth: 1,
					}}
				>
					<Text
						style={{
							color: theme.colors.textPrimary,
							fontSize: 18,
							fontWeight: '700',
						}}
					>
						Shell Actions
					</Text>
					<View style={{ height: 12 }} />
					<Pressable
						style={{
							backgroundColor: theme.colors.primary,
							borderRadius: 12,
							paddingVertical: 14,
							alignItems: 'center',
						}}
						onPress={onCloseShell}
					>
						<Text
							style={{
								color: theme.colors.buttonTextOnPrimary,
								fontWeight: '700',
								fontSize: 14,
								letterSpacing: 0.3,
							}}
						>
							Close Shell
						</Text>
					</Pressable>
					<View style={{ height: 8 }} />
					<Pressable
						style={{
							backgroundColor: theme.colors.transparent,
							borderWidth: 1,
							borderColor: theme.colors.border,
							borderRadius: 12,
							paddingVertical: 14,
							alignItems: 'center',
						}}
						onPress={onDisconnect}
					>
						<Text
							style={{
								color: theme.colors.textSecondary,
								fontWeight: '600',
								fontSize: 14,
								letterSpacing: 0.3,
							}}
						>
							Disconnect Connection
						</Text>
					</Pressable>
					<View style={{ height: 8 }} />
					<Pressable
						style={{
							backgroundColor: theme.colors.transparent,
							borderWidth: 1,
							borderColor: theme.colors.border,
							borderRadius: 12,
							paddingVertical: 14,
							alignItems: 'center',
						}}
						onPress={onClose}
					>
						<Text
							style={{
								color: theme.colors.textSecondary,
								fontWeight: '600',
								fontSize: 14,
								letterSpacing: 0.3,
							}}
						>
							Cancel
						</Text>
					</Pressable>
				</View>
			</View>
		</Modal>
	);
}

function HeaderViewModeButton() {
	const theme = useTheme();
	const [shellListViewMode, setShellListViewMode] =
		preferences.shellListViewMode.useShellListViewModePref();

	const icon = shellListViewMode === 'flat' ? 'list' : 'git-branch';
	const accessibilityLabel =
		shellListViewMode === 'flat'
			? 'Switch to grouped view'
			: 'Switch to flat list view';

	const handleToggle = React.useCallback(() => {
		const nextMode = shellListViewMode === 'flat' ? 'grouped' : 'flat';
		setShellListViewMode(nextMode);
	}, [setShellListViewMode, shellListViewMode]);

	const handleLongPress = React.useCallback(() => {
		if (Platform.OS !== 'ios') return;
		ActionSheetIOS.showActionSheetWithOptions(
			{
				title: 'View Mode',
				options: ['Flat list', 'Grouped by connection', 'Cancel'],
				cancelButtonIndex: 2,
			},
			(buttonIndex) => {
				if (buttonIndex === 0) setShellListViewMode('flat');
				if (buttonIndex === 1) setShellListViewMode('grouped');
			},
		);
	}, [setShellListViewMode]);

	return (
		<Pressable
			onPress={handleToggle}
			onLongPress={handleLongPress}
			hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel}
			style={({ pressed }) => ({
				opacity: pressed ? 0.4 : 1,
			})}
		>
			<Ionicons name={icon} size={22} color={theme.colors.textPrimary} />
		</Pressable>
	);
}
