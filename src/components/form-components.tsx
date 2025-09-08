import { AnyFieldApi } from '@tanstack/react-form'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

// https://tanstack.com/form/latest/docs/framework/react/quick-start
export function TextField(
	props: React.ComponentProps<typeof TextInput> & {
		label?: string
		field: AnyFieldApi
	},
) {
	const { label, field, style, ...rest } = props
	const meta = field.state.meta
	const errorMessage = meta?.errors?.[0] // TODO: typesafe errors

	return (
		<View style={styles.inputGroup}>
			{label ? <Text style={styles.label}>{label}</Text> : null}
			<TextInput
				{...rest}
				style={[styles.input, style]}
				placeholderTextColor="#9AA0A6"
			/>
			{errorMessage ? (
				<Text style={styles.errorText}>{String(errorMessage)}</Text>
			) : null}
		</View>
	)
}

export function NumberField(
	props: React.ComponentProps<typeof TextInput> & {
		label?: string
		field: AnyFieldApi
	},
) {
	const { label, field, style, keyboardType, onChangeText, ...rest } = props
	const meta = field.state.meta
	const errorMessage = meta?.errors?.[0]

	return (
		<View style={styles.inputGroup}>
			{label ? <Text style={styles.label}>{label}</Text> : null}
			<TextInput
				{...rest}
				keyboardType={keyboardType ?? 'numeric'}
				style={[styles.input, style]}
				placeholderTextColor="#9AA0A6"
				onChangeText={(text) => {
					if (onChangeText) onChangeText(text)
				}}
			/>
			{errorMessage ? (
				<Text style={styles.errorText}>{String(errorMessage)}</Text>
			) : null}
		</View>
	)
}

export function SubmitButton(props: {
	onPress?: () => void
	title?: string
	disabled?: boolean
}) {
	const { onPress, title = 'Connect', disabled } = props
	return (
		<Pressable
			style={[
				styles.submitButton,
				disabled ? styles.buttonDisabled : undefined,
			]}
			onPress={onPress}
			disabled={disabled}
		>
			<Text style={styles.submitButtonText}>{title}</Text>
		</Pressable>
	)
}

const styles = StyleSheet.create({
	inputGroup: {
		marginBottom: 12,
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
})
