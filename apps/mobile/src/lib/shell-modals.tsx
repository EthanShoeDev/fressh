import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type RefObject,
} from 'react';
import { Alert } from 'react-native';
import {
	buildCreateGitHubIssueCommand,
	buildFeatureRequestSubmittedAlert,
} from './repo-feature-request';
import { useRequestId } from './request-id';
import {
	buildSkillDiscoveryCommand,
	parseSkillDiscoveryOutput,
	type DiscoveredSkill,
} from './skill-discovery';

export type SimpleModalHandle = {
	open: boolean;
	onOpen: () => void;
	onClose: () => void;
};

export type TextEntryModalHandle = SimpleModalHandle & {
	openRef: RefObject<boolean>;
};

export type ShellSimpleModalsHandle = {
	commandPresets: SimpleModalHandle;
	commander: SimpleModalHandle;
	textEntry: TextEntryModalHandle;
	configure: SimpleModalHandle;
};

export function useShellSimpleModals(): ShellSimpleModalsHandle {
	const [commandPresetsOpen, setCommandPresetsOpen] = useState(false);
	const [commanderOpen, setCommanderOpen] = useState(false);
	const [textEntryOpen, setTextEntryOpen] = useState(false);
	const [configureOpen, setConfigureOpen] = useState(false);

	const textEntryOpenRef = useRef(false);
	// Sync ref with state so callers (Wispr handlers in detail.tsx) that read
	// it inside callbacks see the latest value without going through deps.
	textEntryOpenRef.current = textEntryOpen;

	const openCommandPresets = useCallback(() => {
		setCommandPresetsOpen(true);
	}, []);
	const closeCommandPresets = useCallback(() => {
		setCommandPresetsOpen(false);
	}, []);

	const openCommander = useCallback(() => {
		setCommanderOpen(true);
	}, []);
	const closeCommander = useCallback(() => {
		setCommanderOpen(false);
	}, []);

	const openTextEntry = useCallback(() => {
		textEntryOpenRef.current = true;
		setTextEntryOpen(true);
	}, []);
	const closeTextEntry = useCallback(() => {
		textEntryOpenRef.current = false;
		setTextEntryOpen(false);
	}, []);

	const openConfigure = useCallback(() => {
		setConfigureOpen(true);
	}, []);
	const closeConfigure = useCallback(() => {
		setConfigureOpen(false);
	}, []);

	const commandPresets = useMemo<SimpleModalHandle>(
		() => ({
			open: commandPresetsOpen,
			onOpen: openCommandPresets,
			onClose: closeCommandPresets,
		}),
		[commandPresetsOpen, openCommandPresets, closeCommandPresets],
	);

	const commander = useMemo<SimpleModalHandle>(
		() => ({
			open: commanderOpen,
			onOpen: openCommander,
			onClose: closeCommander,
		}),
		[commanderOpen, openCommander, closeCommander],
	);

	const textEntry = useMemo<TextEntryModalHandle>(
		() => ({
			open: textEntryOpen,
			openRef: textEntryOpenRef,
			onOpen: openTextEntry,
			onClose: closeTextEntry,
		}),
		[textEntryOpen, openTextEntry, closeTextEntry],
	);

	const configure = useMemo<SimpleModalHandle>(
		() => ({
			open: configureOpen,
			onOpen: openConfigure,
			onClose: closeConfigure,
		}),
		[configureOpen, openConfigure, closeConfigure],
	);

	return { commandPresets, commander, textEntry, configure };
}

export type SkillSelectorModalProps = {
	open: boolean;
	skills: DiscoveredSkill[];
	isLoading: boolean;
	error: string | null;
	onClose: () => void;
	onRetry: () => void;
	onSelect: (skill: DiscoveredSkill) => void;
};

export type SkillSelectorControllerHandle = {
	modalProps: SkillSelectorModalProps;
	open: () => void;
	close: () => void;
};

