import { Ionicons } from '@expo/vector-icons';
import {
	RnRussh,
	type SshConnection,
	type SshShellSession,
} from '@fressh/react-native-uniffi-russh';
import { FlashList } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Link, Stack, useRouter } from 'expo-router';
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listSshShellsQueryOptions } from '@/lib/query-fns';
import { useTheme, type AppTheme } from '@/lib/theme';

export default function TabsShellList() {
	const theme = useTheme();
	return (
		<SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<ShellContent />
		</SafeAreaView>
	);
}

type ShellWithConnection = SshShellSession & { connection: SshConnection };

function ShellContent() {
	const [viewIndex, setViewIndex] = React.useState(0);
	const connectionsWithShells = useQuery(listSshShellsQueryOptions);

	return (
		<View style={{ flex: 1 }}>
			<Stack.Screen
				options={{
					headerRight: () => (
						<TopBarToggle viewIndex={viewIndex} onChange={setViewIndex} />
					),
				}}
			/>
			{connectionsWithShells.isLoading || !connectionsWithShells.data ? (
				<LoadingState />
			) : (
				<LoadedState
					connectionsWithShells={connectionsWithShells.data}
					viewIndex={viewIndex}
				/>
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

function LoadedState({
	connectionsWithShells,
	viewIndex,
}: {
	connectionsWithShells: ReturnType<
		typeof RnRussh.listSshConnectionsWithShells
	>;
	viewIndex: number;
}) {
	const theme = useTheme();
	const styles = React.useMemo(() => makeStyles(theme), [theme]);
	const [actionTarget, setActionTarget] = React.useState<null | {
		connectionId: string;
		channelId: number;
	}>(null);
	const queryClient = useQueryClient();

	const flatShells = React.useMemo(() => {
		return connectionsWithShells.reduce<ShellWithConnection[]>((acc, curr) => {
			acc.push(...curr.shells.map((shell) => ({ ...shell, connection: curr })));
			return acc;
		}, []);
	}, [connectionsWithShells]);

	const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
	React.useEffect(() => {
		const init: Record<string, boolean> = {};
		for (const c of connectionsWithShells) init[c.connectionId] = true;
		setExpanded(init);
	}, [connectionsWithShells]);

	async function handleCloseShell(connId: string, channelId: number) {
		try {
			const shell = RnRussh.getSshShell(connId, channelId);
			await (shell as any)?.close?.();
		} catch {}
		await queryClient.invalidateQueries({
			queryKey: listSshShellsQueryOptions.queryKey,
		});
		setActionTarget(null);
	}

	async function handleDisconnect(connId: string) {
		try {
			const conn = RnRussh.getSshConnection(connId);
			await conn?.disconnect();
		} catch {}
		await queryClient.invalidateQueries({
			queryKey: listSshShellsQueryOptions.queryKey,
		});
		setActionTarget(null);
	}

	if (viewIndex === 0) {
		return (
			<View style={{ flex: 1 }}>
				{flatShells.length === 0 ? (
					<EmptyState />
				) : (
					<FlashList
						data={flatShells}
						keyExtractor={(item) => `${item.connectionId}:${item.channelId}`}
						renderItem={({ item }) => (
							<ShellCard
								shell={item}
								onLongPress={() =>
									setActionTarget({
										connectionId: item.connectionId as string,
										channelId: item.channelId as number,
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
				)}
				<ActionsSheet
					target={actionTarget}
					onClose={() => setActionTarget(null)}
					onCloseShell={() =>
						actionTarget &&
						handleCloseShell(actionTarget.connectionId, actionTarget.channelId)
					}
					onDisconnect={() =>
						actionTarget && handleDisconnect(actionTarget.connectionId)
					}
				/>
			</View>
		);
	}

	return (
		<View style={{ flex: 1 }}>
			{connectionsWithShells.length === 0 ? (
				<EmptyState />
			) : (
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
										{item.connectionDetails.username}@
										{item.connectionDetails.host}
									</Text>
									<Text style={styles.groupSubtitle}>
										Port {item.connectionDetails.port} • {item.shells.length}{' '}
										shell{item.shells.length === 1 ? '' : 's'}
									</Text>
								</View>
								<Text style={styles.groupChevron}>
									{expanded[item.connectionId] ? '▾' : '▸'}
								</Text>
							</Pressable>
							{expanded[item.connectionId] && (
								<View style={{ gap: 12 }}>
									{item.shells.map((sh) => (
										<ShellCard
											key={`${sh.connectionId}:${sh.channelId}`}
											shell={{ ...sh, connection: item }}
											onLongPress={() =>
												setActionTarget({
													connectionId: sh.connectionId as string,
													channelId: sh.channelId as number,
												})
											}
										/>
									))}
								</View>
							)}
						</View>
					)}
					ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
					contentContainerStyle={{ paddingVertical: 16, paddingHorizontal: 16 }}
					style={{ flex: 1 }}
				/>
			)}
			<ActionsSheet
				target={actionTarget}
				onClose={() => setActionTarget(null)}
				onCloseShell={() =>
					actionTarget &&
					handleCloseShell(actionTarget.connectionId, actionTarget.channelId)
				}
				onDisconnect={() =>
					actionTarget && handleDisconnect(actionTarget.connectionId)
				}
			/>
		</View>
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
	target: null | { connectionId: string; channelId: number };
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

function TopBarToggle({
	viewIndex,
	onChange,
}: {
	viewIndex: number;
	onChange: (index: number) => void;
}) {
	const theme = useTheme();
	const styles = React.useMemo(
		() =>
			StyleSheet.create({
				container: {
					paddingHorizontal: 16,
					paddingTop: 12,
					paddingBottom: 8,
					alignItems: 'flex-end',
				},
				toggle: {
					flexDirection: 'row',
					backgroundColor: theme.colors.surface,
					borderWidth: 1,
					borderColor: theme.colors.border,
					borderRadius: 10,
					overflow: 'hidden',
				},
				segment: {
					paddingHorizontal: 10,
					paddingVertical: 6,
					alignItems: 'center',
					justifyContent: 'center',
				},
				active: {
					backgroundColor: theme.colors.inputBackground,
				},
				iconActive: { color: theme.colors.textPrimary },
				iconInactive: { color: theme.colors.muted },
			}),
		[theme],
	);

	return (
		<View style={styles.container}>
			<View style={styles.toggle}>
				<Pressable
					accessibilityLabel="Flat list"
					onPress={() => onChange(0)}
					style={[styles.segment, viewIndex === 0 && styles.active]}
				>
					<Ionicons
						name="list"
						size={18}
						style={viewIndex === 0 ? styles.iconActive : styles.iconInactive}
					/>
				</Pressable>
				<Pressable
					accessibilityLabel="Grouped by connection"
					onPress={() => onChange(1)}
					style={[styles.segment, viewIndex === 1 && styles.active]}
				>
					<Ionicons
						name="git-branch"
						size={18}
						style={viewIndex === 1 ? styles.iconActive : styles.iconInactive}
					/>
				</Pressable>
			</View>
		</View>
	);
}
