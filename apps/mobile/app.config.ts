import type { ExpoConfig } from 'expo/config';
import 'tsx/cjs';
import packageJson from './package.json';

// The marketing version (iOS CFBundleShortVersionString / Android versionName) must
// be a plain dotted triple, so strip any changeset prerelease/snapshot suffix:
// "0.1.0-canary-abc123" / "0.2.0-rc.0" -> "0.1.0" / "0.2.0". iOS rejects a
// non-triple short version; build uniqueness comes from the build NUMBER instead.
const marketingVersion =
	packageJson.version.split('-')[0] ?? packageJson.version;

function semverToCode(v: string) {
	const [maj, min, pat] = v
		.split('.')
		.map((n) => Number.parseInt(n || '0', 10));
	if (maj === undefined || min === undefined || pat === undefined) {
		throw new Error(`Invalid version: ${v}`);
	}
	return maj * 10_000 + min * 100 + pat;
}

// Build number (iOS CFBundleVersion / Android versionCode). Stable releases derive it
// from the semver (monotonic across versions). Canary/rc builds reuse a base
// marketing version, so semverToCode would collide across builds — CI passes a
// store-derived, monotonic FRESSH_VERSION_CODE override (Android:
// google_play_track_version_codes max+1). On iOS the build number is additionally
// overridden at archive time by fastlane (latest_testflight_build_number + 1), so
// this is just iOS's offline/local default.
const versionCode = process.env.FRESSH_VERSION_CODE
	? Number.parseInt(process.env.FRESSH_VERSION_CODE, 10)
	: semverToCode(marketingVersion);

const config: ExpoConfig = {
	name: 'Fressh',
	slug: 'fressh',
	// EAS account that owns the project (required for CI builds). `eas init` linked
	// @sherlockshoe/fressh; projectId lives in extra.eas below (dynamic config can't
	// be written automatically). See docs/projects/ci-building-and-releasing.md.
	owner: 'sherlockshoe',
	version: marketingVersion,
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
		// Expo's default minSdk is lower, so raise it explicitly. iOS
		// deploymentTarget 16.4: @fressh/react-native-terminal's prebuilt Rust
		// objects are stamped 16.4, so a lower target produces link warnings.
		[
			'expo-build-properties',
			{ android: { minSdkVersion: 26 }, ios: { deploymentTarget: '16.4' } },
		],
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
