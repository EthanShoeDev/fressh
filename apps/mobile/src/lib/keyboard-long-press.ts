export type LongPressPopupLayout = {
	left: number;
	top: number;
	width: number;
	height: number;
	optionWidth: number;
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
