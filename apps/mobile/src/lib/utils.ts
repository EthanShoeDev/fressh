import * as Cause from 'effect/Cause';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
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

export const useContextSafe = <T extends object>(
  context: Context<T | null | undefined>,
) => {
  const contextValue = use(context);
  if (contextValue === null || contextValue === undefined) {
    throw new Error('Context not found');
  }
  return contextValue;
};
