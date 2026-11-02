import * as Match from 'effect/Match';
import * as Predicate from 'effect/Predicate';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { applyCase, resolveFont, useThemeSkin } from '@/lib/theme-skin';

export type ButtonVariant = 'primary' | 'outline' | 'danger';
export type ButtonSize = 'md' | 'sm';

/**
 * The single theme-aware button used across every screen. Corner radius, casing,
 * and monospace voice come from the active theme's skin, so a primary action
 * looks identical (sharp lime on Monolith, glowing teal on Aurora, …) whether
 * it's on the server detail, the Keys tab, or a form. Primary buttons on glow
 * themes get the skin's static `boxShadow` bloom; Monolith has no glow by
 * design. (The previous *animated* glow — react-native-animated-glow — was a
 * continuously-repainting Skia layer per button, one of the two suspects in the
 * Android tab-switch lag; see themes-refactor.md problem 5.)
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  loadingTitle,
  icon,
  testID,
  className,
}: {
  title: string;
  onPress?: (() => void) | undefined;
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  disabled?: boolean | undefined;
  loading?: boolean | undefined;
  loadingTitle?: string | undefined;
  icon?: React.ReactNode | undefined;
  testID?: string | undefined;
  /** Extra layout classes (e.g. `flex-1`, `mt-4`); visual style is owned by the variant. */
  className?: string | undefined;
}) {
  const skin = useThemeSkin();
  const isDisabled = disabled || loading;

  const bg = Match.value(variant).pipe(
    Match.when('primary', () =>
      isDisabled ? 'bg-primary-disabled' : 'bg-primary',
    ),
    Match.when('danger', () => 'border border-danger bg-transparent'),
    Match.when('outline', () => 'border border-border bg-transparent'),
    Match.exhaustive,
  );

  const textClass = Match.value(variant).pipe(
    Match.when('primary', () => 'font-bold text-button-text-on-primary'),
    Match.when('danger', () => 'font-bold text-danger'),
    Match.when('outline', () => 'font-semibold text-text-secondary'),
    Match.exhaustive,
  );

  const pad = size === 'sm' ? 'px-3 py-2.5' : 'px-4 py-3.5';
  const textSize = size === 'sm' ? 'text-xs' : 'text-[15px]';
  const indicatorClass =
    variant === 'primary' ? 'accent-button-text-on-primary' : 'accent-muted';

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      className={`flex-row items-center justify-center gap-2 ${pad} ${bg} ${isDisabled ? 'opacity-60' : ''} ${className ?? ''}`}
      style={{
        borderRadius: skin.controlRadius,
        boxShadow:
          variant === 'primary' && !isDisabled && skin.glow
            ? skin.glow
            : undefined,
      }}
    >
      {loading ? (
        <ActivityIndicator colorClassName={indicatorClass} />
      ) : Predicate.isTruthy(icon) ? (
        <View>{icon}</View>
      ) : null}
      <Text
        className={`${textClass} ${textSize} tracking-[0.3px]`}
        style={{
          fontFamily: resolveFont(skin, { mono: skin.mono, weight: '700' }),
        }}
      >
        {applyCase(skin, loading ? (loadingTitle ?? title) : title)}
      </Text>
    </Pressable>
  );
}
