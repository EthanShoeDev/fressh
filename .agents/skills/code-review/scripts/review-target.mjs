export const CANONICAL_UNCOMMITTED_REVIEW_TARGET = '--uncommitted';

export function canonicalizeReviewTarget(reviewTarget) {
	const normalizedTarget = String(reviewTarget ?? '').trim();
	if (!normalizedTarget) {
		throw new Error('reviewTarget is required');
	}

	if (
		normalizedTarget === 'uncommitted' ||
		normalizedTarget === CANONICAL_UNCOMMITTED_REVIEW_TARGET
	) {
		return CANONICAL_UNCOMMITTED_REVIEW_TARGET;
	}

	const [flag, ...rest] = normalizedTarget.split(/\s+/);
	if (
		(flag === '--base' || flag === '--commit' || flag === '--pr') &&
		rest.length === 1
	) {
		return `${flag} ${rest[0]}`;
	}

	return normalizedTarget;
}

export function parseNormalizedReviewTarget(reviewTarget) {
	const canonicalTarget = canonicalizeReviewTarget(reviewTarget);

	if (canonicalTarget === CANONICAL_UNCOMMITTED_REVIEW_TARGET) {
		return {
			canonicalTarget,
			kind: 'uncommitted',
		};
	}

	const [flag, ...rest] = canonicalTarget.split(/\s+/);
	if (
		(flag === '--base' || flag === '--commit' || flag === '--pr') &&
		rest.length === 1
	) {
		return {
			canonicalTarget,
			kind: flag === '--base' ? 'base' : flag === '--commit' ? 'commit' : 'pr',
			value: rest[0],
		};
	}

	if (flag.startsWith('--')) {
		throw new Error(`Unsupported reviewTarget: ${reviewTarget}`);
	}

	return {
		canonicalTarget,
		kind: 'literal',
		value: canonicalTarget,
	};
}
