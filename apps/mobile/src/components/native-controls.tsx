import {
	Button,
	Column,
	FieldGroup,
	Host,
	Row,
	Spacer,
	Switch,
	Text,
} from '@expo/ui';
import type { ReactNode } from 'react';
import { useCSSVariable, useUniwind } from 'uniwind';
import { NativeSegmentedControl } from '@/components/native-segmented-control';

/**
 * The Native theme's UI, built from real platform controls via `@expo/ui` —
 * SwiftUI on iOS, Jetpack Compose on Android. The other themes keep their
 * custom-drawn (Pressable) controls; the settings screens render this tree only
 * when the Native theme is active (they branch at the top via `useIsNativeTheme`
 * into a separate component, so hook order stays stable across theme switches).
 * All `@expo/ui` usage is contained in THIS file.
 *
 * HARD LAYOUT RULE (learned the hard way — see native-ui-theme doc): there is
 * exactly ONE `<Host>` per screen and it is the OUTERMOST native element
 * (`<Host style={{ flex: 1 }}>`); the `FieldGroup` inside scrolls itself. Do NOT
 * nest a `<Host>` inside an RN `ScrollView`, do NOT use `matchContents`, and do
 * NOT give each control its own host — any of those triggers a re-entrant Compose
 * measure ("layout state is not idle before measure starts") and crashes Android.
 * RN chrome (screen header, the terminal preview) lives ABOVE the `<Host>`.
 */

/**
 * The full-screen native form: `<Host flex:1>` → self-scrolling `FieldGroup`.
 * Children are `NativeSection`s. Place RN header/preview above this, not inside.
 */
export function NativeForm({ children }: { children: ReactNode }) {
	// Pass the scheme explicitly, derived from the RESOLVED uniwind theme (the
	// same source the color tokens use): the SwiftUI/Compose host does not
	// reliably follow `Appearance.setColorScheme`'s window override, so a forced
	// Light/Dark (the Appearance pref) flipped the RN chrome but left the form
	// on the device scheme. `native-light` is the only light variant; every
	// other resolved theme (native dark + the stylized themes) is dark.
	const { theme } = useUniwind();
	const colorScheme = theme === 'native-light' ? 'light' : 'dark';
	return (
		<Host style={{ flex: 1 }} colorScheme={colorScheme}>
			<FieldGroup>{children}</FieldGroup>
		</Host>
	);
}

/** A grouped (inset card) section inside a {@link NativeForm}, with an optional
 *  muted footer — the native section-footer idiom for explanatory prose. */
export function NativeSection({
	title,
	footer,
	children,
}: {
	title?: string;
	footer?: string;
	children: ReactNode;
}) {
	const muted = useCSSVariable('--color-muted') as string;
	return (
		<FieldGroup.Section title={title}>
			{children}
			{footer ? (
				<FieldGroup.SectionFooter>
					<Text textStyle={{ fontSize: 13, color: muted }}>{footer}</Text>
				</FieldGroup.SectionFooter>
			) : null}
		</FieldGroup.Section>
	);
}

/** `label … <trailing control>` — the standard settings row layout. */
function LabeledRow({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<Row alignment='center' spacing={12}>
			<Text>{label}</Text>
			<Spacer flexible />
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
		<Column spacing={6} alignment='start'>
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
	onPress: () => void;
}) {
	// Tint the checkmark with the (system) primary; the label defers to the
	// platform's default label color.
	const primary = useCSSVariable('--color-primary') as string;
	return (
		<Row onPress={onPress} alignment='center' spacing={12}>
			<Text>{label}</Text>
			<Spacer flexible />
			{selected ? (
				<Text textStyle={{ color: primary, fontWeight: '600' }}>✓</Text>
			) : null}
		</Row>
	);
}

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

/** A tappable row that navigates elsewhere (trailing chevron), with an optional
 *  muted current-value readout before the chevron — the settings-row idiom. */
export function NativeNavRow({
	label,
	value,
	onPress,
}: {
	label: string;
	value?: string;
	onPress: () => void;
}) {
	const muted = useCSSVariable('--color-muted') as string;
	return (
		<Row onPress={onPress} alignment='center' spacing={12}>
			<Text>{label}</Text>
			<Spacer flexible />
			{value ? <Text textStyle={{ color: muted }}>{value}</Text> : null}
			<Text textStyle={{ color: muted }}>›</Text>
		</Row>
	);
}
