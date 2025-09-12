import 'tsx/cjs';
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
		config: { usesNonExemptEncryption: false },
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
		'expo-dev-client',
		'expo-web-browser',
		[
			'expo-build-properties',
			{
				android: {
					// dylankenneally/react-native-ssh-sftp fails to build without this
					packagingOptions: {
						pickFirst: ['META-INF/versions/9/OSGI-INF/MANIFEST.MF'],
					},
				},
				ios: {
					// https://github.com/dylankenneally/react-native-ssh-sftp/issues/20#issuecomment-3286693445
					// ../../docs/ios-sim-not-working.md (Update 1)
					extraPods: [
					  { name: 'CSSH-Binary', podspec: 'https://gist.githubusercontent.com/EthanShoeDev/1ab212949007d7aeabfeb199b7b9e951/raw/8602ec55efdf8c620dbbae93cd54023e2a36a8b9/CSSH-Binary.podspec' },
					  { name: 'NMSSH', git: 'https://github.com/EthanShoeDev/NMSSH.git', branch: 'master' },
					],
				  },
			},
		],
	],
	experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
