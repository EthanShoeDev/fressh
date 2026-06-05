type MutableRef<T> = {
	current: T;
};

type ShellListenerOwner = {
	removeListener: (id: bigint) => void;
};

type ListenerLogger = {
	warn: (message: string, error: unknown) => void;
};

export function detachTerminalShellListener({
	shell,
	listenerOwnerRef,
	listenerIdRef,
	attachedShellKeyRef,
	logger,
}: {
	shell?: ShellListenerOwner | null | undefined;
	listenerOwnerRef: MutableRef<ShellListenerOwner | null>;
	listenerIdRef: MutableRef<bigint | null>;
	attachedShellKeyRef: MutableRef<string | null>;
	logger: ListenerLogger;
}): void {
	const owner = listenerOwnerRef.current ?? shell;
	if (listenerIdRef.current != null && owner) {
		try {
			owner.removeListener(listenerIdRef.current);
		} catch (error) {
			logger.warn('Failed to remove prior shell listener', error);
		}
	}
	listenerIdRef.current = null;
	listenerOwnerRef.current = null;
	attachedShellKeyRef.current = null;
}
