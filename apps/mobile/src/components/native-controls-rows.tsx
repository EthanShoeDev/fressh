import { Button, Column, Row, Spacer, Switch, Text } from '@expo/ui';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { NativeSegmentedControl } from '@/components/native-segmented-control';

/**
 * The settings ROW primitives, shared by both platform variants of
 * `native-controls` (`native-controls.tsx` for iOS, `native-controls.android.tsx`
 * for Android). The rows render only their visual content and were byte-identical
 * (or differed by a single layout modifier) across the two files; keeping one
 * copy here removes that duplication. What stays platform-specific lives in the
 * two `native-controls` files: the form container (`NativeForm`) and the section
 * grouping (`NativeSection`) — SwiftUI `FieldGroup` on iOS vs. a hand-built
 * Compose `LazyColumn`/`ListItem` list on Android.
 *
 * The two platform differences are branched on `Platform.OS` below:
 *  - On Android each row must `fillMaxWidth()` so the trailing `Spacer` pushes
 *    the control to the edge; iOS/SwiftUI rows already span the row.
 *  - On Android interactivity lives on the wrapping `ListItem` (`NativeSection`
 *    reads the row element's `onPress` and applies `clickable`), so a tappable
 *    row does NOT set `onPress` on its own `Row`; on iOS the `Row` is the target.
 *
 * The default (iOS) `native-controls.tsx` already imports
 * `@expo/ui/jetpack-compose/modifiers`, so the `fillMaxWidth` import here is safe
 * on every platform.
 */

// Fill the row width on Android only (see header). iOS rows shrink-wrap.
const FILL_WIDTH = Platform.OS === 'android' ? [fillMaxWidth()] : undefined;

/** `label … <trailing control>` — the standard settings row layout. */
export function LabeledRow({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<Row alignment='center' spacing={12} modifiers={FILL_WIDTH}>
			<Text>{label}</Text>
			<Spacer flexible />
			{children}
		</Row>
	);
}

/** A bare row that is a tap target on iOS but defers its press to the wrapping
 *  `ListItem` on Android (see header). `onPress` is still read off the element by
 *  Android's `NativeSection`, so callers always pass it. */
function PressableRow({
	onPress,
	children,
}: {
	onPress: () => void;
	children: ReactNode;
}) {
	if (Platform.OS === 'android') {
		return (
			<Row alignment='center' spacing={12} modifiers={[fillMaxWidth()]}>
				{children}
			</Row>
		);
	}
	return (
		<Row onPress={onPress} alignment='center' spacing={12}>
			{children}
		</Row>
	);
}

export function NativeToggleRow({
	label,
	value,
	onChange,
}: {
	label: string;
	value: boolean;
	onChange: (value: boolean) => void;
}) {
	return (
		<LabeledRow label={label}>
			<Switch value={value} onValueChange={onChange} />
		</LabeledRow>
	);
}

export function NativeSegmentedRow<T extends string>({
	label,
	options,
	value,
	onChange,
	layout = 'stack',
}: {
	/** A caption for the control. With `layout='stack'` it sits above (omit when
	 *  the section title already names it); with `layout='inline'` it's required
	 *  and sits to the left, the control trailing. */
	label?: string;
	options: readonly { id: T; label: string }[];
	value: T;
	onChange: (id: T) => void;
	/** `stack` = full-width control under an optional caption; `inline` = compact
	 *  control trailing a left-hand `label` (best for 2–3 options so a full-width
	 *  segmented control doesn't dominate a row). */
	layout?: 'stack' | 'inline';
}) {
	// A real native segmented control, not the dropdown menu Picker.
	const muted = useCSSVariable('--color-muted') as string;
	const control = (
		<NativeSegmentedControl
			options={options}
			value={value}
			onChange={onChange}
		/>
	);
	if (layout === 'inline') {
		return <LabeledRow label={label ?? ''}>{control}</LabeledRow>;
	}
	return (
		<Column spacing={6} alignment='start' modifiers={FILL_WIDTH}>
			{label ? (
				<Text textStyle={{ fontSize: 13, color: muted }}>{label}</Text>
			) : null}
			{control}
		</Column>
	);
}

export function NativeSelectRow({
	label,
	selected,
	onPress,
}: {
	label: string;
	selected?: boolean;
	/** On Android, read by `NativeSection` and applied to the row's `ListItem`. */
	onPress: () => void;
}) {
	// Tint the checkmark with the (system) primary; the label defers to the
	// platform's default label color.
	const primary = useCSSVariable('--color-primary') as string;
	return (
		<PressableRow onPress={onPress}>
			<Text>{label}</Text>
			<Spacer flexible />
			{selected ? (
				<Text textStyle={{ color: primary, fontWeight: '600' }}>✓</Text>
			) : null}
		</PressableRow>
	);
}

/** A tappable row that navigates elsewhere (trailing chevron), with an optional
 *  muted current-value readout before the chevron — the settings-row idiom. */
export function NativeNavRow({
	label,
	value,
	onPress,
}: {
	label: string;
	value?: string;
	/** On Android, read by `NativeSection` and applied to the row's `ListItem`. */
	onPress: () => void;
}) {
	const muted = useCSSVariable('--color-muted') as string;
	return (
		<PressableRow onPress={onPress}>
			<Text>{label}</Text>
			<Spacer flexible />
			{value ? <Text textStyle={{ color: muted }}>{value}</Text> : null}
			<Text textStyle={{ color: muted }}>›</Text>
		</PressableRow>
	);
}

/** A label with a value readout flanked by −/＋ stepper buttons. */
export function NativeStepperRow({
	label,
	value,
	onDec,
	onInc,
	decDisabled,
	incDisabled,
}: {
	label: string;
	value: number | string;
	onDec: () => void;
	onInc: () => void;
	decDisabled?: boolean;
	incDisabled?: boolean;
}) {
	const display = typeof value === 'number' ? value.toLocaleString() : value;
	return (
		<LabeledRow label={label}>
			<Row alignment='center' spacing={8}>
				<Button
					variant='outlined'
					disabled={decDisabled}
					onPress={onDec}
					label='−'
				/>
				<Text>{display}</Text>
				<Button
					variant='outlined'
					disabled={incDisabled}
					onPress={onInc}
					label='+'
				/>
			</Row>
		</LabeledRow>
	);
}
