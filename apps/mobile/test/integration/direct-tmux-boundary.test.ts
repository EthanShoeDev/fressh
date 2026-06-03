import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as hostBrowserActions from '../../src/lib/host-browser-actions';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');

type DirectBoundaryOccurrence = {
	commandPrefix: string;
	functionName: string;
	kind: 'invoke-rc' | 'rust-process' | 'shell';
};

const scannedRoots = [
	path.join(repoRoot, 'apps/mobile/src'),
	path.join(
		repoRoot,
		'packages/react-native-uniffi-russh/rust/uniffi-russh/src',
	),
];

function listSourceFiles(root: string): string[] {
	const entries = readdirSync(root);
	const files: string[] = [];
	for (const entry of entries) {
		const fullPath = path.join(root, entry);
		const stat = statSync(fullPath);
		if (stat.isDirectory()) {
			if (entry === 'generated') continue;
			files.push(...listSourceFiles(fullPath));
			continue;
		}
		if (/\.(ts|tsx|rs)$/.test(entry)) {
			files.push(fullPath);
		}
	}
	return files;
}

function stripComments(source: string): string {
	let output = '';
	let index = 0;
	let quote: '"' | "'" | '`' | null = null;
	let escaped = false;
	let inLineComment = false;
	let inBlockComment = false;

	while (index < source.length) {
		const current = source[index] ?? '';
		const next = source[index + 1] ?? '';

		if (inLineComment) {
			if (current === '\n') {
				inLineComment = false;
				output += current;
			} else {
				output += ' ';
			}
			index += 1;
			continue;
		}

		if (inBlockComment) {
			if (current === '*' && next === '/') {
				inBlockComment = false;
				output += '  ';
				index += 2;
				continue;
			}
			output += current === '\n' ? '\n' : ' ';
			index += 1;
			continue;
		}

		if (quote) {
			output += current;
			if (escaped) {
				escaped = false;
			} else if (current === '\\') {
				escaped = true;
			} else if (current === quote) {
				quote = null;
			}
			index += 1;
			continue;
		}

		if (current === '/' && next === '/') {
			inLineComment = true;
			output += '  ';
			index += 2;
			continue;
		}

		if (current === '/' && next === '*') {
			inBlockComment = true;
			output += '  ';
			index += 2;
			continue;
		}

		if (current === '"' || current === "'" || current === '`') {
			quote = current;
		}
		output += current;
		index += 1;
	}

	return output;
}

function getEnclosingFunctionName(source: string, index: number): string {
	const prefix = source.slice(0, index);
	const matches = [
		...prefix.matchAll(
			/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
		),
	];
	return matches.at(-1)?.[1] ?? '<module>';
}

function normalizeCommandPrefix(command: string): string {
	const normalized = command.replace(/\s+/g, ' ').trim();
	const directCommand = normalized.slice(normalized.indexOf('tmux'));
	const directTmuxMatch = directCommand.match(/^tmux(?:\s+\S+){0,1}/);
	if (!directTmuxMatch) return normalized;
	if (directCommand.startsWith('tmux ${')) return 'tmux ${';
	if (directCommand.startsWith('tmux display-message')) {
		return 'tmux display-message';
	}
	return directTmuxMatch[0];
}

