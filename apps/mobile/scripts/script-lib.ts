import * as child from 'child_process';
import * as path from 'path';

export const cmd = (
	command: string,
	options: { relativeCwd?: string; stdio?: child.StdioOptions } = {},
) =>
	new Promise<{ exitCode: number; stdout: string; stderr: string }>(
		(resolve, reject) => {
			console.log(`cmd: ${command}`);
			const proc = child.spawn(command, {
				shell: true,
				stdio: options.stdio ?? 'inherit',
				cwd: options.relativeCwd
					? path.resolve(process.cwd(), options.relativeCwd)
					: process.cwd(),
			});

			let stdout = '';
			let stderr = '';

			proc.stdout?.on('data', (data) => {
				stdout += data;
			});
			proc.stderr?.on('data', (data) => {
				stderr += data;
			});

			process.once('SIGTERM', () => {
				proc.kill('SIGTERM');
			});
			process.once('SIGINT', () => {
				proc.kill('SIGINT');
			});
			proc.on('close', (code) => {
				console.log(`cmd: ${command} closed with code ${code}`);
				resolve({ exitCode: code ?? 0, stdout, stderr });
			});
			proc.on('error', (error) => {
				reject(error);
			});
		},
	);
