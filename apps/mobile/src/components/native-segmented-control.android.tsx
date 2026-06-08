import {
	SegmentedButton,
	SingleChoiceSegmentedButtonRow,
	Text,
} from '@expo/ui/jetpack-compose';

/**
 * Android: a Material 3 `SingleChoiceSegmentedButtonRow` of `SegmentedButton`s —
 * the native segmented control. See native-segmented-control.d.ts.
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
		<SingleChoiceSegmentedButtonRow>
			{options.map((option) => (
				<SegmentedButton
					key={option.id}
					selected={option.id === value}
					onClick={() => {
						onChange(option.id);
					}}
				>
					<SegmentedButton.Label>
						<Text>{option.label}</Text>
					</SegmentedButton.Label>
				</SegmentedButton>
			))}
		</SingleChoiceSegmentedButtonRow>
	);
}