function isNonShellProseCall(source: string, commandStart: number): boolean {
	const callPrefix = source.slice(Math.max(0, commandStart - 80), commandStart);
	return (
		/(?:(?:logger|console)\.[A-Za-z_$][\w$]*|(?:new\s+)?Error|Alert\.alert)(?:\s*\(\s*)?["'`]?\s*$/.test(
			callPrefix,
		) ||
		/\b(?:const|let|var)\s+(?:label|title|message|copy|text)\s*=\s*["'`]?\s*$/.test(
			callPrefix,
		) ||
		/(?:^|[,{]\s*)(?:label|title|message|copy|text)\s*:\s*["'`]?\s*$/.test(
			callPrefix,
		) ||
		/\b(?:const|let|var)\s+(?:labels|titles|messages|copies|texts)\s*=\s*\[[^\]]*["'`]?\s*$/.test(
			callPrefix,
		) ||
		/(?:^|[,{]\s*)(?:labels|titles|messages|copies|texts)\s*:\s*\[[^\]]*["'`]?\s*$/.test(
			callPrefix,
		)
	);
}

function findDirectTmuxOccurrences(text: string): DirectBoundaryOccurrence[] {
	const source = stripComments(text);
	const occurrences: DirectBoundaryOccurrence[] = [];
	const shellCommandStart =
		'(?:^|`\\s*|[\\n=:[;&|({]\\s*|\\b(?:return|if|then|do|while|until|else|elif)\\s+)';
	const shellAssignment =
		'(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|\'[^\']*\'|`[^`]*`|[^\\s;&|()]+)\\s+)*';
	const shellCommandWrapper =
		String.raw`(?:(?:exec|command|sudo)\s+|(?:timeout|gtimeout)\s+\S+\s+|bash\s+-lc\s+["']|env\s+` +
		shellAssignment +
		')?';
	const tmuxExecutable = String.raw`(?:tmux\b|(?:/[^\s;&|()]+)+/tmux\b)`;
	const tmuxGlobalOption = String.raw`(?:-(?:2|C|D|l|N|u|v|V)|-(?:L|S|f)\s+\S+)`;
	const tmuxGlobalOptions = String.raw`(?:\s+` + tmuxGlobalOption + ')*';
	const tmuxSubcommand = String.raw`\s+(?:[A-Za-z][A-Za-z0-9_-]*\b|\$\{)`;
	const directTmuxCommandPattern = new RegExp(
		shellCommandStart +
			shellAssignment +
			shellCommandWrapper +
			tmuxExecutable +
			tmuxGlobalOptions +
			tmuxSubcommand,
		'g',
	);
	const bareBacktickTmuxCommandPattern = new RegExp(
		'(?:^|`\\s*)' +
			shellAssignment +
			shellCommandWrapper +
			tmuxExecutable +
			tmuxGlobalOptions +
			'(?=\\s*`)',
		'g',
	);
	const quotedTmuxCommandPattern = new RegExp(
		String.raw`(?:^|[=:[,({]\s*|\b(?:return|format!)\s*\(?\s*)` +
			'["\\\']\\s*' +
			shellAssignment +
			shellCommandWrapper +
			tmuxExecutable +
			tmuxGlobalOptions +
			String.raw`(?:` +
			tmuxSubcommand +
			')?',
		'g',
	);

	for (const match of [
		...source.matchAll(directTmuxCommandPattern),
		...source.matchAll(bareBacktickTmuxCommandPattern),
		...source.matchAll(quotedTmuxCommandPattern),
	]) {
		const tmuxCommandOffset = match[0].indexOf('tmux');
		const commandStart = (match.index ?? 0) + tmuxCommandOffset;
		const directCommand = match[0].slice(tmuxCommandOffset);
		const isDynamicCommand = directCommand.startsWith('tmux ${');
		if (isDynamicCommand || !isNonShellProseCall(source, commandStart)) {
			occurrences.push({
				kind: 'shell',
				functionName: getEnclosingFunctionName(source, commandStart),
				commandPrefix: normalizeCommandPrefix(match[0]),
			});
		}
	}

	for (const match of source.matchAll(
		/\bCommand::new\s*\(\s*"(?:(?:\/[^/\s"]+)+\/)?tmux"\s*\)/g,
	)) {
		occurrences.push({
			kind: 'rust-process',
			functionName: getEnclosingFunctionName(source, match.index ?? 0),
			commandPrefix: 'Command::new("tmux")',
		});
	}

	return occurrences;
}

function findDirectInvokeRcOccurrences(
	text: string,
): DirectBoundaryOccurrence[] {
	const source = stripComments(text);
	const occurrences: DirectBoundaryOccurrence[] = [];
	const shellCommandStart =
		'(?:^|`\\s*|[\\n=:[;&|({]\\s*|\\b(?:return|if|then|do|while|until|else|elif)\\s+)';
	const shellAssignment =
		'(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|\'[^\']*\'|`[^`]*`|[^\\s;&|()]+)\\s+)*';
	const shellCommandWrapper =
		String.raw`(?:(?:exec|command|sudo)\s+|(?:timeout|gtimeout)\s+\S+\s+|bash\s+-lc\s+["']|env\s+` +
		shellAssignment +
		')?';
	const invokeRcExecutable = String.raw`(?:invoke-rc(?:\.bash)?\b|(?:/[^\s;&|()]+)+/invoke-rc(?:\.bash)?\b)`;
	const directInvokeRcCommandPattern = new RegExp(
		shellCommandStart +
			shellAssignment +
			shellCommandWrapper +
			invokeRcExecutable,
		'g',
	);
	const quotedInvokeRcCommandPattern = new RegExp(
		String.raw`(?:^|[=:[,({]\s*|\b(?:return|format!)\s*\(?\s*)` +
			'["\\\']\\s*' +
			shellAssignment +
			shellCommandWrapper +
			invokeRcExecutable,
		'g',
	);

	for (const match of [
		...source.matchAll(directInvokeRcCommandPattern),
		...source.matchAll(quotedInvokeRcCommandPattern),
	]) {
		const invokeRcCommandOffset = match[0].search(/invoke-rc(?:\.bash)?\b/);
		const commandStart = (match.index ?? 0) + invokeRcCommandOffset;
		if (!isNonShellProseCall(source, commandStart)) {
			const commandPrefix = match[0]
				.slice(invokeRcCommandOffset)
				.replace(/\s+/g, ' ')
				.trim()
				.startsWith('invoke-rc.bash')
				? 'invoke-rc.bash'
				: 'invoke-rc';
			occurrences.push({
				kind: 'invoke-rc',
				functionName: getEnclosingFunctionName(source, commandStart),
				commandPrefix,
			});
		}
	}

	for (const match of source.matchAll(
		/\bCommand::new\s*\(\s*"(?:(?:\/[^/\s"]+)+\/)?invoke-rc(?:\.bash)?"\s*\)/g,
	)) {
		occurrences.push({
			kind: 'invoke-rc',
			functionName: getEnclosingFunctionName(source, match.index ?? 0),
			commandPrefix: 'Command::new("invoke-rc")',
		});
	}

	return occurrences;
}

