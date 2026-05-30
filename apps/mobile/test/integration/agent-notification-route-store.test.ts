import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AGENT_NOTIFICATION_ROUTE_TOKEN_TTL_MS,
	createAgentNotificationRouteTokenStore,
} from '../../src/lib/agent-notification-route';

function createMemoryStorage() {
	const values = new Map<string, string>();
	return {
		getString: (key: string) => values.get(key),
		set: (key: string, value: string) => {
			values.set(key, value);
		},
		delete: (key: string) => {
			values.delete(key);
		},
		getAllKeys: () => Array.from(values.keys()),
	};
}

void test('agent notification tap tokens authorize only matching routes', () => {
	let nextToken = 1;
	const store = createAgentNotificationRouteTokenStore({
		storage: createMemoryStorage(),
		createToken: () => `token-${nextToken++}`,
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};
	const firstToken = store.create(identity);

	assert.equal(store.has({ ...identity, tapToken: firstToken }), true);
	assert.equal(store.has({ ...identity, tapToken: 'forged-token' }), false);
	assert.equal(
		store.has({
			...identity,
			eventId: 'main:@12:3000:done',
			tapToken: firstToken,
		}),
		false,
	);

	const replacementToken = store.create(identity);
	assert.equal(store.has({ ...identity, tapToken: firstToken }), true);
	assert.equal(store.has({ ...identity, tapToken: replacementToken }), true);

	store.delete({ ...identity, tapToken: replacementToken });
	assert.equal(store.has({ ...identity, tapToken: firstToken }), true);
	assert.equal(store.has({ ...identity, tapToken: replacementToken }), false);
});

void test('agent notification tap tokens are consumed once', () => {
	let nextToken = 1;
	const storage = createMemoryStorage();
	const store = createAgentNotificationRouteTokenStore({
		storage,
		createToken: () => `token-${nextToken++}`,
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};
	const token = store.create(identity);

	assert.equal(store.consume({ ...identity, tapToken: token }), true);
	assert.equal(store.consume({ ...identity, tapToken: token }), false);
	assert.equal(store.has({ ...identity, tapToken: token }), false);
	assert.equal(storage.getString(`token:${token}`), undefined);
	assert.equal(
		storage.getString(
			'route:["saved-host","main","@12","main:@12:2000:waiting"]',
		),
		undefined,
	);
});

void test('agent notification tap token consume preserves nonmatching routes', () => {
	let nextToken = 1;
	const store = createAgentNotificationRouteTokenStore({
		storage: createMemoryStorage(),
		createToken: () => `token-${nextToken++}`,
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};
	const token = store.create(identity);

	assert.equal(
		store.consume({
			...identity,
			eventId: 'main:@12:3000:done',
			tapToken: token,
		}),
		false,
	);
	assert.equal(store.has({ ...identity, tapToken: token }), true);
});

void test('agent notification tap tokens can be restored after failed routing', () => {
	let nextToken = 1;
	const store = createAgentNotificationRouteTokenStore({
		storage: createMemoryStorage(),
		createToken: () => `token-${nextToken++}`,
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};
	const token = store.create(identity);

	assert.equal(store.consume({ ...identity, tapToken: token }), true);
	assert.equal(store.has({ ...identity, tapToken: token }), false);
	assert.equal(store.restore({ ...identity, tapToken: token }), true);
	assert.equal(store.has({ ...identity, tapToken: token }), true);
	assert.equal(store.consume({ ...identity, tapToken: token }), true);
});

void test('agent notification tap token restore does not replace newer routes', () => {
	let nextToken = 1;
	const store = createAgentNotificationRouteTokenStore({
		storage: createMemoryStorage(),
		createToken: () => `token-${nextToken++}`,
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};
	const firstToken = store.create(identity);

	assert.equal(store.consume({ ...identity, tapToken: firstToken }), true);
	const secondToken = store.create(identity);

	assert.equal(store.restore({ ...identity, tapToken: firstToken }), false);
	assert.equal(store.has({ ...identity, tapToken: firstToken }), false);
	assert.equal(store.has({ ...identity, tapToken: secondToken }), true);
});

void test('agent notification tap token restore refuses acknowledged consumed routes', () => {
	let nextToken = 1;
	const store = createAgentNotificationRouteTokenStore({
		storage: createMemoryStorage(),
		createToken: () => `token-${nextToken++}`,
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};
	const token = store.create(identity);

	assert.equal(store.consume({ ...identity, tapToken: token }), true);
	store.deleteMatching({
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
	});

	assert.equal(store.restore({ ...identity, tapToken: token }), false);
	assert.equal(store.has({ ...identity, tapToken: token }), false);
});

void test('agent notification tap tokens expire and are pruned', () => {
	let nowMs = 1_000;
	let nextToken = 1;
	const storage = createMemoryStorage();
	const store = createAgentNotificationRouteTokenStore({
		storage,
		createToken: () => `token-${nextToken++}`,
		getNowMs: () => nowMs,
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};
	const firstToken = store.create(identity);
	nowMs += AGENT_NOTIFICATION_ROUTE_TOKEN_TTL_MS - 1;

	assert.equal(store.has({ ...identity, tapToken: firstToken }), true);

	nowMs += 1;

	assert.equal(store.has({ ...identity, tapToken: firstToken }), false);
	assert.equal(storage.getString(`token:${firstToken}`), undefined);
	assert.equal(
		storage.getString(
			'route:["saved-host","main","@12","main:@12:2000:waiting"]',
		),
		undefined,
	);
});

void test('agent notification tap token creation prunes expired older tokens', () => {
	let nowMs = 1_000;
	let nextToken = 1;
	const storage = createMemoryStorage();
	const store = createAgentNotificationRouteTokenStore({
		storage,
		createToken: () => `token-${nextToken++}`,
		getNowMs: () => nowMs,
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};
	const firstToken = store.create(identity);
	nowMs += AGENT_NOTIFICATION_ROUTE_TOKEN_TTL_MS;
	const secondToken = store.create(identity);

	assert.equal(storage.getString(`token:${firstToken}`), undefined);
	assert.equal(storage.getString(`token:${secondToken}`) !== undefined, true);
	assert.equal(
		storage.getString(
			'route:["saved-host","main","@12","main:@12:2000:waiting"]',
		),
		secondToken,
	);
	assert.equal(store.has({ ...identity, tapToken: firstToken }), false);
	assert.equal(store.has({ ...identity, tapToken: secondToken }), true);
});

void test('agent notification tap token creation ignores cleanup failures', () => {
	let nowMs = 1_000;
	const storage = createMemoryStorage();
	storage.set(
		'token:expired-token',
		JSON.stringify({
			connectionId: 'saved-host',
			session: 'main',
			windowId: '@12',
			eventId: 'main:@12:2000:waiting',
			tapToken: 'expired-token',
			createdAtMs: nowMs,
		}),
	);
	const store = createAgentNotificationRouteTokenStore({
		storage: {
			...storage,
			delete: (key) => {
				if (key === 'token:expired-token') {
					throw new Error('delete failed');
				}
				storage.delete(key);
			},
		},
		createToken: () => 'current-token',
		getNowMs: () => nowMs,
	});
	nowMs += AGENT_NOTIFICATION_ROUTE_TOKEN_TTL_MS;
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@13',
		eventId: 'main:@13:2000:waiting',
	};

	assert.equal(store.create(identity), 'current-token');
	assert.equal(store.has({ ...identity, tapToken: 'current-token' }), true);
});

void test('agent notification tap token creation ignores getAllKeys cleanup failure', () => {
	const storage = createMemoryStorage();
	let getAllKeysCalls = 0;
	const store = createAgentNotificationRouteTokenStore({
		storage: {
			...storage,
			getAllKeys: () => {
				getAllKeysCalls += 1;
				if (getAllKeysCalls === 1) throw new Error('list failed');
				return storage.getAllKeys();
			},
		},
		createToken: () => 'current-token',
		getNowMs: () => 1_000,
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@13',
		eventId: 'main:@13:2000:waiting',
	};

	assert.equal(store.create(identity), 'current-token');
	assert.equal(store.has({ ...identity, tapToken: 'current-token' }), true);
});

void test('agent notification tap token creation ignores second getAllKeys cleanup failure', () => {
	const storage = createMemoryStorage();
	let getAllKeysCalls = 0;
	const store = createAgentNotificationRouteTokenStore({
		storage: {
			...storage,
			getAllKeys: () => {
				getAllKeysCalls += 1;
				if (getAllKeysCalls === 2) throw new Error('route list failed');
				return storage.getAllKeys();
			},
		},
		createToken: () => 'current-token',
		getNowMs: () => 1_000,
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@13',
		eventId: 'main:@13:2000:waiting',
	};

	assert.equal(store.create(identity), 'current-token');
	assert.equal(store.has({ ...identity, tapToken: 'current-token' }), true);
});

void test('agent notification tap token creation ignores route cleanup failures', () => {
	const storage = createMemoryStorage();
	const orphanRouteKey =
		'route:["saved-host","main","@12","main:@12:2000:waiting"]';
	storage.set(orphanRouteKey, 'missing-token');
	const store = createAgentNotificationRouteTokenStore({
		storage: {
			...storage,
			getString: (key) => {
				if (key === orphanRouteKey) throw new Error('route read failed');
				return storage.getString(key);
			},
		},
		createToken: () => 'current-token',
		getNowMs: () => 1_000,
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@13',
		eventId: 'main:@13:2000:waiting',
	};

	assert.equal(store.create(identity), 'current-token');
	assert.equal(store.has({ ...identity, tapToken: 'current-token' }), true);
	assert.equal(storage.getString(orphanRouteKey), 'missing-token');
});

void test('agent notification tap token creation ignores route delete failures', () => {
	const storage = createMemoryStorage();
	const orphanRouteKey =
		'route:["saved-host","main","@12","main:@12:2000:waiting"]';
	storage.set(orphanRouteKey, 'missing-token');
	const store = createAgentNotificationRouteTokenStore({
		storage: {
			...storage,
			delete: (key) => {
				if (key === orphanRouteKey) throw new Error('route delete failed');
				storage.delete(key);
			},
		},
		createToken: () => 'current-token',
		getNowMs: () => 1_000,
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@13',
		eventId: 'main:@13:2000:waiting',
	};

	assert.equal(store.create(identity), 'current-token');
	assert.equal(store.has({ ...identity, tapToken: 'current-token' }), true);
	assert.equal(storage.getString(orphanRouteKey), 'missing-token');
});

void test('agent notification tap tokens clear all routes for an acknowledged window', () => {
	let nextToken = 1;
	const store = createAgentNotificationRouteTokenStore({
		storage: createMemoryStorage(),
		createToken: () => `token-${nextToken++}`,
	});
	const waiting = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};
	const done = {
		...waiting,
		eventId: 'main:@12:3000:done',
	};
	const otherWindow = {
		...waiting,
		windowId: '@13',
		eventId: 'main:@13:2000:waiting',
	};
	const waitingToken = store.create(waiting);
	const doneToken = store.create(done);
	const otherToken = store.create(otherWindow);

	store.deleteMatching({
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
	});

	assert.equal(store.has({ ...waiting, tapToken: waitingToken }), false);
	assert.equal(store.has({ ...done, tapToken: doneToken }), false);
	assert.equal(store.has({ ...otherWindow, tapToken: otherToken }), true);
});

void test('agent notification tap token creation rolls back partial route writes', () => {
	const storage = createMemoryStorage();
	const store = createAgentNotificationRouteTokenStore({
		storage: {
			...storage,
			set: (key, value) => {
				if (key.startsWith('token:')) {
					throw new Error('token write failed');
				}
				storage.set(key, value);
			},
		},
		createToken: () => 'token-1',
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};

	assert.throws(() => store.create(identity), /token write failed/);
	assert.deepEqual(storage.getAllKeys(), []);
	assert.equal(store.has({ ...identity, tapToken: 'token-1' }), false);
});

void test('agent notification tap token replacement preserves old token while deleting replacement', () => {
	const storage = createMemoryStorage();
	let nextToken = 1;
	const store = createAgentNotificationRouteTokenStore({
		storage,
		createToken: () => `token-${nextToken++}`,
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};
	const firstToken = store.create(identity);
	const secondToken = store.create(identity);

	store.delete({ ...identity, tapToken: secondToken });

	assert.equal(store.has({ ...identity, tapToken: firstToken }), true);
	assert.equal(store.has({ ...identity, tapToken: secondToken }), false);
});

void test('agent notification tap token replacement preserves old token when new token write fails', () => {
	const storage = createMemoryStorage();
	let nextToken = 1;
	const store = createAgentNotificationRouteTokenStore({
		storage: {
			...storage,
			set: (key, value) => {
				if (key === 'token:token-2') {
					throw new Error('token write failed');
				}
				storage.set(key, value);
			},
		},
		createToken: () => `token-${nextToken++}`,
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};
	const firstToken = store.create(identity);

	assert.throws(() => store.create(identity), /token write failed/);
	assert.equal(store.has({ ...identity, tapToken: firstToken }), true);
	assert.equal(store.has({ ...identity, tapToken: 'token-2' }), false);
});

void test('agent notification tap token store clears all route records', () => {
	let nextToken = 1;
	const storage = createMemoryStorage();
	const store = createAgentNotificationRouteTokenStore({
		storage,
		createToken: () => `token-${nextToken++}`,
	});
	const first = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};
	const second = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@13',
		eventId: 'main:@13:2000:waiting',
	};
	const firstToken = store.create(first);
	const secondToken = store.create(second);

	store.clear();

	assert.equal(store.has({ ...first, tapToken: firstToken }), false);
	assert.equal(store.has({ ...second, tapToken: secondToken }), false);
	assert.deepEqual(storage.getAllKeys(), []);
});

void test('agent notification tap token store rejects legacy records without createdAt', () => {
	const storage = createMemoryStorage();
	storage.set(
		'token:legacy-token',
		JSON.stringify({
			connectionId: 'saved-host',
			session: 'main',
			windowId: '@12',
			eventId: 'main:@12:2000:waiting',
			tapToken: 'legacy-token',
		}),
	);
	storage.set(
		'route:["saved-host","main","@12","main:@12:2000:waiting"]',
		'legacy-token',
	);
	const store = createAgentNotificationRouteTokenStore({
		storage,
		createToken: () => 'token-1',
		getNowMs: () => 5_000,
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};

	assert.equal(store.has({ ...identity, tapToken: 'legacy-token' }), false);
	assert.equal(storage.getString('token:legacy-token'), undefined);
	assert.equal(
		storage.getString(
			'route:["saved-host","main","@12","main:@12:2000:waiting"]',
		),
		undefined,
	);
});

void test('agent notification tap token store rejects invalid createdAt records', () => {
	for (const createdAtMs of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
		const storage = createMemoryStorage();
		const routeKey =
			'route:["saved-host","main","@12","main:@12:2000:waiting"]';
		storage.set(
			'token:invalid-token',
			JSON.stringify({
				connectionId: 'saved-host',
				session: 'main',
				windowId: '@12',
				eventId: 'main:@12:2000:waiting',
				tapToken: 'invalid-token',
				createdAtMs,
			}),
		);
		storage.set(routeKey, 'invalid-token');
		const store = createAgentNotificationRouteTokenStore({
			storage,
			createToken: () => 'token-1',
			getNowMs: () => 5_000,
		});

		assert.equal(
			store.has({
				connectionId: 'saved-host',
				session: 'main',
				windowId: '@12',
				eventId: 'main:@12:2000:waiting',
				tapToken: 'invalid-token',
			}),
			false,
		);
		assert.equal(storage.getString('token:invalid-token'), undefined);
		assert.equal(storage.getString(routeKey), undefined);
	}
});

void test('agent notification tap token store preserves nonmatching legacy records', () => {
	const storage = createMemoryStorage();
	const routeKey = 'route:["saved-host","main","@12","main:@12:2000:waiting"]';
	storage.set(
		'token:legacy-token',
		JSON.stringify({
			connectionId: 'saved-host',
			session: 'main',
			windowId: '@12',
			eventId: 'main:@12:2000:waiting',
			tapToken: 'legacy-token',
		}),
	);
	storage.set(routeKey, 'legacy-token');
	const store = createAgentNotificationRouteTokenStore({
		storage,
		createToken: () => 'token-1',
		getNowMs: () => 5_000,
	});

	assert.equal(
		store.has({
			connectionId: 'saved-host',
			session: 'main',
			windowId: '@13',
			eventId: 'main:@13:2000:waiting',
			tapToken: 'legacy-token',
		}),
		false,
	);
	assert.equal(storage.getString('token:legacy-token') !== undefined, true);
	assert.equal(storage.getString(routeKey), 'legacy-token');
});

void test('agent notification tap token lookup ignores legacy cleanup failures', () => {
	const storage = createMemoryStorage();
	storage.set(
		'token:legacy-token',
		JSON.stringify({
			connectionId: 'saved-host',
			session: 'main',
			windowId: '@12',
			eventId: 'main:@12:2000:waiting',
			tapToken: 'legacy-token',
		}),
	);
	const store = createAgentNotificationRouteTokenStore({
		storage: {
			...storage,
			delete: (key) => {
				if (key === 'token:legacy-token') throw new Error('delete failed');
				storage.delete(key);
			},
		},
		createToken: () => 'token-1',
		getNowMs: () => 5_000,
	});

	assert.doesNotThrow(() => {
		assert.equal(
			store.has({
				connectionId: 'saved-host',
				session: 'main',
				windowId: '@12',
				eventId: 'main:@12:2000:waiting',
				tapToken: 'legacy-token',
			}),
			false,
		);
	});
	assert.equal(storage.getString('token:legacy-token') !== undefined, true);
});

void test('agent notification tap token lookup ignores expired cleanup failures', () => {
	const storage = createMemoryStorage();
	storage.set(
		'token:expired-token',
		JSON.stringify({
			connectionId: 'saved-host',
			session: 'main',
			windowId: '@12',
			eventId: 'main:@12:2000:waiting',
			tapToken: 'expired-token',
			createdAtMs: 1_000,
		}),
	);
	const store = createAgentNotificationRouteTokenStore({
		storage: {
			...storage,
			delete: (key) => {
				if (key === 'token:expired-token') throw new Error('delete failed');
				storage.delete(key);
			},
		},
		createToken: () => 'token-1',
		getNowMs: () => 1_000 + AGENT_NOTIFICATION_ROUTE_TOKEN_TTL_MS,
	});

	assert.doesNotThrow(() => {
		assert.equal(
			store.has({
				connectionId: 'saved-host',
				session: 'main',
				windowId: '@12',
				eventId: 'main:@12:2000:waiting',
				tapToken: 'expired-token',
			}),
			false,
		);
	});
	assert.equal(storage.getString('token:expired-token') !== undefined, true);
});

void test('agent notification tap token deleteMatching ignores legacy records without createdAt', () => {
	const storage = createMemoryStorage();
	const routeKey = 'route:["saved-host","main","@12","main:@12:2000:waiting"]';
	storage.set(
		'token:legacy-token',
		JSON.stringify({
			connectionId: 'saved-host',
			session: 'main',
			windowId: '@12',
			eventId: 'main:@12:2000:waiting',
			tapToken: 'legacy-token',
		}),
	);
	storage.set(routeKey, 'legacy-token');
	const store = createAgentNotificationRouteTokenStore({
		storage,
		createToken: () => 'token-1',
		getNowMs: () => 5_000,
	});

	assert.doesNotThrow(() => {
		store.deleteMatching({
			connectionId: 'saved-host',
			session: 'main',
			windowId: '@12',
		});
	});

	assert.equal(storage.getString('token:legacy-token') !== undefined, true);
	assert.equal(storage.getString(routeKey), 'legacy-token');
	assert.equal(
		store.has({
			connectionId: 'saved-host',
			session: 'main',
			windowId: '@12',
			eventId: 'main:@12:2000:waiting',
			tapToken: 'legacy-token',
		}),
		false,
	);
});

void test('agent notification tap token deleteMatching clears createdAt records', () => {
	const storage = createMemoryStorage();
	const routeKey = 'route:["saved-host","main","@12","main:@12:2000:waiting"]';
	storage.set(
		'token:record-token',
		JSON.stringify({
			connectionId: 'saved-host',
			session: 'main',
			windowId: '@12',
			eventId: 'main:@12:2000:waiting',
			tapToken: 'record-token',
			createdAtMs: 5_000,
		}),
	);
	storage.set(routeKey, 'record-token');
	const store = createAgentNotificationRouteTokenStore({
		storage,
		createToken: () => 'token-1',
		getNowMs: () => 5_000,
	});

	store.deleteMatching({
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
	});

	assert.equal(storage.getString('token:record-token'), undefined);
	assert.equal(storage.getString(routeKey), undefined);
	assert.equal(
		store.has({
			connectionId: 'saved-host',
			session: 'main',
			windowId: '@12',
			eventId: 'main:@12:2000:waiting',
			tapToken: 'record-token',
		}),
		false,
	);
});

void test('agent notification tap token creation prunes orphan route keys', () => {
	const storage = createMemoryStorage();
	storage.set(
		'route:["saved-host","main","@12","main:@12:2000:waiting"]',
		'missing-token',
	);
	const store = createAgentNotificationRouteTokenStore({
		storage,
		createToken: () => 'token-1',
		getNowMs: () => 1_000,
	});

	store.create({
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@13',
		eventId: 'main:@13:2000:waiting',
	});

	assert.equal(
		storage.getString(
			'route:["saved-host","main","@12","main:@12:2000:waiting"]',
		),
		undefined,
	);
});

void test('agent notification tap token creation prunes empty route keys', () => {
	const storage = createMemoryStorage();
	storage.set(
		'route:["saved-host","main","@12","main:@12:2000:waiting"]',
		'',
	);
	const store = createAgentNotificationRouteTokenStore({
		storage,
		createToken: () => 'token-1',
		getNowMs: () => 1_000,
	});

	store.create({
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@13',
		eventId: 'main:@13:2000:waiting',
	});

	assert.equal(
		storage.getString(
			'route:["saved-host","main","@12","main:@12:2000:waiting"]',
		),
		undefined,
	);
});

void test('agent notification tap token store ignores malformed persistent records', () => {
	const storage = createMemoryStorage();
	storage.set('token:bad-json', '{not json');
	storage.set(
		'token:wrong-shape',
		JSON.stringify({ connectionId: 'saved-host', tapToken: 'wrong-shape' }),
	);
	const store = createAgentNotificationRouteTokenStore({
		storage,
		createToken: () => 'token-1',
	});
	const identity = {
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
		eventId: 'main:@12:2000:waiting',
	};

	assert.equal(store.has({ ...identity, tapToken: 'bad-json' }), false);
	assert.equal(store.has({ ...identity, tapToken: 'wrong-shape' }), false);
	assert.doesNotThrow(() => {
		store.deleteMatching({
			connectionId: 'saved-host',
			session: 'main',
			windowId: '@12',
		});
	});
});
