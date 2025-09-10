import 'tsx/cjs'; // Add this to import TypeScript files
import { type ExpoConfig } from 'expo/config';
import packageJson from './package.json';

const config: ExpoConfig = {
	name: 'Fressh',
	slug: 'fressh',
	version: packageJson.version,
	orientation: 'portrait',
	icon: '../../packages/assets/ios-dark-2.png',
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
			foregroundImage: '../../packages/assets/adaptive-icon.png',
			backgroundColor: '#151718',
		},
		edgeToEdgeEnabled: true,
		predictiveBackGestureEnabled: false,
	},
	web: {
		output: 'static',
		favicon: '../../packages/assets/favicon.png',
	},
	plugins: [
		'expo-router',
		[
			'expo-splash-screen',
			{
				image: '../../packages/assets/splash-icon-light.png',
				dark: {
					image: '../../packages/assets/splash-icon-dark.png',
					backgroundColor: '#151718',
				},
				imageWidth: 200,
				backgroundColor: '#ECEDEE',
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
