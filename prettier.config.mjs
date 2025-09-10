import epicConfig from '@epic-web/config/prettier';

/** @type {import("prettier").Options} */
export default {
	...epicConfig,
	semi: true,
	plugins: [
		// ...(sortImports ? ["prettier-plugin-organize-imports"] : []),
		...(epicConfig.plugins || []),
	],
};
