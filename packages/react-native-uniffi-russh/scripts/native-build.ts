import * as child from 'child_process';
import * as os from 'os';

const targetOptions = ['ios', 'android'] as const;
type Target = (typeof targetOptions)[number];

const envTarget = process.env.MOBILE_TARGET as Target | undefined;
if (envTarget && !targetOptions.includes(envTarget))
	throw new Error(`Invalid target: ${envTarget}`);

const target =
	envTarget ??
	(() => {
		const uname = os.platform();
		if (uname === 'darwin') return 'ios';
		return 'android';
	})();

console.log(`Building for ${target}`);

child.execSync(`turbo run build:${target} --ui stream`, {
	stdio: 'inherit',
});