function containsDirectTmuxCommand(text: string): boolean {
	return findDirectTmuxOccurrences(text).length > 0;
}

function containsDirectInvokeRcCommand(text: string): boolean {
	return findDirectInvokeRcOccurrences(text).length > 0;
}

void test('direct tmux command detector matches shell command strings', () => {
	const directShellCommands = [
		'`cd /tmp && tmux attach -t main`',
		"`TERM=xterm-256color tmux display-message -p '#{window_id}'`",
		'`if tmux select-window -t main; then echo ok; fi`',
		'`tmux capture-pane -p`',
		'`tmux list-panes`',
		'`tmux send-keys Enter`',
		'`tmux rename-window main`',
		'`tmux new-session main`',
		'`tmux attach main`',
		'`tmux source-file ~/.tmux.conf`',
		'`exec tmux attach -t main`',
		'`command tmux attach -t main`',
		'`sudo tmux capture-pane -p`',
		'`timeout 2 tmux display-message -p "#{window_id}"`',
		'`bash -lc "tmux capture-pane -p"`',
		'`env FOO=bar tmux attach -t main`',
		'`/usr/bin/tmux attach -t main`',
		'`tmux`',
		'`tmux -V`',
		"executeSideChannelCommand('tmux')",
		'const command = "tmux -V"',
		'const script = "tmux attach -t main"',
		"return 'tmux attach -t main'",
		"{ command: 'tmux attach -t main' }",
		'ch.exec(true, "tmux -V".to_string())',
		'format!("tmux attach -t {tmux_name}")',
		'ch.exec(true, format!("tmux -V"))',
		'sendTmuxControlCommand("tmux send-keys Enter")',
		"`tmux -L fressh display-message -p '#{window_id}'`",
		'`tmux -L fressh new-session main`',
		"executeSideChannelCommand('tmux attach -t main')",
		'`set -e\n tmux capture-pane -p`',
	];

	for (const command of directShellCommands) {
		assert.equal(containsDirectTmuxCommand(command), true, command);
	}
});

void test('direct tmux command detector matches Rust process spawning', () => {
	const source = `
		Command::new("tmux").arg("capture-pane").arg("-p");
		Command::new("/usr/bin/tmux").arg("capture-pane");
	`;

	assert.equal(containsDirectTmuxCommand(source), true);
});

