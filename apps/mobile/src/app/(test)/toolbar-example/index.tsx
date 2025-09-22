import React, { useCallback, useState } from 'react';
import {
	Text,
	View,
	StyleSheet,
	type TextInputProps,
	TextInput,
} from 'react-native';
import {
	KeyboardAvoidingView,
	KeyboardToolbar,
} from 'react-native-keyboard-controller';

export default function ToolbarExample() {
	return (
		<>
			<View
				style={{
					flex: 1,
					borderWidth: 10,
					borderColor: 'green',
					// paddingBottom: 100,
					marginBottom: 100,
					justifyContent: 'flex-start',
				}}
			>
				<KeyboardAvoidingView
					behavior="height"
					keyboardVerticalOffset={150}
					style={{
						flex: 1,
						paddingHorizontal: 16,
						backgroundColor: 'white',
						borderWidth: 10,
						borderColor: 'red',
						// paddingBottom: 100,
						// marginBottom: 100,
						justifyContent: 'flex-end',
					}}
				>
					<View
						style={{
							borderWidth: 10,
							borderColor: 'blue',
							// marginBottom: 50,
						}}
					>
						<TextInputAndLabel placeholder="Your name" title="Name" />
					</View>
				</KeyboardAvoidingView>
			</View>
			<KeyboardToolbar />
		</>
	);
}

type CustomTextInputProps = {
	title?: string;
} & TextInputProps;

const TextInputAndLabel = (props: CustomTextInputProps) => {
	const { title, ...rest } = props;
	const [isFocused, setFocused] = useState(false);

	const onFocus = useCallback<NonNullable<TextInputProps['onFocus']>>((e) => {
		setFocused(true);
		props.onFocus?.(e);
	}, []);

	const onBlur = useCallback<NonNullable<TextInputProps['onBlur']>>((e) => {
		setFocused(false);
		props.onBlur?.(e);
	}, []);

	return (
		<>
			{!!title && <Text style={textInputStyles.title}>{title}</Text>}
			<TextInput
				placeholderTextColor="#6c6c6c"
				style={[
					textInputStyles.container,
					rest.editable === false && textInputStyles.disabled,
					isFocused && textInputStyles.focused,
				]}
				// multiline
				numberOfLines={2}
				testID={rest.placeholder}
				{...rest}
				placeholder={`${rest.placeholder}`}
				onFocus={onFocus}
				onBlur={onBlur}
			/>
		</>
	);
};

const textInputStyles = StyleSheet.create({
	title: {
		marginBottom: 6,
		marginLeft: 3,
		color: 'black',
		fontSize: 16,
	},
	container: {
		width: '100%',
		minHeight: 50,
		maxHeight: 200,
		borderColor: 'black',
		borderWidth: 2,
		marginRight: 160,
		borderRadius: 10,
		color: 'black',
		paddingHorizontal: 12,
	},
	disabled: {
		opacity: 0.5,
	},
	focused: {
		borderColor: '#20AAFF',
	},
});
