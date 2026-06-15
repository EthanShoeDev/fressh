import { ScrollView } from 'react-native';
import {
	NativeForm,
	NativeSection,
	NativeSegmentedRow,
	NativeSelectRow,
} from '@/components/native-controls';
import { Section } from '@/components/settings-controls';
import { ThemedScreen } from '@/components/themed/ThemedScreen';
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

/** Native theme: one full-screen `<Host>` form of platform controls. `edges={[]}`
 *  because this route has a native stack header (see `_layout`), which already
 *  consumes the top inset. */
function NativeAppearance() {
	const { themeName, setThemeName, appearance, setAppearance } = useAppTheme();
	return (
		<ThemedScreen edges={[]}>
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
		</ThemedScreen>
	);
}

/** Stylized themes (reached by picking one above): the swatch-grid picker.
 *  Wrapped in `ThemedScreen` so the canvas gradient shows the moment you switch
 *  off the Native theme while standing on this route (it previously rendered a
 *  bare opaque `bg-background` with no `ThemedBackground`). */
function CustomAppearance() {
	const { themeName, setThemeName } = useAppTheme();
	const bottomSpace = useBottomTabSpacing();
	return (
		<ThemedScreen edges={[]}>
			<ScrollView
				className='flex-1'
				contentContainerClassName='p-4'
				contentContainerStyle={{ paddingBottom: bottomSpace + 16 }}
			>
				<Section title='Theme'>
					<ThemeGrid themeName={themeName} setThemeName={setThemeName} />
				</Section>
			</ScrollView>
		</ThemedScreen>
	);
}
