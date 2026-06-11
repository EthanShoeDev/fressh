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

export const useContextSafe = <T>(context: Context<T>) => {
	const contextValue = use(context);
	if (!contextValue) {
		throw new Error('Context not found');
	}
	return contextValue;
};
