import epicConfig from '@epic-web/config/prettier';
// Sometimes this plugin can remove imports that are being edited.
// As a workaround we will only use this in the cli. (pnpm run fmt)
const sortImports = process.env.SORT_IMPORTS === 'true-never';

/** @type {import("prettier").Options} */
export default {
	...epicConfig,
	semi: true,
	plugins: [
		...(sortImports ? ['prettier-plugin-organize-imports'] : []),
		...(epicConfig.plugins || []),
	],
};
