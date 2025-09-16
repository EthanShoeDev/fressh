import React from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '@/lib/theme';

export function IconSegmentedControl<T extends string>(props: {
	values: {
		child: (props: { isActive: boolean }) => React.ReactNode;
		accessibilityLabel: string;
		value: T;
	}[];
	value: T;
	onChange: (value: T) => void;
}) {
	const theme = useTheme();

	return (
		<View
			style={{
				flexDirection: 'row',
				backgroundColor: theme.colors.surface,
				// borderWidth: 1,
				// borderColor: theme.colors.border,
				borderRadius: 10,
				overflow: 'hidden',
			}}
		>
			{props.values.map((item) => (
				<Pressable
					key={item.value}
					accessibilityLabel={item.accessibilityLabel}
					onPress={() => {
						console.log('DEBUG onPress', {
							currentValue: props.value,
							itemValue: item.value,
						});
						if (props.values.length === 2) {
							const newValue = props.values.find(
								(v) => v.value !== props.value,
							)!.value;
							console.log('DEBUG newValue', newValue);
							props.onChange(newValue);
						} else {
							props.onChange(item.value);
						}
					}}
					style={[
						{
							paddingHorizontal: 10,
							paddingVertical: 6,
							alignItems: 'center',
							justifyContent: 'center',
						},
						props.value === item.value && {
							backgroundColor: theme.colors.inputBackground,
						},
					]}
				>
					{item.child({ isActive: props.value === item.value })}
				</Pressable>
			))}
		</View>
	);
}