void test('direct tmux command detector matches dynamic tmux command assembly', () => {
	const source = `
		const parts: string[] = [];
		parts.push(\`send-keys -t \${targetArg} -N \${pages} -X \${pageCmd}\`);
		const command = \`tmux \${parts.join(' \\\\; ')}\`;
	`;

	assert.equal(containsDirectTmuxCommand(source), true);
});

void test('direct tmux command detector ignores mdev and prose', () => {
	const allowedText = [
		"`mdev tmux attach 'main'`",
		"logger.info('Auto-connect tmux attach failed, will retry')",
		"throw new Error('tmux attach failed')",
		'const message = `tmux attach failed`',
		"const label = 'tmux attach failed'",
		"{ label: 'tmux attach failed' }",
		"const labels = ['tmux attach failed']",
		"{ labels: ['tmux attach failed'] }",
		"Alert.alert('tmux attach failed')",
		'Alert.alert(`tmux attach failed`)',
		'// Avoid direct tmux attach calls outside the boundary.',
		'// `tmux capture-pane -p`',
	];

	for (const text of allowedText) {
		assert.equal(containsDirectTmuxCommand(text), false, text);
	}
});

void test('direct invoke-rc command detector matches shell command strings', () => {
	const directShellCommands = [
		'`invoke-rc.bash mdev_tmux_context`',
		'`invoke-rc mdev_tmux_context`',
		'`exec invoke-rc.bash mdev_tmux_context`',
		'`command invoke-rc.bash mdev_tmux_context`',
		'`sudo invoke-rc.bash mdev_tmux_context`',
		'`timeout 2 invoke-rc.bash mdev_tmux_context`',
		'`bash -lc "invoke-rc.bash mdev_tmux_context"`',
		'`env FOO=bar invoke-rc.bash mdev_tmux_context`',
		'`/home/muly/bin/invoke-rc.bash mdev_tmux_context`',
		"executeSideChannelCommand('invoke-rc.bash mdev_tmux_context')",
		'const command = "invoke-rc.bash mdev_tmux_context"',
		"return 'invoke-rc.bash mdev_tmux_context'",
		'ch.exec(true, "invoke-rc.bash mdev_tmux_context".to_string())',
		'format!("invoke-rc.bash mdev_tmux_context")',
	];

	for (const command of directShellCommands) {
		assert.equal(containsDirectInvokeRcCommand(command), true, command);
	}
});

void test('direct invoke-rc command detector ignores prose', () => {
	const allowedText = [
		"logger.info('invoke-rc.bash migration complete')",
		"throw new Error('invoke-rc.bash failed')",
		"const message = 'invoke-rc.bash failed'",
		"{ message: 'invoke-rc.bash failed' }",
		'// Avoid invoke-rc.bash command paths.',
	];

	for (const text of allowedText) {
		assert.equal(containsDirectInvokeRcCommand(text), false, text);
	}
});

void test('direct tmux and invoke-rc command strings are absent outside the app boundary', () => {
	const actualOccurrencesByFile = new Map<string, DirectBoundaryOccurrence[]>();

	for (const root of scannedRoots) {
		for (const file of listSourceFiles(root)) {
			const text = readFileSync(file, 'utf8');
			const occurrences = [
				...findDirectTmuxOccurrences(text),
				...findDirectInvokeRcOccurrences(text),
			];
			if (occurrences.length > 0) {
				actualOccurrencesByFile.set(path.relative(repoRoot, file), occurrences);
			}
		}
	}

	assert.deepEqual(
		[...actualOccurrencesByFile.entries()].sort(),
		[],
		JSON.stringify([...actualOccurrencesByFile.entries()]),
	);
});

void test('host browser actions do not export legacy tmux context helpers', () => {
	// Keep these assembled so the final stale-reference scan stays meaningful.
	const removedExportNames = [
		['build', 'HostBrowser', 'Pane', 'Context', 'Command'],
		['build', 'HostBrowser', 'Pane', 'Path', 'Command'],
		['build', 'Tmux', 'Current', 'Window', 'Id', 'Command'],
		['parse', 'Tmux', 'Pane', 'Context', 'Output'],
	].map((parts) => parts.join(''));

	for (const name of removedExportNames) {
		assert.equal(Object.hasOwn(hostBrowserActions, name), false, name);
	}
});
