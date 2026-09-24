export class TtlCache<K, V> {
  private readonly values = new Map<K, { at: number; value: V }>();
  private readonly inflight = new Map<K, Promise<V>>();

  constructor(private readonly ttlMs: number) {}

  get(key: K, load: () => Promise<V>): Promise<V> {
    const hit = this.values.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return Promise.resolve(hit.value);

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = load()
      .then((value) => {
        this.values.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }
}
