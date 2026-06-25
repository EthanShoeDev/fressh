import { Pressable, View } from 'react-native';
import { ThemedText } from '@/components/themed/ThemedText';
import { type AppThemeName, APP_THEMES, type ThemeSwatch } from '@/lib/theme';
import { applyCase, useThemeSkin } from '@/lib/theme-skin';

/**
 * The swatch-grid theme picker — the stylized themes' way of choosing a theme.
 * Lives on the Settings root for the stylized themes (where it scrolls with the
 * page) and on the Appearance sub-screen's stylized path; the Native theme uses
 * native select rows instead (see settings/appearance.tsx).
 */
export function ThemeGrid({
	themeName,
	setThemeName,
}: {
	themeName: AppThemeName;
	setThemeName: (name: AppThemeName) => void;
}) {
	return (
		<View className='flex-row flex-wrap justify-between gap-y-3'>
			{APP_THEMES.map((appTheme) => (
				<ThemeCard
					key={appTheme.id}
					testID={`theme-${appTheme.id}`}
					label={appTheme.label}
					swatch={appTheme.swatch}
					selected={themeName === appTheme.id}
					onPress={() => {
						setThemeName(appTheme.id);
					}}
				/>
			))}
		</View>
	);
}

function ThemeCard({
	label,
	swatch,
	selected,
	onPress,
	testID,
}: {
	label: string;
	swatch: ThemeSwatch;
	selected: boolean;
	onPress: () => void;
	testID?: string;
}) {
	const skin = useThemeSkin();
	return (
		<Pressable
			testID={testID}
			onPress={onPress}
			accessibilityRole='button'
			accessibilityState={{ selected }}
			style={{ width: '48%', borderRadius: skin.radius }}
			className={
				selected
					? 'border-2 border-primary bg-surface p-2.5'
					: 'border border-border bg-surface p-2.5'
			}
		>
			<ThemeSwatchPreview swatch={swatch} radius={skin.controlRadius} />
			<View className='mt-2 flex-row items-center justify-between'>
				<ThemedText
					className='text-[13px] font-semibold text-text-primary'
					style={skin.mono ? { fontFamily: skin.monoFamily } : undefined}
				>
					{applyCase(skin, label)}
				</ThemedText>
				{selected ? (
					<ThemedText className='text-sm font-extrabold text-primary'>
						✓
					</ThemedText>
				) : null}
			</View>
		</Pressable>
	);
}

/** A tiny palette preview using the theme's *literal* colors (not tokens). */
function ThemeSwatchPreview({
	swatch,
	radius,
}: {
	swatch: ThemeSwatch;
	radius: number;
}) {
	return (
		<View
			className='h-10 flex-row items-center gap-2 overflow-hidden px-2.5'
			style={{
				backgroundColor: swatch.bg,
				borderWidth: 1,
				borderColor: 'rgba(255,255,255,0.10)',
				borderRadius: radius,
			}}
		>
			<ThemedText
				className='text-[13px] font-bold'
				style={{ color: swatch.accent }}
			>
				{'>_'}
			</ThemedText>
			<View className='flex-1 gap-1'>
				<View
					className='h-1 rounded-full'
					style={{ width: '70%', backgroundColor: swatch.accent, opacity: 0.9 }}
				/>
				<View
					className='h-1 rounded-full'
					style={{
						width: '45%',
						backgroundColor: swatch.accent2,
						opacity: 0.6,
					}}
				/>
			</View>
		</View>
	);
}
