import type { Repository } from '../ports';
import { Mutex, readJson, writeJson } from './json-file';

/**
 * A JSON-file-backed collection, newest first.
 * `limit` caps the size (oldest entries are dropped) — used for history.
 */
export class FileRepository<T extends { id: string }> implements Repository<T> {
  private readonly lock = new Mutex();

  constructor(
    private readonly file: string,
    private readonly limit = Infinity,
  ) {}

  private load(): Promise<T[]> {
    return readJson<T[]>(this.file, []);
  }

  list(): Promise<T[]> {
    return this.load();
  }

  async get(id: string): Promise<T | undefined> {
    return (await this.load()).find((x) => x.id === id);
  }

  upsert(item: T): Promise<void> {
    return this.lock.run(async () => {
      const items = await this.load();
      const i = items.findIndex((x) => x.id === item.id);
      if (i >= 0) items[i] = item;
      else items.unshift(item);
      await writeJson(this.file, items.slice(0, this.limit));
    });
  }

  remove(id: string): Promise<boolean> {
    return this.lock.run(async () => {
      const items = await this.load();
      const next = items.filter((x) => x.id !== id);
      if (next.length === items.length) return false;
      await writeJson(this.file, next);
      return true;
    });
  }

  clear(): Promise<void> {
    return this.lock.run(() => writeJson(this.file, []));
  }
}

export class MemoryRepository<T extends { id: string }> implements Repository<T> {
  private items: T[] = [];
  async list() {
    return [...this.items];
  }
  async get(id: string) {
    return this.items.find((x) => x.id === id);
  }
  async upsert(item: T) {
    const i = this.items.findIndex((x) => x.id === item.id);
    if (i >= 0) this.items[i] = item;
    else this.items.unshift(item);
  }
  async remove(id: string) {
    const before = this.items.length;
    this.items = this.items.filter((x) => x.id !== id);
    return this.items.length !== before;
  }
  async clear() {
    this.items = [];
  }
}
