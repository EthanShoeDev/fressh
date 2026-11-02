import {
  createFormHook,
  createFormHookContexts,
  useSelector,
} from '@tanstack/react-form';
import * as Schema from 'effect/Schema';
import React from 'react';
import { Switch, TextInput, View } from 'react-native';

import { Button } from '@/components/themed/button';
import { ThemedText } from '@/components/themed/themed-text';

const isErrorWithMessage = Schema.is(Schema.Struct({ message: Schema.String }));

function FieldInfo() {
  const field = useFieldContext();
  const meta = field.state.meta as { errors?: unknown[] };
  const errs = meta.errors;
  let errorMessage: string | null = null;
  if (errs && errs.length > 0) {
    const first: unknown = errs[0];
    if (isErrorWithMessage(first)) {
      errorMessage = first.message;
    } else {
      errorMessage = String(first);
    }
  }

  return (
    <View className='mt-1.5'>
      {errorMessage !== null && errorMessage !== '' ? (
        <ThemedText className='text-danger text-xs'>{errorMessage}</ThemedText>
      ) : null}
    </View>
  );
}

const FIELD_LABEL_CLASS = 'mb-1.5 text-sm font-semibold text-text-secondary';
const TEXT_INPUT_CLASS =
  'rounded-[10px] border border-border bg-input-background px-3 py-3 text-base text-text-primary';

// https://tanstack.com/form/latest/docs/framework/react/quick-start
export function TextField(
  props: React.ComponentProps<typeof TextInput> & {
    label?: string;
  },
) {
  const { label, style, ...rest } = props;
  const field = useFieldContext<string>();

  return (
    <View className='mb-4'>
      {label !== undefined && label !== '' ? (
        <ThemedText className={FIELD_LABEL_CLASS}>{label}</ThemedText>
      ) : null}
      <TextInput
        className={TEXT_INPUT_CLASS}
        style={style}
        placeholderTextColorClassName='accent-muted'
        value={field.state.value}
        onChangeText={field.handleChange}
        onBlur={field.handleBlur}
        {...rest}
      />
      <FieldInfo />
    </View>
  );
}

export function NumberField(
  props: React.ComponentProps<typeof TextInput> & {
    label?: string;
  },
) {
  const {
    label,
    style,
    keyboardType,
    onChangeText: _onChangeText,
    ...rest
  } = props;
  const field = useFieldContext<number>();
  return (
    <View className='mb-4'>
      {label !== undefined && label !== '' ? (
        <ThemedText className={FIELD_LABEL_CLASS}>{label}</ThemedText>
      ) : null}
      <TextInput
        keyboardType={keyboardType ?? 'numeric'}
        className={TEXT_INPUT_CLASS}
        style={style}
        placeholderTextColorClassName='accent-muted'
        value={field.state.value.toString()}
        onChangeText={(text) => {
          field.handleChange(Number(text));
        }}
        onBlur={field.handleBlur}
        {...rest}
      />
      <FieldInfo />
    </View>
  );
}

export function SwitchField(
  props: React.ComponentProps<typeof Switch> & {
    label?: string;
  },
) {
  const { label, ...rest } = props;
  const field = useFieldContext<boolean>();

  return (
    <View className='mb-4'>
      {label !== undefined && label !== '' ? (
        <ThemedText className={FIELD_LABEL_CLASS}>{label}</ThemedText>
      ) : null}
      <Switch
        value={field.state.value}
        onChange={(event) => {
          field.handleChange(event.nativeEvent.value);
        }}
        onBlur={field.handleBlur}
        {...rest}
      />
    </View>
  );
}

export function SubmitButton(props: {
  onPress?: () => void;
  title?: string;
  submittingTitle?: string;
  disabled?: boolean;
  testID?: string;
}) {
  const {
    onPress,
    title = 'Connect',
    submittingTitle,
    disabled,
    testID,
  } = props;
  const formContext = useFormContext();
  const isSubmitting = useSelector(
    formContext.store,
    (state) => state.isSubmitting,
  );
  return (
    <Button
      testID={testID}
      title={title}
      loading={isSubmitting}
      loadingTitle={submittingTitle ?? 'Connecting...'}
      disabled={disabled}
      onPress={onPress}
    />
  );
}

const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

// oxlint-disable-next-line react/only-export-components -- servers/connect.tsx imports these hooks from here; splitting them out needs that importer updated
export { useFieldContext, useFormContext };
// https://tanstack.com/form/latest/docs/framework/react/quick-start
// oxlint-disable-next-line react/only-export-components -- same: useAppForm is imported from this module by servers/connect.tsx
export const { useAppForm, withForm, withFieldGroup } = createFormHook({
  fieldComponents: {
    TextField,
    NumberField,
    SwitchField,
  },
  formComponents: {
    SubmitButton,
  },
  fieldContext,
  formContext,
});
