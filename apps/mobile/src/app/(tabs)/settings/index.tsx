import { Link } from 'expo-router';
import { Pressable, Switch, Text, View } from 'react-native';
import {
	COLOR_SCHEMES,
	CURSOR_STYLES,
	preferences,
	TERMINAL_FONT_SIZE,
	TERMINAL_PADDING,
	TERMINAL_SCROLLBACK,
} from '@/lib/preferences';
import { useTheme, useThemeControls } from '@/lib/theme';

export default function Tab() {
	const theme = useTheme();
	const { themeName, setThemeName } = useThemeControls();
	const [fontSize, setFontSize] =
		preferences.terminalFontSize.useTerminalFontSizePref();
	const [padding, setPadding] =
		preferences.terminalPadding.useTerminalPaddingPref();
	const [scrollback, setScrollback] =
		preferences.terminalScrollback.useTerminalScrollbackPref();
	const [colorScheme, setColorScheme] =
		preferences.terminalColorScheme.useTerminalColorSchemePref();
	const [cursorStyle, setCursorStyle] =
		preferences.terminalCursorStyle.useTerminalCursorStylePref();
	const [boldIsBright, setBoldIsBright] =
		preferences.terminalBoldIsBright.useTerminalBoldIsBrightPref();

	return (
		<View
			style={{ flex: 1, padding: 16, backgroundColor: theme.colors.background }}
		>
			<Section title='Theme'>
				<View style={{ gap: 8 }}>
					<SelectRow
						label='Dark'
						selected={themeName === 'dark'}
						onPress={() => {
							setThemeName('dark');
						}}
					/>
					<SelectRow
						label='Light'
						selected={themeName === 'light'}
						onPress={() => {
							setThemeName('light');
						}}
					/>
				</View>
			</Section>

			<Section title='Terminal'>
				<View style={{ gap: 8 }}>
					<StepperRow
						label='Font size'
						value={fontSize}
						decDisabled={fontSize <= TERMINAL_FONT_SIZE.min}
						incDisabled={fontSize >= TERMINAL_FONT_SIZE.max}
						onDec={() => {
							setFontSize(fontSize - TERMINAL_FONT_SIZE.step);
						}}
						onInc={() => {
							setFontSize(fontSize + TERMINAL_FONT_SIZE.step);
						}}
					/>
					<StepperRow
						label='Padding'
						value={padding}
						decDisabled={padding <= TERMINAL_PADDING.min}
						incDisabled={padding >= TERMINAL_PADDING.max}
						onDec={() => {
							setPadding(padding - TERMINAL_PADDING.step);
						}}
						onInc={() => {
							setPadding(padding + TERMINAL_PADDING.step);
						}}
					/>

					<FieldLabel>Color scheme</FieldLabel>
					{COLOR_SCHEMES.map((scheme) => (
						<SelectRow
							key={scheme.id}
							label={scheme.label}
							selected={colorScheme === scheme.id}
							onPress={() => {
								setColorScheme(scheme.id);
							}}
						/>
					))}

					<FieldLabel>Cursor</FieldLabel>
					<Segmented
						options={CURSOR_STYLES}
						value={cursorStyle}
						onChange={setCursorStyle}
					/>

					<ToggleRow
						label='Bold is bright'
						value={boldIsBright}
						onChange={setBoldIsBright}
					/>

					<StepperRow
						label='Scrollback'
						value={scrollback}
						decDisabled={scrollback <= TERMINAL_SCROLLBACK.min}
						incDisabled={scrollback >= TERMINAL_SCROLLBACK.max}
						onDec={() => {
							setScrollback(scrollback - TERMINAL_SCROLLBACK.step);
						}}
						onInc={() => {
							setScrollback(scrollback + TERMINAL_SCROLLBACK.step);
						}}
					/>
					<Text style={{ color: theme.colors.muted, fontSize: 12 }}>
						Scrollback applies to new shells.
					</Text>
				</View>
			</Section>

			<Section title='Security'>
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
			</Section>
		</View>
	);
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	const theme = useTheme();
	return (
		<View style={{ marginBottom: 24 }}>
			<Text
				style={{
					color: theme.colors.textSecondary,
					fontSize: 14,
					marginBottom: 8,
				}}
			>
				{title}
			</Text>
			{children}
		</View>
	);
}

