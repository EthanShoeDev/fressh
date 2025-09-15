import { Link } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';

export default function Tab() {
	return (
		<View style={styles.container}>
			<Text style={{ color: '#E5E7EB', marginBottom: 12 }}>Settings</Text>
			<Link
				href="/(tabs)/settings/key-manager"
				style={{ color: '#60A5FA', marginBottom: 8 }}
			>
				Manage Keys
			</Link>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
		backgroundColor: '#0B1324',
	},
});
