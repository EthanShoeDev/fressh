import UniffiRussh from './NativeUniffiRussh';

export function multiply(a: number, b: number): number {
  return UniffiRussh.multiply(a, b);
}
