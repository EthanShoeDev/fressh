import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
	type SshShell,
	type SshConnection,
} from '@fressh/react-native-uniffi-russh';
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
	type StyleProp,
	type TextStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { rootLogger } from '@/lib/logger';
import { preferences } from '@/lib/preferences';
import {} from '@/lib/query-fns';
import { useSshStore } from '@/lib/ssh-store';
import { useTheme } from '@/lib/theme';
import { AbortSignalTimeout } from '@/lib/utils';

const logger = rootLogger.extend('TabsShellList');

export default function TabsShellList() {
	const theme = useTheme();
	return (
		<SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
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
		<View style={{ flex: 1 }}>
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
			shell: SshShell;
	  }
	| {
			connection: SshConnection;
	  };

function LoadedState() {
	const [actionTarget, setActionTarget] = React.useState<null | ActionTarget>(
		null,
	);
	const [shellListViewMode] =
		preferences.shellListViewMode.useShellListViewModePref();

	const router = useRouter();

	return (
		<View style={{ flex: 1 }}>
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
					if (!actionTarget) return;
					if (!('shell' in actionTarget)) return;
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
					if (!actionTarget) return;
					if (!('connection' in actionTarget)) return;
					void actionTarget.connection.disconnect();
					setActionTarget(null);
				}}
				onStartShell={() => {
					if (!actionTarget) return;
					if (!('connection' in actionTarget)) return;
					void actionTarget.connection
						.startShell({
							term: 'Xterm',
							abortSignal: AbortSignalTimeout(5_000),
						})
						.then((shellHandle) => {
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
		<FlashList<SshShell>
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
	setActionTarget,
}: {
	setActionTarget: (target: ActionTarget) => void;
}) {
	const theme = useTheme();
	const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
	const connections = useSshStore(
		useShallow((s) => Object.values(s.connections)),
	);
	const shells = useSshStore(useShallow((s) => Object.values(s.shells)));
	return (
		<FlashList<SshConnection>
			data={connections}
			// estimatedItemSize={80}
			keyExtractor={(item) => item.connectionId}
			renderItem={({ item }) => {
				const connectionShells = shells.filter(
					(s) => s.connectionId === item.connectionId,
				);
				return (
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
								<Text
									style={{
										color: theme.colors.textPrimary,
										fontSize: 16,
										fontWeight: '700',
									}}
								>
									{item.connectionDetails.username}@
									{item.connectionDetails.host}
								</Text>
								<Text
									style={{
										color: theme.colors.muted,
										fontSize: 12,
										marginTop: 2,
									}}
								>
									Port {item.connectionDetails.port} • {connectionShells.length}{' '}
									shell
									{connectionShells.length === 1 ? '' : 's'}
								</Text>
							</View>
							<Text style={{ color: theme.colors.muted, fontSize: 18 }}>
								{expanded[item.connectionId] ? '▾' : '▸'}
							</Text>
						</Pressable>
						{expanded[item.connectionId] && (
							<View style={{ gap: 12 }}>
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
	shell: SshShell;
	onLongPress?: () => void;
}) {
	const theme = useTheme();
	const router = useRouter();
	const since = formatDistanceToNow(new Date(shell.createdAtMs), {
		addSuffix: true,
	});
	const connection = useSshStore((s) => s.connections[shell.connectionId]);
	if (!connection) return null;
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
			<View style={{ flex: 1 }}>
				<Text
					style={{
						color: theme.colors.textPrimary,
						fontSize: 15,
						fontWeight: '600',
					}}
					numberOfLines={1}
				>
					{connection.connectionDetails.username}@
					{connection.connectionDetails.host}
				</Text>
				<Text
					style={{
						color: theme.colors.textSecondary,
						fontSize: 12,
						marginTop: 2,
					}}
					numberOfLines={1}
				>
					Port {connection.connectionDetails.port} • {shell.pty}
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

function ShellActionsSheet({
	target,
	onClose,
	onCloseShell,
}: {
	target: null | {
		shell: SshShell;
	};
	onClose: () => void;
	onCloseShell: () => void;
}) {
	const open = !!target;

	return (
		<ActionSheetModal
			title="Shell Actions"
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
		connection: SshConnection;
	};
	onClose: () => void;
	onDisconnect: () => void;
	onStartShell: () => void;
}) {
	const open = !!target;

	return (
		<ActionSheetModal
			title="Connection Actions"
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

type ActionSheetAction = {
	label: string;
	onPress: () => void;
	variant?: ActionSheetButtonVariant;
};

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
	const theme = useTheme();

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
						{title}
					</Text>
					<View style={{ height: 12 }} />
					{actions.map((action, index) => (
						<React.Fragment key={`${action.label}-${index.toString()}`}>
							<ActionSheetButton {...action} />
							{index < actions.length - 1 ? (
								<View style={{ height: 8 }} />
							) : null}
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
	const theme = useTheme();
	const baseButtonStyle = {
		borderRadius: 12,
		paddingVertical: 14,
		alignItems: 'center',
	} as const;

	const pressableStyle =
		variant === 'outline'
			? [
					baseButtonStyle,
					{
						backgroundColor: theme.colors.transparent,
						borderWidth: 1,
						borderColor: theme.colors.border,
					},
				]
			: [baseButtonStyle, { backgroundColor: theme.colors.primary }];

	const textStyle: StyleProp<TextStyle> =
		variant === 'outline'
			? {
					color: theme.colors.textSecondary,
					fontWeight: '600',
					fontSize: 14,
					letterSpacing: 0.3,
				}
			: {
					color: theme.colors.buttonTextOnPrimary,
					fontWeight: '700',
					fontSize: 14,
					letterSpacing: 0.3,
				};

	return (
		<Pressable style={pressableStyle} onPress={onPress}>
			<Text style={textStyle}>{label}</Text>
		</Pressable>
	);
}

function HeaderViewModeButton() {
	const theme = useTheme();
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
			{shellListViewMode === 'grouped' ? (
				<MaterialCommunityIcons
					name="file-tree-outline"
					size={22}
					color={theme.colors.textPrimary}
				/>
			) : (
				<Ionicons
					name="list-outline"
					size={22}
					color={theme.colors.textPrimary}
				/>
			)}
		</Pressable>
	);
}
