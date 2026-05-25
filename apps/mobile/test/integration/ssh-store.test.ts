import assert from 'node:assert/strict';
import test from 'node:test';
import { createSshRegistryStore } from '../../src/lib/ssh-registry-store';

type StartShellOptions = {
	onClosed?: (channelId: number) => void;
	registerInStore?: boolean;
	term: string;
	useTmux: boolean;
	tmuxSessionName: string;
};

void test('ssh registry keeps hidden shells out of store and native args', async () => {
	const startShellOptions: StartShellOptions[] = [];
	const hiddenShell = { channelId: 10 };
	const visibleShell = { channelId: 11 };
	const connection = {
		connectionId: 'conn-1',
		startShell: async (options: StartShellOptions) => {
			startShellOptions.push(options);
			return startShellOptions.length === 1 ? hiddenShell : visibleShell;
		},
	};
	const store = createSshRegistryStore(async () => connection as never);

	const storedConnection = await store.getState().connect({} as never);
	const hidden = await storedConnection.startShell({
		term: 'Xterm',
		useTmux: false,
		tmuxSessionName: '',
		registerInStore: false,
	} as never);

	assert.equal(hidden, hiddenShell);
	assert.equal('registerInStore' in startShellOptions[0]!, false);
	assert.deepEqual(store.getState().shells, {});

	const visible = await storedConnection.startShell({
		term: 'Xterm',
		useTmux: true,
		tmuxSessionName: 'main',
	} as never);

	assert.equal(visible, visibleShell);
	assert.equal('registerInStore' in startShellOptions[1]!, false);
	assert.deepEqual(Object.keys(store.getState().shells), ['conn-1-11']);

	startShellOptions[0]!.onClosed?.(10);
	assert.deepEqual(Object.keys(store.getState().shells), ['conn-1-11']);

	startShellOptions[1]!.onClosed?.(11);
	assert.deepEqual(store.getState().shells, {});
});
