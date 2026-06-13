import { Button, Column, Host, Row, Spacer, Switch, Text } from '@expo/ui';
import { LazyColumn, ListItem, useMaterialColors } from '@expo/ui/jetpack-compose';
import {
	background,
	clickable,
	clip,
	fillMaxWidth,
	padding,
	Shapes,
} from '@expo/ui/jetpack-compose/modifiers';
import { isValidElement, type ReactNode } from 'react';
import { useCSSVariable, useUniwind } from 'uniwind';
import { NativeSegmentedControl } from '@/components/native-segmented-control';

/**
 * ANDROID native settings UI. The iOS version (`native-controls.tsx`) uses
 * `@expo/ui` `FieldGroup`, whose SwiftUI `Form` already hit-tests whole rows.
 * Android's `FieldGroup.Section`, by contrast, wraps every row in a Material
 * `ListItem` that is NOT clickable and puts our press target inside the padded
 * headline slot — so taps/ripple only covered a thin inset strip
 * (`ListItemView.kt` applies the `clickable` modifier to the ListItem itself,
 * but `FieldGroup.Section` never sets it; there is no escape hatch and no
 * upstream issue, confirmed 2026-06-12).
 *
 * So on Android we rebuild the grouped form ourselves from the SAME Compose
 * primitives `FieldGroup`/`FieldSection` use (`LazyColumn` + `ListItem` +
 * `clip`/`useMaterialColors`), mirroring their Material-3 "connected list" look
 * (per-position corner radii, 2dp gaps, surfaceContainer rows) — but each row's
 * `ListItem` carries the `clickable` modifier, giving the full-bleed ripple and
 * touch target. No native module needed: every primitive is already exposed as
 * JS by `@expo/ui`.
 *
 * HARD LAYOUT RULE (see native-ui-theme doc): exactly ONE `<Host>` per screen,
 * outermost; the scroller lives inside it. Never nest `<Host>` in a ScrollView
 * or give each control its own Host — re-entrant Compose measure crashes.
 */

/** The full-screen native form: `<Host flex:1>` → self-scrolling `LazyColumn`. */
export function NativeForm({ children }: { children: ReactNode }) {
	// Pass the scheme explicitly (the Compose host doesn't reliably follow
	// `Appearance.setColorScheme`'s override); `native-light` is the only light
	// variant, every other resolved theme is dark.
	const { theme } = useUniwind();
	const colorScheme = theme === 'native-light' ? 'light' : 'dark';
	return (
		<Host style={{ flex: 1 }} colorScheme={colorScheme}>
			<FormBody>{children}</FormBody>
		</Host>
	);
}

/** The scrolling container, rendered INSIDE `<Host>` so `useMaterialColors`
 *  resolves against the host's theme (mirrors `FieldGroup.android`). */
function FormBody({ children }: { children: ReactNode }) {
	const colors = useMaterialColors();
	return (
		<LazyColumn
			verticalArrangement={{ spacedBy: 24 }}
			contentPadding={{ start: 16, end: 16, top: 16, bottom: 16 }}
			modifiers={[background(colors.surface)]}
		>
			{children}
		</LazyColumn>
	);
}

type NativeSectionProps = {
	title?: string;
	footer?: string;
	children: ReactNode;
};

/** A grouped section: optional title, a connected list of rows, optional footer.
 *  Each row child is wrapped in a position-clipped `ListItem`; if the child
 *  carries an `onPress`, that ListItem becomes `clickable` (full-row ripple). */
