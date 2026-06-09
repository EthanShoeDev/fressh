const path = require('node:path');

module.exports = {
	dependency: {
		platforms: {
			android: { sourceDir: 'android' },
			// Autolink the hand-authored podspec (no xcodeproj — the pod compiles
			// our ios/** + the generated bindings and links shim_uniffi.xcframework, §8).
			ios: { podspecPath: path.join(__dirname, 'ReactNativeTerminal.podspec') },
		},
	},
};
