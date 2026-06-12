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
						{/* Truncate (ellipsis) instead of wrapping — a wrapped label
						    ("Underline" on narrow devices) blows up that one segment's
						    height and the row looks lopsided. */}
						<Text maxLines={1}>{option.label}</Text>
					</SegmentedButton.Label>
				</SegmentedButton>
			))}
		</SingleChoiceSegmentedButtonRow>
	);
}
