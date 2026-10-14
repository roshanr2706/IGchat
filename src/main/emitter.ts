// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => void;

export class Emitter<M extends { [K in keyof M]: AnyFn }> {
  private readonly listeners = new Map<keyof M, Set<AnyFn>>();

  on<K extends keyof M>(event: K, fn: M[K]): () => void {
    const set = this.listeners.get(event) ?? new Set<AnyFn>();
    this.listeners.set(event, set);
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  emit<K extends keyof M>(event: K, ...args: Parameters<M[K]>): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) {
      try {
        fn(...args);
      } catch (err) {
        console.error('[emitter]', err);
      }
    }
  }
}
