import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSettingsSecurityLinks } from '../../src/lib/settings-security-links';

void test(
	'settings security section exposes one canonical security center destination',
	() => {
		assert.deepEqual(buildSettingsSecurityLinks(), [
			{
				label: 'Security Center',
				href: '/(tabs)/settings/security-center',
			},
		]);
	},
);
