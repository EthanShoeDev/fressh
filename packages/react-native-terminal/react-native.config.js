module.exports = {
	dependency: {
		platforms: {
			android: { sourceDir: 'android' },
			// ios added once the podspec + xcodeproj are generated (§8).
			// ios: { project: 'ios/ReactNativeTerminal.xcodeproj' },
		},
	},
};
