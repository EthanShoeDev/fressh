import defaultConfig from '@epic-web/config/prettier'
// Sometimes this plugin can remove imports that are in use.
// As a workaround we will only use this in the cli. (npm run fmt)
const sortImports = process.env.SORT_IMPORTS === 'true'

/** @type {import("prettier").Options} */
export default {
	...defaultConfig,
	plugins: [
		...(sortImports ? ['prettier-plugin-organize-imports'] : []),
		...(defaultConfig.plugins || []),
	],
}
