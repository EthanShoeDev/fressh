import { useCallback, useRef, useState, type RefObject } from 'react';

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

	return {
		commandPresets: {
			open: commandPresetsOpen,
			onOpen: openCommandPresets,
			onClose: closeCommandPresets,
		},
		commander: {
			open: commanderOpen,
			onOpen: openCommander,
			onClose: closeCommander,
		},
		textEntry: {
			open: textEntryOpen,
			openRef: textEntryOpenRef,
			onOpen: openTextEntry,
			onClose: closeTextEntry,
		},
		configure: {
			open: configureOpen,
			onOpen: openConfigure,
			onClose: closeConfigure,
		},
	};
}
