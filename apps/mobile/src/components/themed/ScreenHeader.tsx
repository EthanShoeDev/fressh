import { FontAwesome6 } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { applyCase, useThemeSkin } from '@/lib/theme-skin';

/**
 * The inline route header used on every screen, rendered ON the themed gradient
 * canvas (no opaque native bar) so the background bleeds through — matching the
 * design's full-bleed look. The title carries the full per-theme treatment:
 * Monolith's heavy ALL-CAPS display + hairline rule, Phosphor's lowercase mono,
 * Aurora's neon-glow, etc. (see `theme-skin.ts` title fields).
 */
export function ScreenHeader({
	title,
	subtitle,
	onBack,
	right,
}: {
	title: string;
	subtitle?: string;
	onBack?: () => void;
	right?: React.ReactNode;
}) {
	const skin = useThemeSkin();
	const textPrimary = useCSSVariable('--color-text-primary') as string;
	const mutedColor = useCSSVariable('--color-muted') as string;
	const borderStrong = useCSSVariable('--color-border-strong') as string;

	return (
		<View
			className='px-5 pt-2'
			style={
				skin.headerRule
					? { borderBottomWidth: 1, borderBottomColor: borderStrong }
					: undefined
			}
		>
			<View className='flex-row items-center gap-3 pb-3'>
				{onBack ? (
					<Pressable onPress={onBack} hitSlop={12} accessibilityLabel='Back'>
						<FontAwesome6
							name='chevron-left'
							size={18}
							color={textPrimary}
						/>
					</Pressable>
				) : null}
				<View className='min-w-0 flex-1'>
					<Text
						numberOfLines={1}
						style={{
							fontSize: skin.titleSize,
							fontWeight: skin.titleWeight,
							letterSpacing: skin.titleTracking,
							color: textPrimary,
							fontFamily:
								skin.titleFamily ??
								(skin.titleMono ? skin.monoFamily : skin.bodyFamily),
							...(skin.titleGlow
								? {
										textShadowColor: skin.titleGlow,
										textShadowRadius: 18,
										textShadowOffset: { width: 0, height: 0 },
									}
								: {}),
						}}
					>
						{applyCase(skin, title)}
					</Text>
					{subtitle ? (
						<Text
							numberOfLines={1}
							className='mt-1'
							style={{
								fontSize: 12,
								color: mutedColor,
								fontFamily: skin.mono ? skin.monoFamily : skin.bodyFamily,
								letterSpacing: skin.mono ? 1 : 0,
							}}
						>
							{applyCase(skin, subtitle)}
						</Text>
					) : null}
				</View>
				{right ?? null}
			</View>
		</View>
	);
}