function FieldLabel({ children }: { children: React.ReactNode }) {
	const theme = useTheme();
	return (
		<Text
			style={{
				color: theme.colors.textSecondary,
				fontSize: 13,
				marginTop: 8,
			}}
		>
			{children}
		</Text>
	);
}

/** Bordered surface card used by the stepper/toggle rows. */
function Card({ children }: { children: React.ReactNode }) {
	const theme = useTheme();
	return (
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
			{children}
		</View>
	);
}

function StepperRow({
	label,
	value,
	onDec,
	onInc,
	decDisabled,
	incDisabled,
}: {
	label: string;
	value: number;
	onDec: () => void;
	onInc: () => void;
	decDisabled?: boolean;
	incDisabled?: boolean;
}) {
	const theme = useTheme();
	return (
		<Card>
			<Text
				style={{
					color: theme.colors.textPrimary,
					fontSize: 16,
					fontWeight: '600',
				}}
			>
				{label}
			</Text>
			<View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
				<StepperButton
					label='−'
					accessibilityLabel={`Decrease ${label}`}
					disabled={decDisabled}
					onPress={onDec}
				/>
				<Text
					style={{
						color: theme.colors.textPrimary,
						fontSize: 16,
						fontWeight: '700',
						minWidth: 56,
						textAlign: 'center',
					}}
				>
					{value.toLocaleString()}
				</Text>
				<StepperButton
					label='+'
					accessibilityLabel={`Increase ${label}`}
					disabled={incDisabled}
					onPress={onInc}
				/>
			</View>
		</Card>
	);
}

function ToggleRow({
	label,
	value,
	onChange,
}: {
	label: string;
	value: boolean;
	onChange: (value: boolean) => void;
}) {
	const theme = useTheme();
	return (
		<Card>
			<Text
				style={{
					color: theme.colors.textPrimary,
					fontSize: 16,
					fontWeight: '600',
				}}
			>
				{label}
			</Text>
			<Switch
				value={value}
				onValueChange={onChange}
				accessibilityLabel={label}
			/>
		</Card>
	);
}

function Segmented<T extends string>({
	options,
	value,
	onChange,
}: {
	options: readonly { id: T; label: string }[];
	value: T;
	onChange: (id: T) => void;
}) {
	const theme = useTheme();
	return (
		<View
			style={{
				flexDirection: 'row',
				gap: 6,
				backgroundColor: theme.colors.surface,
				borderWidth: 1,
				borderColor: theme.colors.border,
				borderRadius: 10,
				padding: 4,
			}}
		>
			{options.map((option) => {
				const selected = option.id === value;
				return (
					<Pressable
						key={option.id}
						onPress={() => {
							onChange(option.id);
						}}
						accessibilityRole='button'
						accessibilityState={{ selected }}
						style={{
							flex: 1,
							alignItems: 'center',
							justifyContent: 'center',
							paddingVertical: 8,
							borderRadius: 8,
							backgroundColor: selected
								? theme.colors.primary
								: 'transparent',
						}}
					>
						<Text
							style={{
								color: selected
									? theme.colors.background
									: theme.colors.textPrimary,
								fontSize: 14,
								fontWeight: '600',
							}}
						>
							{option.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

function StepperButton({
	label,
	disabled,
	onPress,
	accessibilityLabel,
}: {
	label: string;
	disabled?: boolean;
	onPress: () => void;
	accessibilityLabel: string;
}) {
	const theme = useTheme();
	return (
		<Pressable
			onPress={onPress}
			disabled={disabled}
			accessibilityRole='button'
			accessibilityLabel={accessibilityLabel}
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

function SelectRow({
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
