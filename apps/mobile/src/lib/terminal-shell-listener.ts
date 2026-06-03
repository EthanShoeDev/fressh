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
	listenerIdRef,
	attachedShellKeyRef,
	logger,
}: {
	shell: ShellListenerOwner | null | undefined;
	listenerIdRef: MutableRef<bigint | null>;
	attachedShellKeyRef: MutableRef<string | null>;
	logger: ListenerLogger;
}): void {
	if (listenerIdRef.current != null && shell) {
		try {
			shell.removeListener(listenerIdRef.current);
		} catch (error) {
			logger.warn('Failed to remove prior shell listener', error);
		}
	}
	listenerIdRef.current = null;
	attachedShellKeyRef.current = null;
}
