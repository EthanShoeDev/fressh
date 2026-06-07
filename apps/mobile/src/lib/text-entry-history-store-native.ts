import { MMKV } from 'react-native-mmkv';

import { rootLogger } from '@/lib/logger';
import {
	createTextEntryHistoryStore,
	type TextEntryHistoryStorage,
} from '@/lib/text-entry-history';

const storage = new MMKV({ id: 'text-entry-history' });

function getNativeTextEntryHistoryStorage(): TextEntryHistoryStorage {
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

export const textEntryHistoryStore = createTextEntryHistoryStore({
	storage: getNativeTextEntryHistoryStorage(),
	logger: rootLogger.extend('TextEntryHistory'),
});
