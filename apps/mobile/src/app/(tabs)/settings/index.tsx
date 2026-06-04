import { View } from 'react-native';
import { LinkRow, Section, SelectRow } from '@/components/settings-controls';
import { APP_THEMES, useAppTheme } from '@/lib/theme';

export default function Tab() {
	const { themeName, setThemeName } = useAppTheme();

	return (
		<View className='flex-1 bg-background p-4'>
			<Section title='Theme'>
				<View className='gap-2'>
					{APP_THEMES.map((appTheme) => (
						<SelectRow
							key={appTheme.id}
							label={appTheme.label}
							selected={themeName === appTheme.id}
							onPress={() => {
								setThemeName(appTheme.id);
							}}
						/>
					))}
				</View>
			</Section>

			<Section title='Terminal'>
				<LinkRow href='/(tabs)/settings/terminal' label='Terminal settings' />
			</Section>

			<Section title='Security'>
				<LinkRow href='/(tabs)/settings/key-manager' label='Manage Keys' />
			</Section>
		</View>
	);
}
