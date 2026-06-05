import { Pressable, ScrollView, View } from 'react-native';
import { ScreenHeader } from '@/components/themed/ScreenHeader';
import { ThemedScreen } from '@/components/themed/ThemedScreen';
import { ThemedText } from '@/components/themed/ThemedText';
import { LinkRow, Section, Segmented } from '@/components/settings-controls';
import { preferences } from '@/lib/preferences';
import type { TabBarImpl } from '@/lib/tab-bar-config';
import { APP_THEMES, useAppTheme, type ThemeSwatch } from '@/lib/theme';
import { applyCase, useThemeSkin } from '@/lib/theme-skin';

const TAB_BAR_OPTIONS: readonly { id: TabBarImpl; label: string }[] = [
	{ id: 'native', label: 'Native' },
	{ id: 'js', label: 'Custom' },
];

export default function Tab() {
	const { themeName, setThemeName } = useAppTheme();
	const [tabBarImpl, setTabBarImpl] = preferences.tabBarImpl.useValue();

	return (
		<ThemedScreen edges={['top']}>
			<ScreenHeader title='Settings' />
			<ScrollView className='flex-1' contentContainerClassName='px-4 pb-4 pt-2'>
				<Section title='Theme'>
					<View className='flex-row flex-wrap justify-between gap-y-3'>
						{APP_THEMES.map((appTheme) => (
							<ThemeCard
								key={appTheme.id}
								label={appTheme.label}
								swatch={appTheme.swatch}
								selected={themeName === appTheme.id}
								onPress={() => {
									setThemeName(appTheme.id);
								}}
							/>
						))}
					</View>
				</Section>

				<Section title='Tab bar'>
					<Segmented
						options={TAB_BAR_OPTIONS}
						value={tabBarImpl}
						onChange={setTabBarImpl}
					/>
				</Section>

				{/* Manage Keys moved to its own bottom-nav tab; Security section dropped. */}
				<Section title='Terminal'>
					<LinkRow href='/(tabs)/settings/terminal' label='Terminal settings' />
				</Section>
			</ScrollView>
		</ThemedScreen>
	);
}

function ThemeCard({
	label,
	swatch,
	selected,
	onPress,
}: {
	label: string;
	swatch: ThemeSwatch;
	selected: boolean;
	onPress: () => void;
}) {
	const skin = useThemeSkin();
	return (
		<Pressable
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
