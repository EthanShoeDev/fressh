import type React from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { useThemeSkin } from '@/lib/theme-skin';

/**
 * A slide-up modal sheet with a scrim + drag handle. Shared by the Keys manager,
 * the terminal context-bar details, and (later) the AI / git sheets. Always
 * visible while mounted — the caller controls presence.
 */
export function BottomSheet({
	onClose,
	children,
	maxHeightPct,
}: {
	onClose: () => void;
	children: React.ReactNode;
	maxHeightPct?: number;
}) {
	const skin = useThemeSkin();
	const surface = useCSSVariable('--color-surface') as string;
	const border = useCSSVariable('--color-border-strong') as string;
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
						maxHeight: maxHeightPct ? `${maxHeightPct}%` : undefined,
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
