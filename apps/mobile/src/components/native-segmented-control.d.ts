import type { ReactElement } from 'react';

/**
 * A real native segmented control (SwiftUI segmented `Picker` on iOS, Material 3
 * `SingleChoiceSegmentedButtonRow` on Android) — the proper replacement for the
 * dropdown menu `Picker` when a choice has a handful of options. The two platform
 * APIs differ enough that this ships as `.ios.tsx` / `.android.tsx`; this
 * declaration is what tsgo resolves for the shared shape. Render only inside a
 * native `<Host>` (e.g. inside `NativeForm`).
 */
export declare function NativeSegmentedControl<T extends string>(props: {
	options: readonly { id: T; label: string }[];
	value: T;
	onChange: (id: T) => void;
}): ReactElement;
