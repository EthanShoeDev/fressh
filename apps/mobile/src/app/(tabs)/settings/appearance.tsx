import { ScrollView, View } from 'react-native';
import {
	NativeForm,
	NativeSection,
	NativeSegmentedRow,
	NativeSelectRow,
} from '@/components/native-controls';
import { Section } from '@/components/settings-controls';
import { ThemeGrid } from '@/components/theme-grid';
import { APPEARANCE_MODES } from '@/lib/preferences';
import { APP_THEMES, useAppTheme } from '@/lib/theme';
import { useIsNativeTheme } from '@/lib/theme-skin';
import { useBottomTabSpacing } from '@/lib/useBottomTabSpacing';

const APPEARANCE_FOOTER =
	'System follows your device’s light/dark setting. Only the Native theme has a light variant — the stylized themes are always dark.';

/**
 * Appearance sub-screen: theme choice + (for Native) the System/Light/Dark
 * override. On the Native theme this is the native-correct home for theme
 * selection — select rows inside the form, so everything scrolls together
 * (the old pinned swatch grid above the form did not). Picking a stylized
 * theme flips this screen to the custom path mid-flight, so both paths exist.
 */
export default function AppearanceScreen() {
	return useIsNativeTheme() ? <NativeAppearance /> : <CustomAppearance />;
}

/** Native theme: one full-screen `<Host>` form of platform controls. */
function NativeAppearance() {
	const { themeName, setThemeName, appearance, setAppearance } = useAppTheme();
	return (
		<View className='flex-1 bg-background'>
			<NativeForm>
				<NativeSection title='Appearance' footer={APPEARANCE_FOOTER}>
					<NativeSegmentedRow
						options={APPEARANCE_MODES}
						value={appearance}
						onChange={setAppearance}
					/>
				</NativeSection>
				<NativeSection title='Theme'>
					{APP_THEMES.map((appTheme) => (
						<NativeSelectRow
							key={appTheme.id}
							label={appTheme.label}
							selected={themeName === appTheme.id}
							onPress={() => {
								setThemeName(appTheme.id);
							}}
						/>
					))}
				</NativeSection>
			</NativeForm>
		</View>
	);
}

/** Stylized themes (reached by picking one above): the swatch-grid picker. */
function CustomAppearance() {
	const { themeName, setThemeName } = useAppTheme();
	const bottomSpace = useBottomTabSpacing();
	return (
		<View className='flex-1 bg-background'>
			<ScrollView
				className='flex-1'
				contentContainerClassName='p-4'
				contentContainerStyle={{ paddingBottom: bottomSpace + 16 }}
			>
				<Section title='Theme'>
					<ThemeGrid themeName={themeName} setThemeName={setThemeName} />
				</Section>
			</ScrollView>
		</View>
	);
}
