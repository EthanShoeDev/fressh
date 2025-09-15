import { Link } from 'expo-router';
import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { useTheme, useThemeControls, type AppTheme } from '@/lib/theme';

export default function Tab() {
	const theme = useTheme();
	const styles = React.useMemo(() => makeStyles(theme), [theme]);
	const { themeName, setThemeName } = useThemeControls();

	return (
		<View style={styles.container}>
			<View style={styles.section}>
				<Text style={styles.sectionTitle}>Theme</Text>
				<View style={styles.rowGroup}>
					<Row
						label="Dark"
						selected={themeName === 'dark'}
						onPress={() => setThemeName('dark')}
					/>
					<Row
						label="Light"
						selected={themeName === 'light'}
						onPress={() => setThemeName('light')}
					/>
				</View>
			</View>

			<View style={styles.section}>
				<Text style={styles.sectionTitle}>Security</Text>
				<Link href="/(tabs)/settings/key-manager" asChild>
					<Pressable style={styles.callout} accessibilityRole="button">
						<Text style={styles.calloutLabel}>Manage Keys</Text>
						<Text style={styles.calloutChevron}>›</Text>
					</Pressable>
				</Link>
			</View>
		</View>
	);
}

function Row({
	label,
	selected,
	onPress,
}: {
	label: string;
	selected?: boolean;
	onPress: () => void;
}) {
	const theme = useTheme();
	const styles = React.useMemo(() => makeStyles(theme), [theme]);
	return (
		<Pressable
			onPress={onPress}
			style={[styles.row, selected && styles.rowSelected]}
			accessibilityRole="button"
			accessibilityState={{ selected }}
		>
			<Text style={styles.rowLabel}>{label}</Text>
			<Text style={styles.rowCheck}>{selected ? '✔' : ''}</Text>
		</Pressable>
	);
}

function makeStyles(theme: AppTheme) {
	return StyleSheet.create({
		container: {
			flex: 1,
			padding: 16,
			backgroundColor: theme.colors.background,
		},
		// Title removed; screen header provides the title
		section: {
			marginBottom: 24,
		},
		sectionTitle: {
			color: theme.colors.textSecondary,
			fontSize: 14,
			marginBottom: 8,
		},
		rowGroup: { gap: 8 },
		row: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
			backgroundColor: theme.colors.surface,
			borderWidth: 1,
			borderColor: theme.colors.border,
			borderRadius: 10,
			paddingHorizontal: 12,
			paddingVertical: 12,
		},
		rowSelected: {
			borderColor: theme.colors.primary,
		},
		rowLabel: {
			color: theme.colors.textPrimary,
			fontSize: 16,
			fontWeight: '600',
		},
		rowCheck: {
			color: theme.colors.primary,
			fontSize: 16,
			fontWeight: '800',
		},
		callout: {
			backgroundColor: theme.colors.surface,
			borderWidth: 1,
			borderColor: theme.colors.border,
			borderRadius: 12,
			paddingHorizontal: 12,
			paddingVertical: 14,
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
		},
		calloutLabel: {
			color: theme.colors.textPrimary,
			fontSize: 16,
			fontWeight: '600',
		},
		calloutChevron: {
			color: theme.colors.muted,
			fontSize: 22,
			paddingHorizontal: 4,
		},
	});
}
