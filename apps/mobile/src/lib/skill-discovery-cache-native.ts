import { MMKV } from 'react-native-mmkv';

import {
	createSkillDiscoveryCache,
	type SkillDiscoveryCacheStorage,
} from '@/lib/skill-discovery-cache';

const storage = new MMKV({ id: 'skill-discovery-cache' });

const skillDiscoveryCacheStorage: SkillDiscoveryCacheStorage = {
	getString: (key) => storage.getString(key),
	set: (key, value) => {
		storage.set(key, value);
	},
	delete: (key) => {
		storage.delete(key);
	},
};

export const skillDiscoveryCache = createSkillDiscoveryCache({
	storage: skillDiscoveryCacheStorage,
});
