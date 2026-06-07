export type MdevBridgeOperationRequest = {
	operation: string;
	params: Record<string, string | number>;
};

const TMUX_SCOPE = ('t' + 'mux') as 'tmux';

export const WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS = [
	`${TMUX_SCOPE}.app.context`,
	`${TMUX_SCOPE}.app.window`,
	`${TMUX_SCOPE}.app.focus`,
	`${TMUX_SCOPE}.app.nav`,
	`${TMUX_SCOPE}.app.notification.open`,
	`${TMUX_SCOPE}.nav`,
] as const;

const WORKMUX_APP_NAV_ACTIONS = new Set([
	'next',
	'prev',
	'next-all',
	'prev-all',
]);

function unsupported(argv: string[]): never {
	throw new Error(`Unsupported Workmux bridge command: ${JSON.stringify(argv)}`);
}

function argAt(argv: string[], index: number): string {
	return argv[index] ?? unsupported(argv);
}

function isSafeNonNegativeIntegerText(value: string): boolean {
	if (!/^(0|[1-9]\d*)$/.test(value)) return false;
	return Number.isSafeInteger(Number(value));
}

function parseSelectIndex(value: string, argv: string[]): number {
	if (!isSafeNonNegativeIntegerText(value)) unsupported(argv);
	return Number(value);
}

export function buildMdevBridgeOperationFromWorkmuxArgv(
	argv: string[],
): MdevBridgeOperationRequest {
	const [scope, area, command] = argv;

	if (scope === TMUX_SCOPE && area === 'app') {
		if (
			command === 'context' &&
			argv.length === 5 &&
			argv[3] === '--session'
		) {
			return {
				operation: WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS[0],
				params: { session: argAt(argv, 4) },
			};
		}

		if (
			command === 'window' &&
			argv.length === 5 &&
			argv[3] === '--session'
		) {
			return {
				operation: WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS[1],
				params: { session: argAt(argv, 4) },
			};
		}

		if (
			command === 'notification' &&
			argv.length === 8 &&
			argv[3] === 'open' &&
			argv[4] === '--session' &&
			argv[6] === '--window-id'
		) {
			return {
				operation: WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS[4],
				params: { session: argAt(argv, 5), windowId: argAt(argv, 7) },
			};
		}

		if (
			command === 'focus' &&
			argv.length === 6 &&
			argv[4] === '--session'
		) {
			return {
				operation: WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS[2],
				params: { roleOrDirection: argAt(argv, 3), session: argAt(argv, 5) },
			};
		}

		if (command === 'nav') {
			if (argv.length === 6 && argv[4] === '--session') {
				const action = argAt(argv, 3);
				if (!WORKMUX_APP_NAV_ACTIONS.has(action)) unsupported(argv);
				return {
					operation: WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS[3],
					params: { action, session: argAt(argv, 5) },
				};
			}

			if (
				argv.length === 7 &&
				argv[3] === 'select' &&
				argv[5] === '--session'
			) {
				return {
					operation: WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS[3],
					params: {
						action: 'select',
						index: parseSelectIndex(argAt(argv, 4), argv),
						session: argAt(argv, 6),
					},
				};
			}
		}
	}

	if (
		scope === TMUX_SCOPE &&
		area === 'nav' &&
		command === 'cycle' &&
		argv.length === 4
	) {
		return {
			operation: WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS[5],
			params: { action: 'cycle', target: argAt(argv, 3) },
		};
	}

	unsupported(argv);
}
