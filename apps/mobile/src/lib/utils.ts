import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient();

export type StrictOmit<T, K extends keyof T> = Omit<T, K>;
