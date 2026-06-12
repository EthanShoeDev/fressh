import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';
import {
	NativeForm,
	NativeNavRow,
	NativeSection,
	NativeSegmentedRow,
	NativeToggleRow,
} from '@/components/native-controls';
import { ScreenHeader } from '@/components/themed/ScreenHeader';
import { ThemedScreen } from '@/components/themed/ThemedScreen';
import { ThemedText } from '@/components/themed/ThemedText';
import {
	LinkRow,
	Section,
	Segmented,
	ToggleRow,
} from '@/components/settings-controls';
import { ThemeGrid } from '@/components/theme-grid';
import { preferences } from '@/lib/preferences';
import type { TabBarImpl } from '@/lib/tab-bar-config';
import { useBottomTabSpacing } from '@/lib/useBottomTabSpacing';
import { APP_THEMES, useAppTheme } from '@/lib/theme';
import { useIsNativeTheme } from '@/lib/theme-skin';

const TAB_BAR_OPTIONS: readonly { id: TabBarImpl; label: string }[] = [
	{ id: 'native', label: 'Native' },
	{ id: 'js', label: 'Custom' },
];

const SHELL_INTEGRATION_FOOTER =
	'Lets fressh track the current folder, command status, and timing. Set up automatically on connect — nothing is changed on your server. Off makes fressh a plain SSH client.';

// Branch by theme at the top so each path is its own component with a stable hook
// list — the Native path renders real platform controls (@expo/ui), every other
// theme keeps the custom-drawn settings UI.
export default function Tab() {
	return useIsNativeTheme() ? <NativeSettings /> : <CustomSettings />;
}

/** Native theme: one full-screen `<Host>` form of platform controls. Theme
 *  selection lives on the pushed Appearance sub-screen (a nav row, the native
 *  idiom) — a swatch grid pinned above the form didn't scroll with it. */
function NativeSettings() {
	const { themeName } = useAppTheme();
	const [tabBarImpl, setTabBarImpl] = preferences.tabBarImpl.useValue();
	const [shellIntegration, setShellIntegration] =
		preferences.shellIntegrationEnabled.useValue();
	const router = useRouter();
	const themeLabel = APP_THEMES.find((t) => t.id === themeName)?.label;

	return (
		<ThemedScreen edges={['top']}>
			<ScreenHeader title='Settings' />
			<NativeForm>
				<NativeSection>
					<NativeNavRow
						label='Appearance'
						value={themeLabel}
						onPress={() => router.push('/(tabs)/settings/appearance')}
					/>
				</NativeSection>
				<NativeSection>
					<NativeSegmentedRow
						layout='inline'
						label='Tab bar'
						options={TAB_BAR_OPTIONS}
						value={tabBarImpl}
						onChange={setTabBarImpl}
					/>
				</NativeSection>
				<NativeSection
					title='Shell integration'
					footer={SHELL_INTEGRATION_FOOTER}
				>
					<NativeToggleRow
						label='Smart terminal'
						value={shellIntegration}
						onChange={setShellIntegration}
					/>
				</NativeSection>
				<NativeSection title='Terminal'>
					<NativeNavRow
						label='Terminal settings'
						onPress={() => router.push('/(tabs)/settings/terminal')}
					/>
				</NativeSection>
				<NativeSection title='Security'>
					<NativeNavRow
						label='Known hosts'
						onPress={() => router.push('/(tabs)/settings/known-hosts')}
					/>
				</NativeSection>
			</NativeForm>
		</ThemedScreen>
	);
}

/** Every stylized theme: the custom-drawn settings UI. */
function CustomSettings() {
	const { themeName, setThemeName } = useAppTheme();
	const [tabBarImpl, setTabBarImpl] = preferences.tabBarImpl.useValue();
	const [shellIntegration, setShellIntegration] =
		preferences.shellIntegrationEnabled.useValue();
	// Reserve space under the bottom tab bar so the last row (Terminal settings)
	// isn't hidden behind it — ThemedScreen only insets the top edge, so content
	// runs to the screen bottom (under the bar) otherwise.
	const bottomSpace = useBottomTabSpacing();

	return (
		<ThemedScreen edges={['top']}>
			<ScreenHeader title='Settings' />
			<ScrollView
				className='flex-1'
				contentContainerClassName='px-4 pt-2'
				contentContainerStyle={{ paddingBottom: bottomSpace }}
			>
				<Section title='Theme'>
					<ThemeGrid themeName={themeName} setThemeName={setThemeName} />
				</Section>

				<Section title='Tab bar'>
					<Segmented
						options={TAB_BAR_OPTIONS}
						value={tabBarImpl}
						onChange={setTabBarImpl}
					/>
				</Section>

				<Section title='Shell integration'>
					<ToggleRow
						label='Smart terminal'
						value={shellIntegration}
						onChange={setShellIntegration}
					/>
					<ThemedText className='mt-1.5 px-1 text-xs text-muted'>
						{SHELL_INTEGRATION_FOOTER}
					</ThemedText>
				</Section>

				{/* Manage Keys moved to its own bottom-nav tab. */}
				<Section title='Terminal'>
					<LinkRow href='/(tabs)/settings/terminal' label='Terminal settings' />
				</Section>

				<Section title='Security'>
					<LinkRow href='/(tabs)/settings/known-hosts' label='Known hosts' />
				</Section>
			</ScrollView>
		</ThemedScreen>
	);
}
