import { Picker } from '@react-native-picker/picker';
import {
	createFormHook,
	createFormHookContexts,
	useStore,
} from '@tanstack/react-form';
import {
	Pressable,
	StyleSheet,
	Switch,
	Text,
	TextInput,
	View,
} from 'react-native';

function FieldInfo() {
	const field = useFieldContext();
	const meta = field.state.meta;
	const errorMessage = meta?.errors?.[0]; // TODO: typesafe errors

	return (
		<View style={styles.fieldInfo}>
			{errorMessage ? (
				<Text style={styles.errorText}>{String(errorMessage)}</Text>
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
		<View style={styles.inputGroup}>
			{label ? <Text style={styles.label}>{label}</Text> : null}
			<TextInput
				style={[styles.input, style]}
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
		<View style={styles.inputGroup}>
			{label ? <Text style={styles.label}>{label}</Text> : null}
			<TextInput
				keyboardType={keyboardType ?? 'numeric'}
				style={[styles.input, style]}
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

export function SwitchField(
	props: React.ComponentProps<typeof Switch> & {
		label?: string;
	},
) {
	const { label, style, ...rest } = props;
	const field = useFieldContext<boolean>();

	return (
		<View style={styles.inputGroup}>
			{label ? <Text style={styles.label}>{label}</Text> : null}
			<Switch
				style={[styles.input, style]}
				value={field.state.value}
				onChange={(event) => field.handleChange(event.nativeEvent.value)}
				onBlur={field.handleBlur}
				{...rest}
			/>
		</View>
	);
}

export function PickerField<T>(
	props: React.ComponentProps<typeof Picker<T>> & {
		label?: string;
	},
) {
	const { label, style, ...rest } = props;
	const field = useFieldContext<T>();
	return (
		<View style={styles.inputGroup}>
			{label ? <Text style={styles.label}>{label}</Text> : null}
			<View style={[styles.input, styles.pickerContainer]}>
				<Picker<T>
					style={styles.picker}
					selectedValue={field.state.value}
					onValueChange={(itemValue) => field.handleChange(itemValue)}
					{...rest}
				>
					{props.children}
				</Picker>
			</View>
			<FieldInfo />
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
				styles.submitButton,
				disabled ? styles.buttonDisabled : undefined,
			]}
			onPress={onPress}
			disabled={disabled || isSubmitting}
		>
			<Text style={styles.submitButtonText}>
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
		PickerField,
		SwitchField,
	},
	formComponents: {
		SubmitButton,
	},
	fieldContext,
	formContext,
});

const styles = StyleSheet.create({
	inputGroup: {
		marginBottom: 16,
	},
	label: {
		marginBottom: 6,
		fontSize: 14,
		color: '#C6CBD3',
		fontWeight: '600',
	},
	input: {
		borderWidth: 1,
		borderColor: '#2A3655',
		backgroundColor: '#0E172B',
		color: '#E5E7EB',
		borderRadius: 10,
		paddingHorizontal: 12,
		paddingVertical: 12,
		fontSize: 16,
	},
	errorText: {
		marginTop: 6,
		color: '#FCA5A5',
		fontSize: 12,
	},
	submitButton: {
		backgroundColor: '#2563EB',
		borderRadius: 10,
		paddingVertical: 14,
		alignItems: 'center',
	},
	submitButtonText: {
		color: '#FFFFFF',
		fontWeight: '700',
		fontSize: 16,
	},
	buttonDisabled: {
		backgroundColor: '#3B82F6',
		opacity: 0.6,
	},
	fieldInfo: {
		marginTop: 6,
		color: '#FCA5A5',
		fontSize: 12,
	},
	pickerContainer: {
		paddingHorizontal: 8,
		paddingVertical: 4,
	},
	picker: {
		color: '#E5E7EB',
	},
});
