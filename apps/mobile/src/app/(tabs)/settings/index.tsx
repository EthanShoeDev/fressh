import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { preferences, TERMINAL_FONT_SIZE } from '@/lib/preferences';
import { useTheme, useThemeControls } from '@/lib/theme';

export default function Tab() {
	const theme = useTheme();
	const { themeName, setThemeName } = useThemeControls();
	const [fontSize, setFontSize] =
		preferences.terminalFontSize.useTerminalFontSizePref();

	return (
		<View
			style={{ flex: 1, padding: 16, backgroundColor: theme.colors.background }}
		>
			<View style={{ marginBottom: 24 }}>
				<Text
					style={{
						color: theme.colors.textSecondary,
						fontSize: 14,
						marginBottom: 8,
					}}
				>
					Theme
				</Text>
				<View style={{ gap: 8 }}>
					<Row
						label='Dark'
						selected={themeName === 'dark'}
						onPress={() => {
							setThemeName('dark');
						}}
					/>
					<Row
						label='Light'
						selected={themeName === 'light'}
						onPress={() => {
							setThemeName('light');
						}}
					/>
				</View>
			</View>

			<View style={{ marginBottom: 24 }}>
				<Text
					style={{
						color: theme.colors.textSecondary,
						fontSize: 14,
						marginBottom: 8,
					}}
				>
					Terminal
				</Text>
				<View
					style={{
						flexDirection: 'row',
						alignItems: 'center',
						justifyContent: 'space-between',
						backgroundColor: theme.colors.surface,
						borderWidth: 1,
						borderColor: theme.colors.border,
						borderRadius: 10,
						paddingHorizontal: 12,
						paddingVertical: 12,
					}}
				>
					<Text
						style={{
							color: theme.colors.textPrimary,
							fontSize: 16,
							fontWeight: '600',
						}}
					>
						Font size
					</Text>
					<View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
						<StepperButton
							label='−'
							disabled={fontSize <= TERMINAL_FONT_SIZE.min}
							onPress={() => {
								setFontSize(fontSize - TERMINAL_FONT_SIZE.step);
							}}
						/>
						<Text
							style={{
								color: theme.colors.textPrimary,
								fontSize: 16,
								fontWeight: '700',
								minWidth: 28,
								textAlign: 'center',
							}}
						>
							{fontSize}
						</Text>
						<StepperButton
							label='+'
							disabled={fontSize >= TERMINAL_FONT_SIZE.max}
							onPress={() => {
								setFontSize(fontSize + TERMINAL_FONT_SIZE.step);
							}}
						/>
					</View>
				</View>
			</View>

			<View style={{ marginBottom: 24 }}>
				<Text
					style={{
						color: theme.colors.textSecondary,
						fontSize: 14,
						marginBottom: 8,
					}}
				>
					Security
				</Text>
				<Link href='/(tabs)/settings/key-manager' asChild>
					<Pressable
						style={{
							backgroundColor: theme.colors.surface,
							borderWidth: 1,
							borderColor: theme.colors.border,
							borderRadius: 12,
							paddingHorizontal: 12,
							paddingVertical: 14,
							flexDirection: 'row',
							alignItems: 'center',
							justifyContent: 'space-between',
						}}
						accessibilityRole='button'
					>
						<Text
							style={{
								color: theme.colors.textPrimary,
								fontSize: 16,
								fontWeight: '600',
							}}
						>
							Manage Keys
						</Text>
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
				</Link>
			</View>
		</View>
	);
}

function StepperButton({
	label,
	disabled,
	onPress,
}: {
	label: string;
	disabled?: boolean;
	onPress: () => void;
}) {
	const theme = useTheme();
	return (
		<Pressable
			onPress={onPress}
			disabled={disabled}
			accessibilityRole='button'
			accessibilityLabel={label === '+' ? 'Increase font size' : 'Decrease font size'}
			style={{
				width: 40,
				height: 40,
				borderRadius: 10,
				alignItems: 'center',
				justifyContent: 'center',
				backgroundColor: theme.colors.background,
				borderWidth: 1,
				borderColor: theme.colors.border,
				opacity: disabled ? 0.4 : 1,
			}}
		>
			<Text
				style={{ color: theme.colors.textPrimary, fontSize: 22, fontWeight: '700' }}
			>
				{label}
			</Text>
		</Pressable>
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
	return (
		<Pressable
			onPress={onPress}
			style={[
				{
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
				selected ? { borderColor: theme.colors.primary } : undefined,
			]}
			accessibilityRole='button'
			accessibilityState={{ selected }}
		>
			<Text
				style={{
					color: theme.colors.textPrimary,
					fontSize: 16,
					fontWeight: '600',
				}}
			>
				{label}
			</Text>
			<Text
				style={{ color: theme.colors.primary, fontSize: 16, fontWeight: '800' }}
			>
				{selected ? '✔' : ''}
			</Text>
		</Pressable>
	);
}
