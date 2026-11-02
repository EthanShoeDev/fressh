import { FieldGroup, Text } from '@expo/ui';
import * as Arr from 'effect/Array';
import * as Predicate from 'effect/Predicate';
import { isValidElement, type ReactNode } from 'react';
import { useCSSVariable } from 'uniwind';

import { NativeFormHost, type NativeFormProps } from './native-form-host';

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
export function NativeForm({ children }: NativeFormProps) {
  const muted = useCSSVariable('--color-muted') as string;
  return (
    <NativeFormHost>
      <FieldGroup>{resolveSections(children, muted)}</FieldGroup>
    </NativeFormHost>
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
  if (Arr.isArray(children)) {
    return Arr.map(children as ReactNode[], (child, i) =>
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
  const rowList = Arr.filter(
    Arr.isArray(rows) ? (rows as ReactNode[]) : [rows],
    (row) => row !== null && row !== undefined && !Predicate.isBoolean(row),
  );
  // Static JSX siblings carry no key (null), so fall back to the array
  // position, like React's own implicit keying. The element identity
  // (FieldGroup.Section) is the whole point here — it must be the DIRECT
  // child the FieldGroup sees, not hidden behind another wrapper component.
  // The footer branch duplicates the Section instead of embedding
  // `{footer ? … : null}` — that null would itself become an empty row.
  const key = children.key ?? index;
  if (footer === undefined || footer === '') {
    return (
      <FieldGroup.Section
        key={key}
        {...(title !== undefined && title !== '' ? { title } : {})}
      >
        {rowList}
      </FieldGroup.Section>
    );
  }
  return (
    <FieldGroup.Section
      key={key}
      {...(title !== undefined && title !== '' ? { title } : {})}
    >
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
    <FieldGroup.Section
      {...(title !== undefined && title !== '' ? { title } : {})}
    >
      {children}
      {footer !== undefined && footer !== '' ? (
        <FieldGroup.SectionFooter>
          <Text textStyle={{ fontSize: 13, color: muted }}>{footer}</Text>
        </FieldGroup.SectionFooter>
      ) : null}
    </FieldGroup.Section>
  );
}
