import { FieldGroup, Host, Text } from '@expo/ui';
import { isValidElement, type ReactNode } from 'react';
import { useCSSVariable, useUniwind } from 'uniwind';

// The settings rows are platform-agnostic; only this file's form container and
// section grouping are iOS-specific (SwiftUI `FieldGroup`). See
// `native-controls-rows` for the rows and the Android `NativeSection`.
export {
	NativeNavRow,
	NativeSegmentedRow,
	NativeSelectRow,
	NativeStepperRow,
	NativeToggleRow,
} from '@/components/native-controls-rows';

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
	const muted = useCSSVariable('--color-muted') as string;
	return (
		<Host style={{ flex: 1 }} colorScheme={colorScheme}>
			<FieldGroup>{resolveSections(children, muted)}</FieldGroup>
		</Host>
	);
}

type NativeSectionProps = {
	title?: string;
	footer?: string;
	children: ReactNode;
};

/**
 * Rewrite `<NativeSection>` children into REAL `FieldGroup.Section` elements.
 * Android's `FieldGroup` groups its children by element-type identity
 * (`child.type === FieldGroup.Section` in @expo/ui's groupFieldGroupChildren);
 * a wrapper component fails that check, so every `NativeSection` was treated
 * as a loose row and wrapped in an extra Material `ListItem` card — each whole
 * section got ListItem padding/min-height, which read as huge dead gaps
 * between groups. (iOS never noticed: SwiftUI `Form` resolves wrapper
 * components natively.) Recurses into arrays so conditional lists still work.
 */
function resolveSections(
	children: ReactNode,
	muted: string,
	index?: number,
): ReactNode {
	if (Array.isArray(children)) {
		return (children as ReactNode[]).map((child, i) =>
			resolveSections(child, muted, i),
		);
	}
	if (!isValidElement(children) || children.type !== NativeSection) {
		return children;
	}
	const {
		title,
		footer,
		children: rows,
	} = children.props as NativeSectionProps;
	// @expo/ui's slot extractor pushes EVERY non-element child — including the
	// `null` of a `{cond ? <Row/> : null}` — as a row, and each row becomes a
	// Material ListItem, so a stray null renders as an empty settings row.
	// Filter them out (the elements keep their identity, so no key churn).
	const rowList = (Array.isArray(rows) ? (rows as ReactNode[]) : [rows]).filter(
		(row) => row !== null && row !== undefined && typeof row !== 'boolean',
	);
	// Static JSX siblings carry no key (null), so fall back to the array
	// position, like React's own implicit keying. The element identity
	// (FieldGroup.Section) is the whole point here — it must be the DIRECT
	// child the FieldGroup sees, not hidden behind another wrapper component.
	// The footer branch duplicates the Section instead of embedding
	// `{footer ? … : null}` — that null would itself become an empty row.
	const key = children.key ?? index;
	if (!footer) {
		return (
			<FieldGroup.Section key={key} title={title}>
				{rowList}
			</FieldGroup.Section>
		);
	}
	return (
		<FieldGroup.Section key={key} title={title}>
			{rowList}
			<FieldGroup.SectionFooter>
				<Text textStyle={{ fontSize: 13, color: muted }}>{footer}</Text>
			</FieldGroup.SectionFooter>
		</FieldGroup.Section>
	);
}

/** A grouped (inset card) section inside a {@link NativeForm}, with an optional
 *  muted footer — the native section-footer idiom for explanatory prose.
 *  MUST be a direct child of `NativeForm`, which replaces it with a real
 *  `FieldGroup.Section` (see {@link resolveSections}) — this component itself
 *  never renders there. */
export function NativeSection({ title, footer, children }: NativeSectionProps) {
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
