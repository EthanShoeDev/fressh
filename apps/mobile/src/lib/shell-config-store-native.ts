import { MMKV } from 'react-native-mmkv';
import { getBundledShellConfig } from '@/lib/shell-config';
import {
	loadInitialShellConfigState,
	reloadShellConfigFromRemote,
	type ShellConfigCacheStorage,
	type ShellConfigState,
} from '@/lib/shell-config-store';

const storage = new MMKV({ id: 'shell-config' });

function getNativeShellConfigStorage(): ShellConfigCacheStorage {
	return {
		getString: (key) => storage.getString(key),
		set: (key, value) => {
			storage.set(key, value);
		},
		delete: (key) => {
			storage.delete(key);
		},
	};
}

export function loadRuntimeShellConfigState(): ShellConfigState {
	return loadInitialShellConfigState({
		storage: getNativeShellConfigStorage(),
		bundledConfig: getBundledShellConfig(),
	});
}

export async function reloadRuntimeShellConfigFromRemote(): Promise<ShellConfigState> {
	return reloadShellConfigFromRemote({
		storage: getNativeShellConfigStorage(),
	});
}
