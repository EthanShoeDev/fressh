import * as Arr from 'effect/Array';
import * as Predicate from 'effect/Predicate';
import { type Href, Link } from 'expo-router';
import { Pressable, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed/themed-text';

/** Section wrapper with a muted heading. */
export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className='mb-6'>
      <ThemedText className='text-text-secondary mb-2 text-sm'>
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <ThemedText className='text-text-secondary mt-2 text-[13px]'>
      {children}
    </ThemedText>
  );
}

/** Bordered surface card used by the stepper/toggle rows. */
export function Card({ children }: { children: React.ReactNode }) {
  return (
    <View className='bg-surface flex-row items-center justify-between rounded-[10px] border border-border px-3 py-3'>
      {children}
    </View>
  );
}

export function StepperRow({
  label,
  value,
  onDec,
  onInc,
  decDisabled,
  incDisabled,
}: {
  label: string;
  /** A number (rendered via `toLocaleString`) or a preformatted display string. */
  value: number | string;
  onDec: () => void;
  onInc: () => void;
  decDisabled?: boolean;
  incDisabled?: boolean;
}) {
  return (
    <Card>
      <ThemedText className='text-text-primary text-base font-semibold'>
        {label}
      </ThemedText>
      <View className='flex-row items-center gap-4'>
        <StepperButton
          label='−'
          accessibilityLabel={`Decrease ${label}`}
          disabled={decDisabled}
          onPress={onDec}
        />
        <ThemedText className='text-text-primary min-w-[56px] text-center text-base font-bold'>
          {Predicate.isNumber(value) ? value.toLocaleString() : value}
        </ThemedText>
        <StepperButton
          label='+'
          accessibilityLabel={`Increase ${label}`}
          disabled={incDisabled}
          onPress={onInc}
        />
      </View>
    </Card>
  );
}

export function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Card>
      <ThemedText className='text-text-primary text-base font-semibold'>
        {label}
      </ThemedText>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
      />
    </Card>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <View className='bg-surface flex-row gap-[6px] rounded-[10px] border border-border p-1'>
      {Arr.map(options, (option) => {
        const selected = option.id === value;
        return (
          <Pressable
            key={option.id}
            onPress={() => {
              onChange(option.id);
            }}
            accessibilityRole='button'
            accessibilityState={{ selected }}
            className={
              selected
                ? 'flex-1 items-center justify-center rounded-lg bg-primary py-2'
                : 'flex-1 items-center justify-center rounded-lg bg-transparent py-2'
            }
          >
            {/* Truncate instead of wrapping — the flex-1 segments get narrow on
						    small devices and a two-line label makes the row lopsided. */}
            <ThemedText
              numberOfLines={1}
              className={
                selected
                  ? 'text-sm font-semibold text-background'
                  : 'text-text-primary text-sm font-semibold'
              }
            >
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function StepperButton({
  label,
  disabled,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  disabled?: boolean | undefined;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole='button'
      accessibilityLabel={accessibilityLabel}
      className='h-10 w-10 items-center justify-center rounded-[10px] border border-border bg-background disabled:opacity-40'
    >
      <ThemedText className='text-text-primary text-[22px] font-bold'>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export function SelectRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={
        selected === true
          ? 'bg-surface flex-row items-center justify-between rounded-[10px] border border-primary px-3 py-3'
          : 'bg-surface flex-row items-center justify-between rounded-[10px] border border-border px-3 py-3'
      }
      accessibilityRole='button'
      accessibilityState={{ selected }}
    >
      <ThemedText className='text-text-primary text-base font-semibold'>
        {label}
      </ThemedText>
      <ThemedText className='text-base font-extrabold text-primary'>
        {selected === true ? '✔' : ''}
      </ThemedText>
    </Pressable>
  );
}

/** Row that links to a settings sub-screen (chevron on the right). */
export function LinkRow({ href, label }: { href: Href; label: string }) {
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole='button'
        className='bg-surface flex-row items-center justify-between rounded-xl border border-border px-3 py-3.5'
      >
        <ThemedText className='text-text-primary text-base font-semibold'>
          {label}
        </ThemedText>
        <ThemedText className='px-1 text-[22px] text-muted'>›</ThemedText>
      </Pressable>
    </Link>
  );
}
