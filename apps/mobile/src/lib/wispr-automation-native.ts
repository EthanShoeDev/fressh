import { NativeModules, Platform } from 'react-native';

export type WisprAutomationNativeStatus = {
	serviceEnabled: boolean;
	serviceConnected: boolean;
	wisprPackage: string;
};

type WisprAutomationNativeModule = {
	getStatus: () => Promise<WisprAutomationNativeStatus>;
	openAccessibilitySettings: () => Promise<void>;
	tapScreen: (x: number, y: number) => Promise<string>;
	tapWisprControl: () => Promise<string>;
};

const nativeModule = NativeModules.FresshWisprAutomation as
	| WisprAutomationNativeModule
	| undefined;

function requireAndroidModule(): WisprAutomationNativeModule {
	if (Platform.OS !== 'android') {
		throw new Error('Wispr automation is only available on Android');
	}
	if (!nativeModule) {
		throw new Error('FresshWisprAutomation native module is unavailable');
	}
	return nativeModule;
}

export const wisprAutomationNative = {
	async getStatus(): Promise<WisprAutomationNativeStatus> {
		return requireAndroidModule().getStatus();
	},

	async openAccessibilitySettings(): Promise<void> {
		await requireAndroidModule().openAccessibilitySettings();
	},

	async tapScreen(x: number, y: number): Promise<string> {
		return requireAndroidModule().tapScreen(x, y);
	},

	async tapWisprControl(): Promise<string> {
		return requireAndroidModule().tapWisprControl();
	},
};
