import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { build, type Plugin } from 'esbuild';
import React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
	.IS_REACT_ACT_ENVIRONMENT = true;

type HostBrowserUrlSlot =
	| 'window-url'
	| 'dev-web-server-url'
	| 'storybook-url'
	| 'app-url';

type BrowserActionsModalComponent = React.ComponentType<{
	open: boolean;
	bottomOffset: number;
	onClose: () => void;
	onOpenDiff: () => void;
	onOpenGitHubIssues: () => void;
	onOpenGitHubPulls: () => void;
	onOpenUrlSlot: (slot: HostBrowserUrlSlot) => void;
	onEditUrlSlot: (slot: HostBrowserUrlSlot) => void;
}>;

const repoRoot = path.resolve(import.meta.dirname, '../../../..');

function aliasPlugin(aliases: Record<string, string>): Plugin {
	return {
		name: 'test-aliases',
		setup(builder) {
			builder.onResolve({ filter: /.*/ }, (args) => {
				const alias = aliases[args.path];
				if (alias) {
					return { path: alias };
				}
				if (args.path.startsWith('@/')) {
					return {
						path: `${path.join(
							repoRoot,
							'apps/mobile/src',
							args.path.slice(2),
						)}.ts`,
					};
				}
				return null;
			});
		},
	};
}

async function loadBrowserActionsModal(): Promise<BrowserActionsModalComponent> {
	const tempDir = await mkdtemp(
		path.join(repoRoot, 'apps/mobile/.tmp-browser-modal-test-'),
	);
	const reactNativeMockPath = path.join(tempDir, 'react-native.tsx');
	const themeMockPath = path.join(tempDir, 'theme.ts');
	const iconMockPath = path.join(tempDir, 'lucide-utils.ts');
	const outputPath = path.join(tempDir, 'BrowserActionsModal.mjs');

	await writeFile(
		reactNativeMockPath,
		[
			"import React from 'react';",
			"function host(name: string) {",
			'  return function Host(props: { children?: React.ReactNode }) {',
			'    return React.createElement(name, props, props.children);',
			'  };',
			'}',
			"export const Modal = host('Modal');",
			"export const Pressable = host('Pressable');",
			"export const ScrollView = host('ScrollView');",
			"export const Text = host('Text');",
			"export const View = host('View');",
		].join('\n'),
	);
	await writeFile(
		themeMockPath,
		[
			'export function useTheme() {',
			'  return {',
			'    colors: {',
			"      background: '#000',",
			"      surface: '#111',",
			"      border: '#222',",
			"      borderStrong: '#333',",
			"      textPrimary: '#fff',",
			"      textSecondary: '#ccc',",
			"      primary: '#2563eb',",
			"      primaryDisabled: '#93c5fd',",
			"      overlay: 'rgba(0,0,0,0.4)',",
			'    },',
			'  };',
			'}',
		].join('\n'),
	);
	await writeFile(
		iconMockPath,
		'export function resolveLucideIcon() { return undefined; }\n',
	);

	await build({
		entryPoints: [
			path.join(
				repoRoot,
				'apps/mobile/src/app/shell/components/BrowserActionsModal.tsx',
			),
		],
		outfile: outputPath,
		bundle: true,
		format: 'esm',
		platform: 'node',
		external: ['react'],
		plugins: [
			aliasPlugin({
				'react-native': reactNativeMockPath,
				'@/lib/theme': themeMockPath,
				'@/lib/lucide-utils': iconMockPath,
			}),
		],
	});

	const module = (await import(pathToFileURL(outputPath).href)) as {
		BrowserActionsModal: BrowserActionsModalComponent;
	};
	await rm(tempDir, { force: true, recursive: true });
	return module.BrowserActionsModal;
}

function findButton(root: ReactTestInstance, label: string): ReactTestInstance {
	const button = root.findAll(
		(node) =>
			typeof node.props.onPress === 'function' &&
			node.findAll((child) => child.props.children === label).length > 0,
	).at(-1);

	assert.ok(button, `Expected ${label} button to exist`);
	return button;
}

function findModal(root: ReactTestInstance): ReactTestInstance {
	const modal = root.findAll((node) => String(node.type) === 'Modal')[0];
	assert.ok(modal, 'Expected Modal to exist');
	return modal;
}

function renderModal(
	Modal: BrowserActionsModalComponent,
	props: React.ComponentProps<BrowserActionsModalComponent>,
): ReturnType<typeof create> {
	let renderer: ReturnType<typeof create> | undefined;
	act(() => {
		renderer = create(React.createElement(Modal, props));
	});
	assert.ok(renderer);
	return renderer;
}

void test('browser actions modal toggles URL rows between open and set mode', async () => {
	const Modal = await loadBrowserActionsModal();
	const openedSlots: HostBrowserUrlSlot[] = [];
	const editedSlots: HostBrowserUrlSlot[] = [];
	const renderer = renderModal(Modal, {
		open: true,
		bottomOffset: 0,
		onClose: () => {},
		onOpenDiff: () => {},
		onOpenGitHubIssues: () => {},
		onOpenGitHubPulls: () => {},
		onOpenUrlSlot: (slot) => {
			openedSlots.push(slot);
		},
		onEditUrlSlot: (slot) => {
			editedSlots.push(slot);
		},
	});

	act(() => {
		findModal(renderer.root).props.onShow();
	});
	act(() => {
		findButton(renderer.root, 'URL').props.onPress();
	});
	assert.deepEqual(openedSlots, ['window-url']);
	assert.deepEqual(editedSlots, []);

	act(() => {
		findButton(renderer.root, 'Set').props.onPress();
	});
	act(() => {
		findButton(renderer.root, 'URL').props.onPress();
	});
	assert.deepEqual(openedSlots, ['window-url']);
	assert.deepEqual(editedSlots, ['window-url']);
});

void test('browser actions modal resets to open mode when shown', async () => {
	const Modal = await loadBrowserActionsModal();
	const openedSlots: HostBrowserUrlSlot[] = [];
	const editedSlots: HostBrowserUrlSlot[] = [];
	const renderer = renderModal(Modal, {
		open: true,
		bottomOffset: 0,
		onClose: () => {},
		onOpenDiff: () => {},
		onOpenGitHubIssues: () => {},
		onOpenGitHubPulls: () => {},
		onOpenUrlSlot: (slot) => {
			openedSlots.push(slot);
		},
		onEditUrlSlot: (slot) => {
			editedSlots.push(slot);
		},
	});

	act(() => {
		findModal(renderer.root).props.onShow();
	});
	act(() => {
		findButton(renderer.root, 'Set').props.onPress();
	});
	act(() => {
		findModal(renderer.root).props.onShow();
	});
	act(() => {
		findButton(renderer.root, 'URL').props.onPress();
	});

	assert.deepEqual(openedSlots, ['window-url']);
	assert.deepEqual(editedSlots, []);
});
