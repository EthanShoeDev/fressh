import {
	createFormHook,
	createFormHookContexts,
	useStore,
} from '@tanstack/react-form';
import {
	Pressable,
	Switch,
	Text,
	TextInput,
	View,
	StyleSheet,
} from 'react-native';

function FieldInfo() {
	const field = useFieldContext();
	const meta = field.state.meta;
	const errorMessage = meta?.errors?.[0]; // TODO: typesafe errors

	return (
		<View style={{ marginTop: 6 }}>
			{errorMessage ? (
				<Text style={{ color: '#FCA5A5', fontSize: 12 }}>
					{String(errorMessage)}
				</Text>
			) : null}
		</View>
	);
}

// https://tanstack.com/form/latest/docs/framework/react/quick-start
export function TextField(
	props: React.ComponentProps<typeof TextInput> & {
		label?: string;
	},
) {
	const { label, style, ...rest } = props;
	const field = useFieldContext<string>();

	return (
		<View style={{ marginBottom: 16 }}>
			{label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
			<TextInput
				style={[
					{
						borderWidth: 1,
						borderColor: '#2A3655',
						backgroundColor: '#0E172B',
						color: '#E5E7EB',
						borderRadius: 10,
						paddingHorizontal: 12,
						paddingVertical: 12,
						fontSize: 16,
					},
					style,
				]}
				placeholderTextColor="#9AA0A6"
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
	const { label, style, keyboardType, onChangeText, ...rest } = props;
	const field = useFieldContext<number>();
	return (
		<View style={{ marginBottom: 16 }}>
			{label ? (
				<Text
					style={{
						marginBottom: 6,
						fontSize: 14,
						color: '#C6CBD3',
						fontWeight: '600',
					}}
				>
					{label}
				</Text>
			) : null}
			<TextInput
				keyboardType={keyboardType ?? 'numeric'}
				style={[
					{
						borderWidth: 1,
						borderColor: '#2A3655',
						backgroundColor: '#0E172B',
						color: '#E5E7EB',
						borderRadius: 10,
						paddingHorizontal: 12,
						paddingVertical: 12,
						fontSize: 16,
					},
					style,
				]}
				placeholderTextColor="#9AA0A6"
				value={field.state.value.toString()}
				onChangeText={(text) => field.handleChange(Number(text))}
				onBlur={field.handleBlur}
				{...rest}
			/>
			<FieldInfo />
		</View>
	);
}

const styles = StyleSheet.create({
	fieldLabel: {
		marginBottom: 6,
		color: '#C6CBD3',
		fontWeight: '600',
		fontSize: 14,
	},
});

export function SwitchField(
	props: React.ComponentProps<typeof Switch> & {
		label?: string;
	},
) {
	const { label, style, ...rest } = props;
	const field = useFieldContext<boolean>();

	return (
		<View style={{ marginBottom: 16 }}>
			{label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
			<Switch
				style={[
					{
						borderWidth: 1,
						borderColor: '#2A3655',
						backgroundColor: '#0E172B',
						borderRadius: 10,
						paddingHorizontal: 12,
						paddingVertical: 12,
					},
					style,
				]}
				value={field.state.value}
				onChange={(event) => field.handleChange(event.nativeEvent.value)}
				onBlur={field.handleBlur}
				{...rest}
			/>
		</View>
	);
}

export function SubmitButton(
	props: {
		onPress?: () => void;
		title?: string;
		disabled?: boolean;
	} & React.ComponentProps<typeof Pressable>,
) {
	const { onPress, title = 'Connect', disabled, ...rest } = props;
	const formContext = useFormContext();
	const isSubmitting = useStore(
		formContext.store,
		(state) => state.isSubmitting,
	);
	return (
		<Pressable
			{...rest}
			style={[
				{
					backgroundColor: '#2563EB',
					borderRadius: 10,
					paddingVertical: 14,
					alignItems: 'center',
				},
				disabled ? { backgroundColor: '#3B82F6', opacity: 0.6 } : undefined,
			]}
			onPress={onPress}
			disabled={disabled || isSubmitting}
		>
			<Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 16 }}>
				{isSubmitting ? 'Connecting...' : title}
			</Text>
		</Pressable>
	);
}

const { fieldContext, formContext, useFieldContext, useFormContext } =
	createFormHookContexts();

export { useFieldContext, useFormContext };
// https://tanstack.com/form/latest/docs/framework/react/quick-start
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

// Styles inlined per component
