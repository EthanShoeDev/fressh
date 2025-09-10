import 'tsx/cjs'; // Add this to import TypeScript files
import { type ExpoConfig } from 'expo/config';
import packageJson from './package.json';

const config: ExpoConfig = {
	name: 'fressh',
	slug: 'fressh',
	version: packageJson.version,
	orientation: 'portrait',
	icon: './assets/images/icon.png',
	scheme: 'fressh',
	userInterfaceStyle: 'automatic',
	newArchEnabled: true,
	ios: {
		supportsTablet: true,
		config: {
			usesNonExemptEncryption: false,
		},
		bundleIdentifier: 'dev.fressh.app',
	},
	android: {
		package: 'dev.fressh.app',
		adaptiveIcon: {
			foregroundImage: './assets/images/adaptive-icon.png',
			backgroundColor: '#ffffff',
		},
		edgeToEdgeEnabled: true,
		predictiveBackGestureEnabled: false,
	},
	web: {
		output: 'static',
		favicon: './assets/images/favicon.png',
	},
	plugins: [
		'expo-router',
		[
			'expo-splash-screen',
			{
				image: './assets/images/splash-icon.png',
				imageWidth: 200,
				resizeMode: 'contain',
				backgroundColor: '#ffffff',
			},
		],
		'expo-secure-store',
		'expo-font',
		'expo-web-browser',
		[
			'expo-build-properties',
			{
				android: {
					packagingOptions: {
						pickFirst: ['META-INF/versions/9/OSGI-INF/MANIFEST.MF'],
					},
				},
			},
		],
	],
	experiments: {
		typedRoutes: true,
		reactCompiler: true,
	},
};

export default config;
