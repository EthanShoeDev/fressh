import { Ionicons } from '@expo/vector-icons';
import {
	type RnRussh,
	type SshConnection,
} from '@fressh/react-native-uniffi-russh';
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
	StyleSheet,
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
import { useTheme, type AppTheme } from '@/lib/theme';

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

	console.log('DEBUG connectionsQuery.data', !!connectionsQuery.data);

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
	const styles = React.useMemo(() => makeStyles(theme), [theme]);
	return (
		<View style={styles.centerContent}>
			<Text style={styles.mutedText}>Loading...</Text>
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

function LoadedState({
	connections,
}: {
	connections: ReturnType<typeof RnRussh.listSshConnectionsWithShells>;
}) {
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
	connectionsWithShells: ReturnType<
		typeof RnRussh.listSshConnectionsWithShells
	>;
	setActionTarget: (target: ActionTarget) => void;
}) {
	const flatShells = React.useMemo(() => {
		return connectionsWithShells.reduce<ShellWithConnection[]>((acc, curr) => {
			acc.push(...curr.shells.map((shell) => ({ ...shell, connection: curr })));
			return acc;
		}, []);
	}, [connectionsWithShells]);
	return (
		<FlashList
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
	connectionsWithShells: ReturnType<
		typeof RnRussh.listSshConnectionsWithShells
	>;
	setActionTarget: (target: ActionTarget) => void;
}) {
	const theme = useTheme();
	const styles = React.useMemo(() => makeStyles(theme), [theme]);
	const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
	return (
		<FlashList
			data={connectionsWithShells}
			// estimatedItemSize={80}
			keyExtractor={(item) => item.connectionId}
			renderItem={({ item }) => (
				<View style={styles.groupContainer}>
					<Pressable
						style={styles.groupHeader}
						onPress={() =>
							setExpanded((prev) => ({
								...prev,
								[item.connectionId]: !prev[item.connectionId],
							}))
						}
					>
						<View>
							<Text style={styles.groupTitle}>
								{item.connectionDetails.username}@{item.connectionDetails.host}
							</Text>
							<Text style={styles.groupSubtitle}>
								Port {item.connectionDetails.port} • {item.shells.length} shell
								{item.shells.length === 1 ? '' : 's'}
							</Text>
						</View>
						<Text style={styles.groupChevron}>
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
	const styles = React.useMemo(() => makeStyles(theme), [theme]);
	return (
		<View style={styles.centerContent}>
			<Text style={styles.mutedText}>
				No active shells. Connect from Host tab.
			</Text>
			<Link href="/" style={styles.link}>
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
	const styles = React.useMemo(() => makeStyles(theme), [theme]);
	const router = useRouter();
	const since = formatDistanceToNow(new Date(shell.createdAtMs), {
		addSuffix: true,
	});
	return (
		<Pressable
			style={styles.card}
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
				<Text style={styles.cardTitle} numberOfLines={1}>
					{shell.connection.connectionDetails.username}@
					{shell.connection.connectionDetails.host}
				</Text>
				<Text style={styles.cardSubtitle} numberOfLines={1}>
					Port {shell.connection.connectionDetails.port} • {shell.pty}
				</Text>
				<Text style={styles.cardMeta}>Started {since}</Text>
			</View>
			<Text style={styles.cardChevron}>›</Text>
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
	const styles = React.useMemo(() => makeStyles(theme), [theme]);
	const open = !!target;
	return (
		<Modal
			transparent
			visible={open}
			animationType="slide"
			onRequestClose={onClose}
		>
			<View style={styles.modalOverlay}>
				<View style={styles.modalSheet}>
					<Text style={styles.title}>Shell Actions</Text>
					<View style={{ height: 12 }} />
					<Pressable style={styles.primaryButton} onPress={onCloseShell}>
						<Text style={styles.primaryButtonText}>Close Shell</Text>
					</Pressable>
					<View style={{ height: 8 }} />
					<Pressable style={styles.secondaryButton} onPress={onDisconnect}>
						<Text style={styles.secondaryButtonText}>
							Disconnect Connection
						</Text>
					</Pressable>
					<View style={{ height: 8 }} />
					<Pressable style={styles.secondaryButton} onPress={onClose}>
						<Text style={styles.secondaryButtonText}>Cancel</Text>
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

function makeStyles(theme: AppTheme) {
	return StyleSheet.create({
		centerContent: {
			flex: 1,
			alignItems: 'center',
			justifyContent: 'center',
			gap: 12,
		},
		mutedText: { color: theme.colors.muted },
		link: { color: theme.colors.primary, fontWeight: '600' },

		// headerBar/title removed in favor of TopBarToggle

		groupContainer: {
			gap: 12,
		},
		groupHeader: {
			backgroundColor: theme.colors.surface,
			borderWidth: 1,
			borderColor: theme.colors.border,
			borderRadius: 12,
			paddingHorizontal: 12,
			paddingVertical: 12,
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
		},
		groupTitle: {
			color: theme.colors.textPrimary,
			fontSize: 16,
			fontWeight: '700',
		},
		groupSubtitle: {
			color: theme.colors.muted,
			fontSize: 12,
			marginTop: 2,
		},
		groupChevron: {
			color: theme.colors.muted,
			fontSize: 18,
		},

		card: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
			backgroundColor: theme.colors.inputBackground,
			borderWidth: 1,
			borderColor: theme.colors.border,
			borderRadius: 12,
			paddingHorizontal: 12,
			paddingVertical: 12,
		},
		cardTitle: {
			color: theme.colors.textPrimary,
			fontSize: 15,
			fontWeight: '600',
		},
		cardSubtitle: {
			color: theme.colors.textSecondary,
			fontSize: 12,
			marginTop: 2,
		},
		cardMeta: {
			color: theme.colors.muted,
			fontSize: 12,
			marginTop: 6,
		},
		cardChevron: {
			color: theme.colors.muted,
			fontSize: 22,
			paddingHorizontal: 4,
		},

		modalOverlay: {
			flex: 1,
			backgroundColor: theme.colors.overlay,
			justifyContent: 'flex-end',
		},
		modalSheet: {
			backgroundColor: theme.colors.background,
			borderTopLeftRadius: 16,
			borderTopRightRadius: 16,
			padding: 16,
			borderColor: theme.colors.borderStrong,
			borderWidth: 1,
		},
		title: {
			color: theme.colors.textPrimary,
			fontSize: 18,
			fontWeight: '700',
		},

		primaryButton: {
			backgroundColor: theme.colors.primary,
			borderRadius: 12,
			paddingVertical: 14,
			alignItems: 'center',
		},
		primaryButtonText: {
			color: theme.colors.buttonTextOnPrimary,
			fontWeight: '700',
			fontSize: 14,
			letterSpacing: 0.3,
		},
		secondaryButton: {
			backgroundColor: theme.colors.transparent,
			borderWidth: 1,
			borderColor: theme.colors.border,
			borderRadius: 12,
			paddingVertical: 14,
			alignItems: 'center',
		},
		secondaryButtonText: {
			color: theme.colors.textSecondary,
			fontWeight: '600',
			fontSize: 14,
			letterSpacing: 0.3,
		},
	});
}
