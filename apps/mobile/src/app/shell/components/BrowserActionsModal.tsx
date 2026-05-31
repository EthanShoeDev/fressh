import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import {
	BROWSER_ACTION_ROWS,
	getBrowserActionModeButtonLabel,
	isBrowserActionUrlRow,
	type BrowserActionMenuMode,
	type BrowserActionRow,
} from '@/lib/browser-actions';
import { type HostBrowserUrlSlot } from '@/lib/host-browser-actions';
import { resolveLucideIcon } from '@/lib/lucide-utils';
import { useTheme } from '@/lib/theme';
import {
	handleBrowserActionsModalClose,
	handleBrowserActionsModalModeToggle,
	handleBrowserActionsModalRowLongPress,
	handleBrowserActionsModalRowPress,
	handleBrowserActionsModalShow,
	resetBrowserActionsModalState,
	type BrowserActionsModalCallbacks,
} from './browser-actions-modal-controller';

export function BrowserActionsModal({
	open,
	bottomOffset,
	onClose,
	onOpenDiff,
	onOpenGitHubIssues,
	onOpenGitHubPulls,
	onOpenDetectedAuto,
	onOpenDetectedPick,
	onOpenUrlSlot,
	onEditUrlSlot,
}: {
	open: boolean;
	bottomOffset: number;
	onClose: () => void;
	onOpenDiff: () => void;
	onOpenGitHubIssues: () => void;
	onOpenGitHubPulls: () => void;
	onOpenDetectedAuto: () => void;
	onOpenDetectedPick: () => void;
	onOpenUrlSlot: (slot: HostBrowserUrlSlot) => void;
	onEditUrlSlot: (slot: HostBrowserUrlSlot) => void;
}) {
	const theme = useTheme();
	const longPressedRowIdRef = useRef<string | null>(null);
	const [menuMode, setMenuMode] = useState<BrowserActionMenuMode>('open');

	const resetMenuState = useCallback(() => {
		resetBrowserActionsModalState({
			setMenuMode,
			setLongPressedRowId: (rowId) => {
				longPressedRowIdRef.current = rowId;
			},
		});
	}, []);

	useEffect(() => {
		if (!open) resetMenuState();
	}, [open, resetMenuState]);

	const handleShow = useCallback(() => {
		handleBrowserActionsModalShow({
			setMenuMode,
			setLongPressedRowId: (rowId) => {
				longPressedRowIdRef.current = rowId;
			},
		});
	}, []);

	const handleClose = useCallback(() => {
		handleBrowserActionsModalClose({
			setMenuMode,
			onClose,
		});
	}, [onClose]);

	const callbacks: BrowserActionsModalCallbacks = useMemo(
		() => ({
			onClose: handleClose,
			onOpenDiff,
			onOpenGitHubIssues,
			onOpenGitHubPulls,
			onOpenDetectedAuto,
			onOpenDetectedPick,
			onOpenUrlSlot,
			onEditUrlSlot,
		}),
		[
			handleClose,
			onEditUrlSlot,
			onOpenDetectedAuto,
			onOpenDetectedPick,
			onOpenDiff,
			onOpenGitHubIssues,
			onOpenGitHubPulls,
			onOpenUrlSlot,
		],
	);

	const toggleMenuMode = useCallback(() => {
		handleBrowserActionsModalModeToggle({ setMenuMode });
	}, []);

	const modeButtonLabel = getBrowserActionModeButtonLabel(menuMode);

	const handlePress = useCallback(
		(row: BrowserActionRow) => {
			handleBrowserActionsModalRowPress({
				row,
				menuMode,
				longPressedRowId: longPressedRowIdRef.current,
				setLongPressedRowId: (rowId) => {
					longPressedRowIdRef.current = rowId;
				},
				callbacks,
			});
		},
		[callbacks, menuMode],
	);

	const handleLongPress = useCallback(
		(row: BrowserActionRow) => {
			handleBrowserActionsModalRowLongPress({
				row,
				setLongPressedRowId: (rowId) => {
					longPressedRowIdRef.current = rowId;
				},
				callbacks,
			});
		},
		[callbacks],
	);

	return (
		<Modal
			transparent
			visible={open}
			animationType="slide"
			onRequestClose={handleClose}
			onShow={handleShow}
		>
			<Pressable
				onPress={handleClose}
				style={{
					flex: 1,
					backgroundColor: theme.colors.overlay,
					justifyContent: 'flex-end',
					alignItems: 'flex-end',
				}}
			>
				<View
					onStartShouldSetResponder={() => true}
					style={{
						backgroundColor: theme.colors.background,
						borderTopLeftRadius: 16,
						padding: 16,
						borderColor: theme.colors.borderStrong,
						borderWidth: 1,
						maxHeight: '80%',
						width: '72%',
						maxWidth: 360,
						minWidth: 260,
						marginRight: 8,
						marginBottom: bottomOffset,
					}}
				>
					<View
						style={{
							flexDirection: 'row',
							alignItems: 'center',
							justifyContent: 'space-between',
							marginBottom: 12,
						}}
					>
						<Text
							style={{
								color: theme.colors.textPrimary,
								fontSize: 18,
								fontWeight: '700',
							}}
						>
							Browser
						</Text>
						<View
							style={{
								flexDirection: 'row',
								alignItems: 'center',
							}}
						>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={`Switch Browser menu to ${modeButtonLabel} mode`}
								onPress={toggleMenuMode}
								style={{
									paddingHorizontal: 10,
									paddingVertical: 6,
									borderRadius: 8,
									borderWidth: 1,
									borderColor: theme.colors.primary,
									backgroundColor:
										menuMode === 'set'
											? theme.colors.primaryDisabled
											: theme.colors.background,
									marginRight: 8,
								}}
							>
								<Text
									style={{
										color: theme.colors.textPrimary,
										fontWeight: '600',
									}}
								>
									{modeButtonLabel}
								</Text>
							</Pressable>
							<Pressable
								accessibilityRole="button"
								onPress={handleClose}
								style={{
									paddingHorizontal: 10,
									paddingVertical: 6,
									borderRadius: 8,
									borderWidth: 1,
									borderColor: theme.colors.border,
								}}
							>
								<Text style={{ color: theme.colors.textSecondary }}>Close</Text>
							</Pressable>
						</View>
					</View>

					<ScrollView>
						{BROWSER_ACTION_ROWS.map((row) => {
							const Icon = resolveLucideIcon(row.icon);
							return (
								<Pressable
									key={row.id}
									accessibilityRole="button"
									onPress={() => handlePress(row)}
									onLongPress={
										isBrowserActionUrlRow(row)
											? () => handleLongPress(row)
											: undefined
									}
									style={{
										paddingVertical: 12,
										paddingHorizontal: 12,
										borderRadius: 10,
										borderWidth: 1,
										borderColor: theme.colors.border,
										backgroundColor: theme.colors.surface,
										marginBottom: 8,
									}}
								>
									<View
										style={{
											flexDirection: 'row',
											alignItems: 'center',
										}}
									>
										{Icon ? (
											<View style={{ marginRight: 10 }}>
												<Icon color={theme.colors.textPrimary} size={18} />
											</View>
										) : null}
										<View style={{ flex: 1 }}>
											<Text
												style={{
													color: theme.colors.textPrimary,
													fontSize: 14,
													fontWeight: '600',
												}}
											>
												{row.label}
											</Text>
											<Text
												numberOfLines={2}
												style={{
													color: theme.colors.textSecondary,
													fontSize: 12,
													marginTop: 2,
												}}
											>
												{row.description}
											</Text>
										</View>
									</View>
								</Pressable>
							);
						})}
					</ScrollView>
				</View>
			</Pressable>
		</Modal>
	);
}
