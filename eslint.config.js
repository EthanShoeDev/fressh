// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')
// const { config: epicConfig } = require('@epic-web/config/eslint')

module.exports = defineConfig([
	expoConfig,
	// ...epicConfig,
	{
		ignores: ['dist/*'],
	},
])
