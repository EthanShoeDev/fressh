import { type ExpoConfig } from 'expo/config';
import 'tsx/cjs';
import packageJson from './package.json';

const UPDATE_CHANNELS = ['development', 'preview', 'production'] as const;
type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

function semverToCode(v: string) {
	const [maj, min, pat] = v.split('.').map((n) => parseInt(n || '0', 10));
	if (maj === undefined || min === undefined || pat === undefined)
		throw new Error(`Invalid version: ${v}`);
	return maj * 10000 + min * 100 + pat;
}

function isUpdateChannel(value: string | undefined): value is UpdateChannel {
	return !!value && UPDATE_CHANNELS.includes(value as UpdateChannel);
}

function resolveUpdateChannel(): UpdateChannel {
	const profile = process.env.EAS_BUILD_PROFILE;
	if (isUpdateChannel(profile)) return profile;

	// For local non-EAS builds (prebuild + gradle), allow an explicit channel.
	const explicit = process.env.FRESSH_UPDATE_CHANNEL;
	if (isUpdateChannel(explicit)) return explicit;

	// Commands like `eas update --channel ...` and `expo config` evaluate this
	// config without a build profile; use a safe non-preview default so config
	// resolution does not fail and release artifacts are never routed to preview.
	return 'production';
}

const versionCode = semverToCode(packageJson.version);
const projectId = '5e4aaebd-05a4-4032-adad-f3c27cc7ab71';
const updateChannel = resolveUpdateChannel();

const config: ExpoConfig = {
	name: 'Fressh',
	slug: 'fressh',
	version: packageJson.version,
	orientation: 'portrait',
	icon: '../../packages/assets/mobile-app-icon-dark.png',
	scheme: 'fressh',
	userInterfaceStyle: 'automatic',
	newArchEnabled: true,
	ios: {
		supportsTablet: true,
		config: { usesNonExemptEncryption: false },
		bundleIdentifier: 'dev.fressh.app',
		buildNumber: String(versionCode),
		// TODO: Add ios specific icons
		// icon: {
		// 	dark: '',
		// 	light: '',
		// 	tinted: '',
		// }
	},
	android: {
		package: 'com.finalapp.vibe2',
		versionCode,
		adaptiveIcon: {
			foregroundImage: '../../packages/assets/android-adaptive-icon.png',
			backgroundColor: '#151718',
		},
		edgeToEdgeEnabled: true,
		predictiveBackGestureEnabled: false,
		softwareKeyboardLayoutMode: 'pan',
	},
	updates: {
		enabled: true,
		checkAutomatically: 'ON_LOAD',
		fallbackToCacheTimeout: 0,
		url: `https://u.expo.dev/${projectId}`,
		requestHeaders: {
			'expo-channel-name': updateChannel,
		},
	},
	runtimeVersion: `${packageJson.version}-native-agent-alert-route-v1`,
	plugins: [
		'expo-router',
		[
			'expo-splash-screen',
			{
				image: '../../packages/assets/splash-icon-light.png',
				backgroundColor: '#ECEDEE',
				dark: {
					image: '../../packages/assets/splash-icon-dark.png',
					backgroundColor: '#151718',
				},
				imageWidth: 200,
			},
		],
		'expo-secure-store',
		'expo-font',
		'expo-dev-client',
		'./plugins/with-foreground-service',
		'./plugins/with-wispr-automation',
	],
	experiments: { typedRoutes: true, reactCompiler: true },
	extra: {
		eas: {
			projectId,
		},
	},
};

export default config;
