// Exists ONLY to enable react-native-worklets Bundle Mode, which
// react-native-effects' off-thread render loop requires (the worklet runtime
// loads a real bundle instead of string-serialized worklets). Without this
// file Expo's default babel already includes the worklets plugin — but not
// with `bundleMode`. Keep `babel-preset-expo` first so everything else
// (reanimated, react compiler via app.config `experiments`) stays stock.
// `.cjs` because the package is `"type": "module"` (same reason metro.config
// is ESM-with-createRequire).
/** @type {import('react-native-worklets/plugin').PluginOptions} */
const workletsPluginOptions = {
	bundleMode: true,
	strictGlobal: true,
};

module.exports = function babelConfig(api) {
	api.cache(true);
	return {
		presets: ['babel-preset-expo'],
		plugins: [['react-native-worklets/plugin', workletsPluginOptions]],
	};
};
