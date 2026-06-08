import { Picker, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';

/**
 * iOS: a SwiftUI `Picker` in `.segmented` style — the native segmented control.
 * Each option is a `Text` carrying a `tag` matching its `id`; `selection` /
 * `onSelectionChange` drive it by `id`. See native-segmented-control.d.ts.
 */
export function NativeSegmentedControl<T extends string>({
	options,
	value,
	onChange,
}: {
	options: readonly { id: T; label: string }[];
	value: T;
	onChange: (id: T) => void;
}) {
	return (
		<Picker
			selection={value}
			onSelectionChange={onChange}
			modifiers={[pickerStyle('segmented')]}
		>
			{options.map((option) => (
				<Text key={option.id} modifiers={[tag(option.id)]}>
					{option.label}
				</Text>
			))}
		</Picker>
	);
}
