import * as Linking from 'expo-linking';
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
	resolveBrowserActionsPaneContext,
	resolveBrowserActionsPanePath,
	runBrowserActionsDiffityShare,
} from '@/lib/browser-actions-controller-actions';
import { runDetectedOpenControllerRequest } from '@/lib/detected-open-actions';
import { formatWorkmuxAppCommandFailureMessage } from '@/lib/workmux-app-commands';
import {
	buildHostBrowserStatusCycleCommand,
	buildTmuxWindowConfigGetCommand,
	buildTmuxWindowConfigSetCommand,
	extractLastHttpsUrl,
	getHostBrowserUrlSlotLabel,
	parseHostBrowserUrlInput,
	type HostBrowserOpenMode,
	type HostBrowserUrlSlot,
} from './host-browser-actions';
import {
	buildCreateGitHubIssueCommand,
	buildFeatureRequestSubmittedAlert,
	buildGitHubRepositoryTargetUrl,
	buildResolveGitHubRepositoryCommand,
	parseGitHubRepositoryResolutionOutput,
	type GitHubRepositoryTarget,
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
	runHostBrowserCommand: (
		command: string,
		timeoutMs?: number,
	) => Promise<string>;
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
		[
			close,
			error,
			isResolvingTarget,
			isSubmitting,
			open,
			submit,
			targetRepository,
		],
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

export type HostUrlModalMode = 'edit' | 'open-missing';

export type HostUrlModalStateValue = {
	mode: HostUrlModalMode;
	slot: HostBrowserUrlSlot;
	panePath: string;
	initialValue: string;
};

export type BrowserActionsModalProps = {
	open: boolean;
	onClose: () => void;
	onOpenDiff: () => void;
	onOpenGitHubIssues: () => void;
	onOpenGitHubPulls: () => void;
	onOpenDetectedAuto: () => boolean;
	onOpenDetectedPick: () => boolean;
	onOpenUrlSlot: (slot: HostBrowserUrlSlot) => void;
	onEditUrlSlot: (slot: HostBrowserUrlSlot) => void;
};

export type HostUrlModalProps = {
	open: boolean;
	slot: HostBrowserUrlSlot | null;
	slotLabel: string;
	initialValue: string;
	mode: HostUrlModalMode;
	isSubmitting: boolean;
	error: string | null;
	onClose: () => void;
	onSubmit: (value: string) => void;
};

export type BrowserActionsControllerHandle = {
	browserActionsProps: BrowserActionsModalProps;
	hostUrlProps: HostUrlModalProps;
	open: () => void;
	close: () => void;
	resolveHostBrowserPanePath: () => Promise<string>;
	resolveCurrentGitHubRepository: () => Promise<string>;
	runHostBrowserCommand: (
		command: string,
		timeoutMs?: number,
	) => Promise<string>;
	invalidateHostUrlReads: () => void;
	invalidateAll: () => void;
	cycleWorkmuxStatus: () => void;
};

export type BrowserActionsControllerDeps<TConnection> = {
	connection: TConnection | null;
	tmuxEnabled: boolean;
	tmuxTarget: string;
	executeSideChannelCommand: (
		connection: TConnection,
		command: string,
		timeoutMs: number,
	) => Promise<{ success: boolean; output: string; error?: string }>;
	getErrorMessage: (error: unknown) => string;
	closeOtherModals: () => boolean;
};

export function useBrowserActionsController<TConnection>(
	deps: BrowserActionsControllerDeps<TConnection>,
): BrowserActionsControllerHandle {
	const {
		connection,
		tmuxEnabled,
		tmuxTarget,
		executeSideChannelCommand,
		getErrorMessage,
		closeOtherModals,
	} = deps;

	const [open, setOpen] = useState(false);
	const [hostUrlModalState, setHostUrlModalState] =
		useState<HostUrlModalStateValue | null>(null);
	const [hostUrlModalSubmitting, setHostUrlModalSubmitting] = useState(false);
	const [hostUrlModalError, setHostUrlModalError] = useState<string | null>(
		null,
	);

	const hostUrlReadRequestId = useRequestId();
	const hostUrlSubmitRequestId = useRequestId();
	const hostUrlSubmitInFlightRef = useRef(false);
	const browserGitHubTargetRequestId = useRequestId();
	const hostDiffityRequestId = useRequestId();
	const hostDiffityInFlightRef = useRef(false);
	const hostDetectedOpenRequestId = useRequestId();
	const hostDetectedOpenInFlightRef = useRef(false);

	const showError = useCallback((title: string, message: string) => {
		Alert.alert(title, message);
	}, []);

	const runHostBrowserCommand = useCallback(
		async (command: string, timeoutMs = 30_000) => {
			if (!connection) {
				throw new Error('No SSH connection available.');
			}
			const result = await executeSideChannelCommand(
				connection,
				command,
				timeoutMs,
			);
			if (!result.success) {
				const rawMessage =
					result.error || result.output || 'Remote command failed.';
				throw new Error(
					command.startsWith('mdev tmux app ')
						? formatWorkmuxAppCommandFailureMessage(rawMessage)
						: rawMessage,
				);
			}
			return result.output.trim();
		},
		[connection, executeSideChannelCommand],
	);

	const resolveHostBrowserPanePath = useCallback(async () => {
		return resolveBrowserActionsPanePath({
			tmuxEnabled,
			tmuxTarget,
			runHostBrowserCommand,
			getErrorMessage,
		});
	}, [getErrorMessage, runHostBrowserCommand, tmuxEnabled, tmuxTarget]);

	const resolveHostBrowserPaneContext = useCallback(async () => {
		return resolveBrowserActionsPaneContext({
			tmuxEnabled,
			tmuxTarget,
			runHostBrowserCommand,
			getErrorMessage,
		});
	}, [getErrorMessage, runHostBrowserCommand, tmuxEnabled, tmuxTarget]);

	const resolveCurrentGitHubRepository = useCallback(async () => {
		const panePath = await resolveHostBrowserPanePath();
		const output = await runHostBrowserCommand(
			buildResolveGitHubRepositoryCommand(panePath),
			10_000,
		);
		const repository = parseGitHubRepositoryResolutionOutput(output);
		if (!repository) {
			throw new Error(
				'Could not resolve GitHub repository for current window.',
			);
		}
		return repository;
	}, [resolveHostBrowserPanePath, runHostBrowserCommand]);

	const openAndroidUrl = useCallback(
		async (url: string) => {
			try {
				await Linking.openURL(url);
			} catch (error) {
				throw new Error(
					`Android could not open ${url}: ${getErrorMessage(error)}`,
				);
			}
		},
		[getErrorMessage],
	);

	const invalidateHostUrlReads = useCallback(() => {
		hostUrlReadRequestId.invalidate();
	}, [hostUrlReadRequestId]);

	const resetHostUrlModal = useCallback(() => {
		hostUrlReadRequestId.invalidate();
		hostUrlSubmitRequestId.invalidate();
		hostUrlSubmitInFlightRef.current = false;
		setHostUrlModalState(null);
		setHostUrlModalSubmitting(false);
		setHostUrlModalError(null);
	}, [hostUrlReadRequestId, hostUrlSubmitRequestId]);

	const openController = useCallback(() => {
		invalidateHostUrlReads();
		if (!closeOtherModals()) return;
		resetHostUrlModal();
		setOpen(true);
	}, [closeOtherModals, invalidateHostUrlReads, resetHostUrlModal]);

	const close = useCallback(() => {
		setOpen(false);
	}, []);

	const handleOpenGitHubTarget = useCallback(
		(target: GitHubRepositoryTarget) => {
			const id = browserGitHubTargetRequestId.next();
			const title =
				target === 'issues'
					? 'GitHub Issues failed'
					: 'GitHub Pull Requests failed';
			void (async () => {
				try {
					const repository = await resolveCurrentGitHubRepository();
					if (!browserGitHubTargetRequestId.isCurrent(id)) return;
					const url = buildGitHubRepositoryTargetUrl(repository, target);
					await openAndroidUrl(url);
				} catch (err) {
					if (!browserGitHubTargetRequestId.isCurrent(id)) return;
					showError(title, getErrorMessage(err));
				}
			})();
		},
		[
			browserGitHubTargetRequestId,
			getErrorMessage,
			openAndroidUrl,
			resolveCurrentGitHubRepository,
			showError,
		],
	);

	const handleOpenGitHubIssuesTarget = useCallback(
		() => handleOpenGitHubTarget('issues'),
		[handleOpenGitHubTarget],
	);
	const handleOpenGitHubPullsTarget = useCallback(
		() => handleOpenGitHubTarget('pulls'),
		[handleOpenGitHubTarget],
	);

	const handleOpenHostDiffity = useCallback(() => {
		if (hostDiffityInFlightRef.current) return;
		const id = hostDiffityRequestId.next();
		hostDiffityInFlightRef.current = true;
		void (async () => {
			try {
				const output = await runBrowserActionsDiffityShare({
					tmuxEnabled,
					tmuxTarget,
					runHostBrowserCommand,
					getErrorMessage,
				});
				const url = extractLastHttpsUrl(output);
				if (!url) {
					throw new Error(
						output || 'mdev diffity share did not return an HTTPS URL.',
					);
				}
				if (!hostDiffityRequestId.isCurrent(id)) return;
				await openAndroidUrl(url);
			} catch (err) {
				if (!hostDiffityRequestId.isCurrent(id)) return;
				showError('Diffity failed', getErrorMessage(err));
			} finally {
				hostDiffityInFlightRef.current = false;
			}
		})();
	}, [
		getErrorMessage,
		hostDiffityRequestId,
		openAndroidUrl,
		runHostBrowserCommand,
		showError,
		tmuxEnabled,
		tmuxTarget,
	]);

	const handleOpenDetected = useCallback(
		(mode: HostBrowserOpenMode): boolean => {
			const result = runDetectedOpenControllerRequest({
				mode,
				inFlightRef: hostDetectedOpenInFlightRef,
				requestId: hostDetectedOpenRequestId,
				resolvePaneContext: resolveHostBrowserPaneContext,
				runHostBrowserCommand,
				setOpen,
				showError,
				getErrorMessage,
			});
			return result.accepted;
		},
		[
			getErrorMessage,
			hostDetectedOpenRequestId,
			resolveHostBrowserPaneContext,
			runHostBrowserCommand,
			showError,
		],
	);

	const handleOpenDetectedAuto = useCallback(
		() => handleOpenDetected('auto'),
		[handleOpenDetected],
	);

	const handleOpenDetectedPick = useCallback(
		() => handleOpenDetected('pick'),
		[handleOpenDetected],
	);

	const handleOpenHostUrlSlot = useCallback(
		(slot: HostBrowserUrlSlot) => {
			setOpen(false);
			const id = hostUrlReadRequestId.next();
			void (async () => {
				try {
					const panePath = await resolveHostBrowserPanePath();
					if (!hostUrlReadRequestId.isCurrent(id)) return;
					const value = await runHostBrowserCommand(
						buildTmuxWindowConfigGetCommand(slot, panePath),
						10_000,
					);
					if (!hostUrlReadRequestId.isCurrent(id)) return;
					const savedUrl = value.trim();
					if (savedUrl) {
						const parsed = parseHostBrowserUrlInput(savedUrl);
						if (parsed.type === 'invalid') {
							setHostUrlModalState({
								mode: 'edit',
								slot,
								panePath,
								initialValue: savedUrl,
							});
							setHostUrlModalError(parsed.message);
							return;
						}
						if (parsed.type === 'empty') return;
						await openAndroidUrl(parsed.url);
						return;
					}
					setHostUrlModalError(null);
					setHostUrlModalState({
						mode: 'open-missing',
						slot,
						panePath,
						initialValue: '',
					});
				} catch (err) {
					if (!hostUrlReadRequestId.isCurrent(id)) return;
					showError(
						`${getHostBrowserUrlSlotLabel(slot)} failed`,
						getErrorMessage(err),
					);
				}
			})();
		},
		[
			getErrorMessage,
			hostUrlReadRequestId,
			openAndroidUrl,
			resolveHostBrowserPanePath,
			runHostBrowserCommand,
			showError,
		],
	);

	const handleEditHostUrlSlot = useCallback(
		(slot: HostBrowserUrlSlot) => {
			setOpen(false);
			const id = hostUrlReadRequestId.next();
			void (async () => {
				try {
					const panePath = await resolveHostBrowserPanePath();
					if (!hostUrlReadRequestId.isCurrent(id)) return;
					const value = await runHostBrowserCommand(
						buildTmuxWindowConfigGetCommand(slot, panePath),
						10_000,
					);
					if (!hostUrlReadRequestId.isCurrent(id)) return;
					setHostUrlModalError(null);
					setHostUrlModalState({
						mode: 'edit',
						slot,
						panePath,
						initialValue: value.trim(),
					});
				} catch (err) {
					if (!hostUrlReadRequestId.isCurrent(id)) return;
					showError(
						`Edit ${getHostBrowserUrlSlotLabel(slot)} failed`,
						getErrorMessage(err),
					);
				}
			})();
		},
		[
			getErrorMessage,
			hostUrlReadRequestId,
			resolveHostBrowserPanePath,
			runHostBrowserCommand,
			showError,
		],
	);

	const handleCloseHostUrlModal = useCallback(() => {
		if (hostUrlSubmitInFlightRef.current || hostUrlModalSubmitting) return;
		resetHostUrlModal();
	}, [hostUrlModalSubmitting, resetHostUrlModal]);

	const handleSubmitHostUrlModal = useCallback(
		(value: string) => {
			const state = hostUrlModalState;
			if (!state) return;
			const parsed = parseHostBrowserUrlInput(value);
			if (parsed.type === 'empty') {
				setHostUrlModalState(null);
				setHostUrlModalError(null);
				return;
			}
			if (parsed.type === 'invalid') {
				setHostUrlModalError(parsed.message);
				return;
			}
			if (hostUrlSubmitInFlightRef.current) return;
			const id = hostUrlSubmitRequestId.next();
			hostUrlSubmitInFlightRef.current = true;
			void (async () => {
				setHostUrlModalSubmitting(true);
				setHostUrlModalError(null);
				try {
					await runHostBrowserCommand(
						buildTmuxWindowConfigSetCommand(
							state.slot,
							state.panePath,
							parsed.url,
						),
						10_000,
					);
					if (!hostUrlSubmitRequestId.isCurrent(id)) return;
					if (state.mode === 'open-missing') {
						await openAndroidUrl(parsed.url);
						if (!hostUrlSubmitRequestId.isCurrent(id)) return;
					}
					setHostUrlModalState(null);
				} catch (err) {
					if (!hostUrlSubmitRequestId.isCurrent(id)) return;
					setHostUrlModalError(getErrorMessage(err));
				} finally {
					if (hostUrlSubmitRequestId.isCurrent(id)) {
						hostUrlSubmitInFlightRef.current = false;
						setHostUrlModalSubmitting(false);
					}
				}
			})();
		},
		[
			getErrorMessage,
			hostUrlModalState,
			hostUrlSubmitRequestId,
			openAndroidUrl,
			runHostBrowserCommand,
		],
	);

	const cycleWorkmuxStatus = useCallback(() => {
		void (async () => {
			try {
				if (!tmuxEnabled) {
					throw new Error('Status cycle requires a tmux-enabled connection.');
				}
				const sessionName = tmuxTarget.trim() || 'main';
				await runHostBrowserCommand(
					buildHostBrowserStatusCycleCommand(sessionName),
					10_000,
				);
			} catch (err) {
				showError('Status cycle failed', getErrorMessage(err));
			}
		})();
	}, [
		getErrorMessage,
		runHostBrowserCommand,
		showError,
		tmuxEnabled,
		tmuxTarget,
	]);

	const invalidateAll = useCallback(() => {
		hostUrlReadRequestId.invalidate();
		hostUrlSubmitRequestId.invalidate();
		browserGitHubTargetRequestId.invalidate();
		hostDiffityRequestId.invalidate();
		hostDetectedOpenRequestId.invalidate();
		hostUrlSubmitInFlightRef.current = false;
		hostDiffityInFlightRef.current = false;
		hostDetectedOpenInFlightRef.current = false;
		setHostUrlModalState(null);
		setHostUrlModalSubmitting(false);
		setHostUrlModalError(null);
	}, [
		browserGitHubTargetRequestId,
		hostDetectedOpenRequestId,
		hostDiffityRequestId,
		hostUrlReadRequestId,
		hostUrlSubmitRequestId,
	]);

	useEffect(() => {
		return () => {
			hostUrlReadRequestId.invalidate();
			hostUrlSubmitRequestId.invalidate();
			hostUrlSubmitInFlightRef.current = false;
			browserGitHubTargetRequestId.invalidate();
			hostDiffityRequestId.invalidate();
			hostDiffityInFlightRef.current = false;
			hostDetectedOpenRequestId.invalidate();
			hostDetectedOpenInFlightRef.current = false;
		};
	}, [
		browserGitHubTargetRequestId,
		hostDetectedOpenRequestId,
		hostDiffityRequestId,
		hostUrlReadRequestId,
		hostUrlSubmitRequestId,
	]);

	const browserActionsProps = useMemo<BrowserActionsModalProps>(
		() => ({
			open,
			onClose: close,
			onOpenDiff: handleOpenHostDiffity,
			onOpenGitHubIssues: handleOpenGitHubIssuesTarget,
			onOpenGitHubPulls: handleOpenGitHubPullsTarget,
			onOpenDetectedAuto: handleOpenDetectedAuto,
			onOpenDetectedPick: handleOpenDetectedPick,
			onOpenUrlSlot: handleOpenHostUrlSlot,
			onEditUrlSlot: handleEditHostUrlSlot,
		}),
		[
			close,
			handleEditHostUrlSlot,
			handleOpenDetectedAuto,
			handleOpenDetectedPick,
			handleOpenGitHubIssuesTarget,
			handleOpenGitHubPullsTarget,
			handleOpenHostDiffity,
			handleOpenHostUrlSlot,
			open,
		],
	);

	const hostUrlProps = useMemo<HostUrlModalProps>(
		() => ({
			open: hostUrlModalState != null,
			slot: hostUrlModalState?.slot ?? null,
			slotLabel: hostUrlModalState
				? getHostBrowserUrlSlotLabel(hostUrlModalState.slot)
				: 'URL',
			initialValue: hostUrlModalState?.initialValue ?? '',
			mode: hostUrlModalState?.mode ?? 'edit',
			isSubmitting: hostUrlModalSubmitting,
			error: hostUrlModalError,
			onClose: handleCloseHostUrlModal,
			onSubmit: handleSubmitHostUrlModal,
		}),
		[
			handleCloseHostUrlModal,
			handleSubmitHostUrlModal,
			hostUrlModalError,
			hostUrlModalState,
			hostUrlModalSubmitting,
		],
	);

	return useMemo<BrowserActionsControllerHandle>(
		() => ({
			browserActionsProps,
			hostUrlProps,
			open: openController,
			close,
			resolveHostBrowserPanePath,
			resolveCurrentGitHubRepository,
			runHostBrowserCommand,
			invalidateHostUrlReads,
			invalidateAll,
			cycleWorkmuxStatus,
		}),
		[
			browserActionsProps,
			close,
			cycleWorkmuxStatus,
			hostUrlProps,
			invalidateAll,
			invalidateHostUrlReads,
			openController,
			resolveCurrentGitHubRepository,
			resolveHostBrowserPanePath,
			runHostBrowserCommand,
		],
	);
}
