import React, { useCallback, useEffect, useRef } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import {
	BROWSER_ACTION_ROWS,
	isBrowserActionUrlRow,
	type BrowserActionRow,
} from '@/lib/browser-actions';
import { type HostBrowserUrlSlot } from '@/lib/host-browser-actions';
import { resolveLucideIcon } from '@/lib/lucide-utils';
import { useTheme } from '@/lib/theme';

export function BrowserActionsModal({
	open,
	bottomOffset,
	onClose,
	onOpenDiff,
	onOpenGitHubIssues,
	onOpenGitHubPulls,
	onOpenUrlSlot,
	onEditUrlSlot,
}: {
	open: boolean;
	bottomOffset: number;
	onClose: () => void;
	onOpenDiff: () => void;
	onOpenGitHubIssues: () => void;
	onOpenGitHubPulls: () => void;
	onOpenUrlSlot: (slot: HostBrowserUrlSlot) => void;
	onEditUrlSlot: (slot: HostBrowserUrlSlot) => void;
}) {
	const theme = useTheme();
	const longPressedRowIdRef = useRef<string | null>(null);

	useEffect(() => {
		if (!open) {
			longPressedRowIdRef.current = null;
		}
	}, [open]);

	const runAndClose = useCallback(
		(callback: () => void) => {
			onClose();
			callback();
		},
		[onClose],
	);

	const handlePress = useCallback(
		(row: BrowserActionRow) => {
			if (longPressedRowIdRef.current === row.id) {
				longPressedRowIdRef.current = null;
				return;
			}
			if (row.id === 'diff') {
				runAndClose(onOpenDiff);
				return;
			}
			if (row.id === 'github-issues') {
				runAndClose(onOpenGitHubIssues);
				return;
			}
			if (row.id === 'github-pulls') {
				runAndClose(onOpenGitHubPulls);
				return;
			}
			if (isBrowserActionUrlRow(row)) {
				runAndClose(() => onOpenUrlSlot(row.slot));
			}
		},
		[
			onOpenDiff,
			onOpenGitHubIssues,
			onOpenGitHubPulls,
			onOpenUrlSlot,
			runAndClose,
		],
	);

	const handleLongPress = useCallback(
		(row: BrowserActionRow) => {
			if (!isBrowserActionUrlRow(row)) return;
			longPressedRowIdRef.current = row.id;
			runAndClose(() => onEditUrlSlot(row.slot));
		},
		[onEditUrlSlot, runAndClose],
	);

	return (
		<Modal
			transparent
			visible={open}
			animationType="slide"
			onRequestClose={onClose}
		>
			<Pressable
				onPress={onClose}
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
						<Pressable
							accessibilityRole="button"
							onPress={onClose}
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
