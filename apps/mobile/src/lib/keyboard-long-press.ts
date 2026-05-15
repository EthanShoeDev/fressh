export type LongPressPopupLayout = {
	left: number;
	top: number;
	width: number;
	height: number;
	optionWidth: number;
};

export type LongPressReleaseDecision =
	| { type: 'tap' }
	| { type: 'option'; optionIndex: number }
	| { type: 'cancel' };

export type LongPressMoveState = {
	movedBeyondTapSlop: boolean;
	keepLongPressTimer: boolean;
};

export type LongPressKeyboardBounds = {
	left: number;
	top: number;
	width: number;
	height: number;
};

const horizontalMargin = 6;
const optionWidth = 86;
const popupHeight = 44;
const popupGap = 10;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

export function getLongPressPopupLayout({
	keyboardWidth,
	anchorX,
	anchorY,
	anchorWidth,
	optionCount,
}: {
	keyboardWidth: number;
	anchorX: number;
	anchorY: number;
	anchorWidth: number;
	optionCount: number;
}): LongPressPopupLayout {
	const width = Math.max(optionWidth, optionCount * optionWidth);
	const centeredLeft = anchorX + anchorWidth / 2 - width / 2;
	const maxLeft = Math.max(
		horizontalMargin,
		keyboardWidth - width - horizontalMargin,
	);

	return {
		left: clamp(centeredLeft, horizontalMargin, maxLeft),
		top: Math.max(horizontalMargin, anchorY - popupHeight - popupGap),
		width,
		height: popupHeight,
		optionWidth,
	};
}

export function getLongPressOptionIndexAtPoint({
	layout,
	localX,
	localY,
}: {
	layout: LongPressPopupLayout;
	localX: number;
	localY: number;
}): number | null {
	if (
		localX < layout.left ||
		localX >= layout.left + layout.width ||
		localY < layout.top ||
		localY >= layout.top + layout.height
	) {
		return null;
	}

	const index = Math.floor((localX - layout.left) / layout.optionWidth);
	const optionCount = Math.floor(layout.width / layout.optionWidth);
	return index >= 0 && index < optionCount ? index : null;
}

export function getLongPressOptionIndexAtX({
	layout,
	localX,
}: {
	layout: LongPressPopupLayout;
	localX: number;
}): number | null {
	const optionCount = Math.floor(layout.width / layout.optionWidth);
	if (optionCount <= 0) return null;

	const rawIndex = Math.floor((localX - layout.left) / layout.optionWidth);
	return clamp(rawIndex, 0, optionCount - 1);
}

export function getLongPressKeyboardBoundedOptionIndex({
	layout,
	keyboardBounds,
	localX,
	localY,
}: {
	layout: LongPressPopupLayout;
	keyboardBounds: LongPressKeyboardBounds;
	localX: number;
	localY: number;
}): number | null {
	if (
		localX < keyboardBounds.left ||
		localX >= keyboardBounds.left + keyboardBounds.width ||
		localY < keyboardBounds.top ||
		localY >= keyboardBounds.top + keyboardBounds.height
	) {
		return null;
	}

	return getLongPressOptionIndexAtX({ layout, localX });
}

export function getLongPressTrackedOptionIndex({
	layout,
	keyboardBounds,
	localX,
	localY,
	previousIndex,
}: {
	layout: LongPressPopupLayout;
	keyboardBounds?: LongPressKeyboardBounds | null;
	localX: number;
	localY: number;
	previousIndex: number | null;
}): number | null {
	if (keyboardBounds) {
		return getLongPressKeyboardBoundedOptionIndex({
			layout,
			keyboardBounds,
			localX,
			localY,
		});
	}

	const optionIndex = getLongPressOptionIndexAtPoint({
		layout,
		localX,
		localY,
	});
	if (optionIndex != null || previousIndex == null) {
		return optionIndex;
	}

	const previousLeft = layout.left + previousIndex * layout.optionWidth;
	const previousRight = previousLeft + layout.optionWidth;
	return localX >= previousLeft && localX < previousRight
		? previousIndex
		: null;
}

export function getLongPressMoveState({
	longPressFired,
	movedBeyondTapSlop,
	startPageX,
	startPageY,
	currentPageX,
	currentPageY,
	tapSlopPx,
}: {
	longPressFired: boolean;
	movedBeyondTapSlop: boolean;
	startPageX: number;
	startPageY: number;
	currentPageX: number;
	currentPageY: number;
	tapSlopPx: number;
}): LongPressMoveState {
	if (longPressFired) {
		return { movedBeyondTapSlop, keepLongPressTimer: false };
	}

	return {
		movedBeyondTapSlop:
			movedBeyondTapSlop ||
			Math.hypot(currentPageX - startPageX, currentPageY - startPageY) >
				tapSlopPx,
		keepLongPressTimer: true,
	};
}

export function getLongPressReleaseDecision({
	longPressFired,
	movedBeyondTapSlop,
	startPageX,
	startPageY,
	releasePageX,
	releasePageY,
	tapSlopPx,
	rootX,
	rootY,
	popupLayout,
	keyboardBounds,
	highlightedIndex,
}: {
	longPressFired: boolean;
	movedBeyondTapSlop: boolean;
	startPageX: number;
	startPageY: number;
	releasePageX: number;
	releasePageY: number;
	tapSlopPx: number;
	rootX: number;
	rootY: number;
	popupLayout: LongPressPopupLayout | null;
	keyboardBounds?: LongPressKeyboardBounds | null;
	highlightedIndex?: number | null;
}): LongPressReleaseDecision {
	if (longPressFired) {
		if (!popupLayout) return { type: 'cancel' };

		const localX = releasePageX - rootX;
		const localY = releasePageY - rootY;
		const optionIndex = keyboardBounds
			? getLongPressKeyboardBoundedOptionIndex({
					layout: popupLayout,
					keyboardBounds,
					localX,
					localY,
				})
			: getLongPressOptionIndexAtPoint({
					layout: popupLayout,
					localX,
					localY,
				});

		if (optionIndex != null) {
			return { type: 'option', optionIndex };
		}

		if (!keyboardBounds && highlightedIndex != null) {
			const highlightedLeft =
				popupLayout.left + highlightedIndex * popupLayout.optionWidth;
			const highlightedRight = highlightedLeft + popupLayout.optionWidth;
			if (localX >= highlightedLeft && localX < highlightedRight) {
				return { type: 'option', optionIndex: highlightedIndex };
			}
		}

		return { type: 'cancel' };
	}

	if (
		movedBeyondTapSlop ||
		Math.hypot(releasePageX - startPageX, releasePageY - startPageY) > tapSlopPx
	) {
		return { type: 'cancel' };
	}

	return { type: 'tap' };
}