export function NativeSection({ title, footer, children }: NativeSectionProps) {
	const colors = useMaterialColors();
	const muted = useCSSVariable('--color-muted') as string;
	// A `{cond ? <Row/> : null}` child would otherwise render as an empty row.
	const rows = (Array.isArray(children) ? children : [children]).filter(
		(row): row is ReactNode =>
			row !== null && row !== undefined && typeof row !== 'boolean',
	);
	return (
		<Column spacing={4} modifiers={[fillMaxWidth()]}>
			{title ? (
				<Column modifiers={[padding(16, 0, 16, 8)]}>
					<Text textStyle={{ fontSize: 14, fontWeight: '600', color: muted }}>
						{title}
					</Text>
				</Column>
			) : null}
			<Column spacing={2} modifiers={[fillMaxWidth()]}>
				{rows.map((child, i) => {
					const position = getFieldItemPosition(i, rows.length);
					const onPress = isValidElement<{ onPress?: () => void }>(child)
						? child.props.onPress
						: undefined;
					const modifiers = [
						fillMaxWidth(),
						clip(Shapes.RoundedCorner(cornerRadii(position))),
						...(onPress ? [clickable(onPress)] : []),
					];
					return (
						<ListItem
							// Rows are a fixed per-section list; index is a stable identity.
							key={i}
							colors={{ containerColor: colors.surfaceContainer }}
							modifiers={modifiers}
						>
							<ListItem.HeadlineContent>{child}</ListItem.HeadlineContent>
						</ListItem>
					);
				})}
			</Column>
			{footer ? (
				<Column modifiers={[padding(16, 4, 16, 0)]}>
					<Text textStyle={{ fontSize: 13, color: muted }}>{footer}</Text>
				</Column>
			) : null}
		</Column>
	);
}

/** Material-3 connected-list corner radii by row position (mirrors
 *  `@expo/ui`'s `FieldSection.android`): fully rounded at the section's outer
 *  ends, slightly rounded between rows. */
const FULL = 20;
const SMALL = 4;
const CORNER_RADII = {
	only: { topStart: FULL, topEnd: FULL, bottomStart: FULL, bottomEnd: FULL },
	leading: { topStart: FULL, topEnd: FULL, bottomStart: SMALL, bottomEnd: SMALL },
	trailing: { topStart: SMALL, topEnd: SMALL, bottomStart: FULL, bottomEnd: FULL },
	middle: { topStart: SMALL, topEnd: SMALL, bottomStart: SMALL, bottomEnd: SMALL },
} as const;

function cornerRadii(position: keyof typeof CORNER_RADII) {
	return CORNER_RADII[position];
}

function getFieldItemPosition(index: number, total: number) {
	if (total <= 1) {
		return 'only' as const;
	}
	if (index === 0) {
		return 'leading' as const;
	}
	if (index === total - 1) {
		return 'trailing' as const;
	}
	return 'middle' as const;
}

// --- Rows -------------------------------------------------------------------
// Rows render only their VISUAL content (label + trailing) and fill the row
// width so the trailing `Spacer` pushes the control to the edge. Interactivity
// for tappable rows lives on the wrapping `ListItem` (NativeSection reads the
// row element's `onPress` and applies `clickable`), which is what gives the
// edge-to-edge ripple — so these rows never set `onPress` on their own `Row`.

/** `label … <trailing control>` — the standard settings row layout. */
function LabeledRow({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<Row alignment='center' spacing={12} modifiers={[fillMaxWidth()]}>
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
	label?: string;
	options: readonly { id: T; label: string }[];
	value: T;
	onChange: (id: T) => void;
	layout?: 'stack' | 'inline';
}) {
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
		<Column spacing={6} alignment='start' modifiers={[fillMaxWidth()]}>
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
}: {
	label: string;
	selected?: boolean;
	/** Read by {@link NativeSection} and applied to the row's `ListItem`. */
	onPress: () => void;
}) {
	const primary = useCSSVariable('--color-primary') as string;
	return (
		<Row alignment='center' spacing={12} modifiers={[fillMaxWidth()]}>
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
 *  muted current-value readout before the chevron. */
export function NativeNavRow({
	label,
	value,
}: {
	label: string;
	value?: string;
	/** Read by {@link NativeSection} and applied to the row's `ListItem`. */
	onPress: () => void;
}) {
	const muted = useCSSVariable('--color-muted') as string;
	return (
		<Row alignment='center' spacing={12} modifiers={[fillMaxWidth()]}>
			<Text>{label}</Text>
			<Spacer flexible />
			{value ? <Text textStyle={{ color: muted }}>{value}</Text> : null}
			<Text textStyle={{ color: muted }}>›</Text>
		</Row>
	);
}
