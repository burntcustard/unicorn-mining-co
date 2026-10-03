interface PoolOptions<T> {
  create: () => T;
  release: (item: T) => void;
}

// Reuses contact and tree objects without changing their allocation order.
export class Pool<T> {
  private readonly items: T[] = [];
  private readonly options: PoolOptions<T>;

  allocate(): T {
    return this.items.length > 0 ? this.items.shift()! : this.options.create();
  }

  constructor(options: PoolOptions<T>) {
    this.options = options;
  }

  release(item: T): void {
    this.options.release(item);
    this.items.push(item);
  }
}
