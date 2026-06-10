import { type ReactNode, useEffect, useState } from 'react';
import {
	type DimensionValue,
	Modal,
	Pressable,
	useWindowDimensions,
	View,
} from 'react-native';
import { KeyboardEvents } from 'react-native-keyboard-controller';
import { useCSSVariable } from 'uniwind';
import { useThemeSkin } from '@/lib/theme-skin';

/**
 * A slide-up modal sheet with a scrim + drag handle. Shared by the Keys manager,
 * the terminal context-bar details, and the command runner. Always visible while
 * mounted — the caller controls presence.
 *
 * Keyboard-aware: RN `Modal` windows don't resize for the soft keyboard on Android,
 * so a bottom-anchored sheet would be covered. We read the settled keyboard height
 * from the global `KeyboardEvents` listener (fires regardless of the Modal window)
 * and lift the sheet above it, capping its max height to the visible area so the
 * top never clips. Same approach the terminal screen uses for its toolbar.
 */
export function BottomSheet({
	onClose,
	children,
	maxHeightPct,
}: {
	onClose: () => void;
	children: ReactNode;
	maxHeightPct?: number;
}) {
	const skin = useThemeSkin();
	const surface = useCSSVariable('--color-surface') as string;
	const border = useCSSVariable('--color-border-strong') as string;
	const { height: screenHeight } = useWindowDimensions();

	const [keyboardHeight, setKeyboardHeight] = useState(0);
	useEffect(() => {
		const show = KeyboardEvents.addListener('keyboardDidShow', (e) =>
			setKeyboardHeight(e.height),
		);
		const hide = KeyboardEvents.addListener('keyboardDidHide', () =>
			setKeyboardHeight(0),
		);
		return () => {
			show.remove();
			hide.remove();
		};
	}, []);

	const maxHeight: DimensionValue | undefined =
		keyboardHeight > 0
			? screenHeight - keyboardHeight - 40
			: maxHeightPct
				? `${maxHeightPct}%`
				: undefined;

	return (
		<Modal transparent visible animationType='slide' onRequestClose={onClose}>
			<View className='flex-1 justify-end'>
				<Pressable className='absolute inset-0 bg-overlay' onPress={onClose} />
				<View
					style={{
						backgroundColor: surface,
						borderColor: border,
						borderWidth: 1,
						borderTopLeftRadius: skin.radius + 4,
						borderTopRightRadius: skin.radius + 4,
						marginBottom: keyboardHeight,
						maxHeight,
					}}
				>
					<View
						style={{
							width: 40,
							height: 4,
							borderRadius: 2,
							backgroundColor: border,
							alignSelf: 'center',
							marginTop: 10,
							marginBottom: 4,
						}}
					/>
					{children}
				</View>
			</View>
		</Modal>
	);
}