export function useSkillSelectorController<TConnection>(deps: {
	connection: TConnection | null;
	tmuxEnabled: boolean;
	runHostBrowserCommand: (command: string, timeoutMs?: number) => Promise<string>;
	resolveHostBrowserPanePath: () => Promise<string>;
	sendTextRaw: (text: string) => void;
	sourceKey: string;
	getErrorMessage: (error: unknown) => string;
	closeOtherModals: () => boolean;
}): SkillSelectorControllerHandle {
	const {
		connection,
		tmuxEnabled,
		runHostBrowserCommand,
		resolveHostBrowserPanePath,
		sendTextRaw,
		sourceKey,
		getErrorMessage,
		closeOtherModals,
	} = deps;

	const [open, setOpen] = useState(false);
	const [skills, setSkills] = useState<DiscoveredSkill[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const requestId = useRequestId();
	const activeSourceKeyRef = useRef<string | null>(null);
	const lastSourceKeyRef = useRef(sourceKey);
	const currentSourceKeyRef = useRef(sourceKey);
	currentSourceKeyRef.current = sourceKey;

	const visible = open && activeSourceKeyRef.current === sourceKey;

	const close = useCallback(() => {
		requestId.invalidate();
		activeSourceKeyRef.current = null;
		setOpen(false);
		setIsLoading(false);
		setError(null);
		setSkills([]);
	}, [requestId]);

	const load = useCallback(async () => {
		const requestSourceKey = currentSourceKeyRef.current;
		const id = requestId.next();
		activeSourceKeyRef.current = requestSourceKey;
		setIsLoading(true);
		setError(null);
		setSkills([]);

		try {
			if (!connection) {
				throw new Error('No SSH connection available.');
			}
			if (!tmuxEnabled) {
				throw new Error('Skill selector requires a tmux-enabled connection.');
			}
			const panePath = await resolveHostBrowserPanePath();
			if (currentSourceKeyRef.current !== requestSourceKey) return;
			const output = await runHostBrowserCommand(
				buildSkillDiscoveryCommand(panePath),
				10_000,
			);
			const parsed = parseSkillDiscoveryOutput(output);
			if (
				requestId.isCurrent(id) &&
				activeSourceKeyRef.current === requestSourceKey &&
				currentSourceKeyRef.current === requestSourceKey
			) {
				setSkills(parsed);
			}
		} catch (err) {
			if (
				requestId.isCurrent(id) &&
				activeSourceKeyRef.current === requestSourceKey &&
				currentSourceKeyRef.current === requestSourceKey
			) {
				setError(getErrorMessage(err));
			}
		} finally {
			if (
				requestId.isCurrent(id) &&
				activeSourceKeyRef.current === requestSourceKey &&
				currentSourceKeyRef.current === requestSourceKey
			) {
				setIsLoading(false);
			}
		}
	}, [
		connection,
		getErrorMessage,
		requestId,
		resolveHostBrowserPanePath,
		runHostBrowserCommand,
		tmuxEnabled,
	]);

	const openController = useCallback(() => {
		if (!closeOtherModals()) return;
		setOpen(true);
		void load();
	}, [closeOtherModals, load]);

	const handleSelect = useCallback(
		(skill: DiscoveredSkill) => {
			if (activeSourceKeyRef.current !== currentSourceKeyRef.current) {
				close();
				return;
			}
			sendTextRaw(`$${skill.name} `);
			close();
		},
		[close, sendTextRaw],
	);

	useLayoutEffect(() => {
		if (lastSourceKeyRef.current === sourceKey) return;
		lastSourceKeyRef.current = sourceKey;
		if (open) {
			close();
		}
	}, [close, open, sourceKey]);

	useEffect(() => {
		return () => {
			requestId.invalidate();
		};
	}, [requestId]);

	const modalProps = useMemo<SkillSelectorModalProps>(
		() => ({
			open: visible,
			skills,
			isLoading,
			error,
			onClose: close,
			onRetry: load,
			onSelect: handleSelect,
		}),
		[close, error, handleSelect, isLoading, load, skills, visible],
	);

	return useMemo<SkillSelectorControllerHandle>(
		() => ({
			modalProps,
			open: openController,
			close,
		}),
		[close, modalProps, openController],
	);
}

export type FeatureRequestModalProps = {
	open: boolean;
	isSubmitting: boolean;
	targetRepository: string | null;
	isResolvingTarget: boolean;
	error: string | undefined;
	onClose: () => boolean;
	onSubmit: (description: string) => Promise<void>;
};

export type FeatureRequestControllerHandle = {
	modalProps: FeatureRequestModalProps;
	open: () => void;
	close: () => boolean;
	markSourceStale: () => void;
};

export type FeatureRequestControllerDeps<TConnection> = {
	connection: TConnection | null;
	resolveCurrentGitHubRepository: () => Promise<string>;
	executeSideChannelCommand: (
		connection: TConnection,
		command: string,
		timeoutMs: number,
	) => Promise<{
		success: boolean;
		output: string;
		error?: string;
		issueUrl?: string;
	}>;
	getErrorMessage: (error: unknown) => string;
	logger: {
		info: (message: string, payload?: unknown) => void;
		error: (message: string, payload?: unknown) => void;
	};
	closeOtherModals: () => void;
};

export function useFeatureRequestController<TConnection>(
	deps: FeatureRequestControllerDeps<TConnection>,
): FeatureRequestControllerHandle {
	const {
		connection,
		resolveCurrentGitHubRepository,
		executeSideChannelCommand,
		getErrorMessage,
		logger,
		closeOtherModals,
	} = deps;

	const [open, setOpen] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [targetRepository, setTargetRepository] = useState<string | null>(null);
	const [isResolvingTarget, setIsResolvingTarget] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);

	const resolveRequestId = useRequestId();
	const submitRequestId = useRequestId();
	const submitInFlightRef = useRef(false);
	const sourceStaleRef = useRef(false);

	const reset = useCallback(() => {
		setOpen(false);
		setIsSubmitting(false);
		setIsResolvingTarget(false);
		setTargetRepository(null);
		setError(undefined);
	}, []);

	const cancelRequests = useCallback(() => {
		resolveRequestId.invalidate();
		submitRequestId.invalidate();
	}, [resolveRequestId, submitRequestId]);

	const close = useCallback((): boolean => {
		if (submitInFlightRef.current || isSubmitting) {
			return false;
		}
		cancelRequests();
		sourceStaleRef.current = false;
		reset();
		return true;
	}, [cancelRequests, isSubmitting, reset]);

	const openController = useCallback(() => {
		if (isSubmitting) return;
		const id = resolveRequestId.next();
		submitRequestId.invalidate();
		closeOtherModals();
		reset();
		setOpen(true);

		void (async () => {
			setIsResolvingTarget(true);
			try {
				const repository = await resolveCurrentGitHubRepository();
				if (!resolveRequestId.isCurrent(id)) return;
				setTargetRepository(repository);
				setError(undefined);
			} catch (err) {
				if (!resolveRequestId.isCurrent(id)) return;
				setTargetRepository(null);
				setError(getErrorMessage(err));
			} finally {
				if (resolveRequestId.isCurrent(id)) {
					setIsResolvingTarget(false);
				}
			}
		})();
	}, [
		closeOtherModals,
		getErrorMessage,
		isSubmitting,
		reset,
		resolveCurrentGitHubRepository,
		resolveRequestId,
		submitRequestId,
	]);

	const submit = useCallback(
		async (description: string) => {
			if (submitInFlightRef.current) return;
			const id = submitRequestId.next();
			if (!connection) {
				setError('No SSH connection available');
				return;
			}
			if (!targetRepository) {
				setError('Could not resolve GitHub repository for current window.');
				return;
			}

			submitInFlightRef.current = true;
			sourceStaleRef.current = false;
			setIsSubmitting(true);
			setError(undefined);

			const command = buildCreateGitHubIssueCommand({
				description,
				repository: targetRepository,
			});

			try {
				const result = await executeSideChannelCommand(
					connection,
					command,
					60_000,
				);
				if (!submitRequestId.isCurrent(id)) return;
				if (sourceStaleRef.current) {
					reset();
					sourceStaleRef.current = false;
					return;
				}
				if (result.success) {
					logger.info('Feature request submitted successfully', {
						output: result.output,
						issueUrl: result.issueUrl,
					});
					setOpen(false);
					setError(undefined);
					sourceStaleRef.current = false;
					const alert = buildFeatureRequestSubmittedAlert({
						issueUrl: result.issueUrl ?? null,
					});
					Alert.alert(alert.title, alert.message, [{ text: 'OK' }]);
				} else {
					const errorMsg =
						result.error ||
						'Failed to create issue. Make sure gh and claude CLIs are installed and authenticated on the remote host.';
					logger.error('Feature request failed', { error: errorMsg });
					if (!submitRequestId.isCurrent(id)) return;
					setError(errorMsg);
				}
			} catch (err) {
				const errorMsg =
					err instanceof Error ? err.message : 'Unknown error occurred';
				logger.error('Feature request error', { error: err });
				if (!submitRequestId.isCurrent(id)) return;
				if (sourceStaleRef.current) {
					reset();
					sourceStaleRef.current = false;
					return;
				}
				setError(errorMsg);
			} finally {
				if (submitRequestId.isCurrent(id)) {
					submitInFlightRef.current = false;
					setIsSubmitting(false);
				}
			}
		},
		[
			connection,
			executeSideChannelCommand,
			logger,
			reset,
			submitRequestId,
			targetRepository,
		],
	);

	const markSourceStale = useCallback(() => {
		if (submitInFlightRef.current) {
			sourceStaleRef.current = true;
		} else {
			close();
		}
	}, [close]);

	useEffect(() => {
		return () => {
			cancelRequests();
			submitInFlightRef.current = false;
			sourceStaleRef.current = false;
		};
	}, [cancelRequests]);

	const modalProps = useMemo<FeatureRequestModalProps>(
		() => ({
			open,
			isSubmitting,
			targetRepository,
			isResolvingTarget,
			error,
			onClose: close,
			onSubmit: submit,
		}),
		[close, error, isResolvingTarget, isSubmitting, open, submit, targetRepository],
	);

	return useMemo<FeatureRequestControllerHandle>(
		() => ({
			modalProps,
			open: openController,
			close,
			markSourceStale,
		}),
		[close, markSourceStale, modalProps, openController],
	);
}
