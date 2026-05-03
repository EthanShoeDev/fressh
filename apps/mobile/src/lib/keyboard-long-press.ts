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
	highlightedIndex?: number | null;
}): LongPressReleaseDecision {
	if (longPressFired) {
		if (!popupLayout) return { type: 'cancel' };

		const localX = releasePageX - rootX;
		const optionIndex = getLongPressOptionIndexAtPoint({
			layout: popupLayout,
			localX,
			localY: releasePageY - rootY,
		});

		if (optionIndex != null) {
			return { type: 'option', optionIndex };
		}

		if (highlightedIndex != null) {
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
