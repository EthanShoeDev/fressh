export function extractTmuxAttachFailureReason(error: unknown): string | null {
	if (!error || typeof error !== 'object') return null;

	const candidate = error as { inner?: unknown; tag?: unknown };
	if (candidate.tag !== 'TmuxAttachFailed') return null;
	if (!Array.isArray(candidate.inner)) return null;

	const reason = candidate.inner[0];
	if (typeof reason !== 'string') return null;

	const trimmed = reason.trim();
	return trimmed.length ? trimmed : null;
}
