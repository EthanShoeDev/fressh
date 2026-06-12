import type { ExpoConfig } from 'expo/config';
import 'tsx/cjs';
import packageJson from './package.json';

function semverToCode(v: string) {
	const [maj, min, pat] = v
		.split('.')
		.map((n) => Number.parseInt(n || '0', 10));
	if (maj === undefined || min === undefined || pat === undefined) {
		throw new Error(`Invalid version: ${v}`);
	}
	return maj * 10_000 + min * 100 + pat;
}
const versionCode = semverToCode(packageJson.version);

const config: ExpoConfig = {
	name: 'Fressh',
	slug: 'fressh',
	// EAS account that owns the project (required for CI builds). `eas init` linked
	// @sherlockshoe/fressh; projectId lives in extra.eas below (dynamic config can't
	// be written automatically). See docs/projects/ci-building-and-releasing.md.
	owner: 'sherlockshoe',
	version: packageJson.version,
	orientation: 'portrait',
	icon: '../../packages/assets/mobile-app-icon-dark.png',
	scheme: 'fressh',
	userInterfaceStyle: 'automatic',
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
		package: 'dev.fressh.app',
		versionCode,
		adaptiveIcon: {
			foregroundImage: '../../packages/assets/android-adaptive-icon.png',
			backgroundColor: '#151718',
		},
		predictiveBackGestureEnabled: false,
		// 'resize' (adjustResize): the window shrinks when the soft keyboard opens,
		// so the terminal SurfaceView reflows to fewer rows ABOVE the keyboard
		// (surfaceChanged -> nativeResize). This keeps on-screen pixels aligned with
		// surface pixels, which touch scroll/selection gestures depend on. 'pan'
		// (adjustPan) instead slides the full-height surface up behind the keyboard,
		// offsetting every touch coordinate.
		softwareKeyboardLayoutMode: 'resize',
	},
	plugins: [
		// react-native-webgpu (under react-native-effects, the themed-background
		// renderer) uses AHardwareBuffer APIs that require Android 8.0 (API 26);
		// Expo's default minSdk is lower, so raise it explicitly.
		['expo-build-properties', { android: { minSdkVersion: 26 } }],
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
		'expo-font',
		'expo-dev-client',
		'expo-image',
	],
	experiments: { typedRoutes: true, reactCompiler: true },
	extra: {
		eas: { projectId: '97d1010a-896a-45e2-8902-fd0d0c1b4468' },
	},
};

export default config;
