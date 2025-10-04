import { QueryClient } from '@tanstack/react-query';
import { use, type Context } from 'react';

export const queryClient = new QueryClient();

export type StrictOmit<T, K extends keyof T> = Omit<T, K>;

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