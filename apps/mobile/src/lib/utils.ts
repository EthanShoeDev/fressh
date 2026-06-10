import * as Cause from 'effect/Cause';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { use, type Context } from 'react';

export type StrictOmit<T, K extends keyof T> = Omit<T, K>;

/** Human-readable message for a failed atom `AsyncResult`, or `null` otherwise. */
export const asyncResultErrorMessage = (
	result: AsyncResult.AsyncResult<unknown, unknown>,
) => {
	if (!AsyncResult.isFailure(result)) {
		return null;
	}
	const error = Cause.squash(result.cause);
	return error instanceof Error ? error.message : String(error);
};

export const AbortSignalTimeout = (timeout: number) => {
	// AbortSignal.timeout is not available as of expo 54
	// TypeError: AbortSignal.timeout is not a function (it is undefined)
	const controller = new AbortController();
	setTimeout(() => {
		controller.abort();
	}, timeout);
	return controller.signal;
};

export const useContextSafe = <T>(context: Context<T>) => {
	const contextValue = use(context);
	if (!contextValue) {
		throw new Error('Context not found');
	}
	return contextValue;
};
