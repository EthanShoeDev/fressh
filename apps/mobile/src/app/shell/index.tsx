import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export default function ShellList() {
	return (
		<View style={styles.container}>
			<Text style={styles.text}>No active shells. Connect from Host tab.</Text>
			<Link href="/">Go to Host</Link>
		</View>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
	text: { color: '#E5E7EB', marginBottom: 8 },
});
