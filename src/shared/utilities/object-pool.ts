/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/util/Pool.ts
 * MIT licensed; see LICENSE in the repository root.
 */
/*
 * Planck.js
 *
 * Copyright (c) Ali Shakiba
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
interface PoolOptions<T> {
  create: () => T;
  release: (item: T) => void;
}

// Reuses contact and tree objects without changing their allocation order.
export class Pool<T> {
  private readonly items: T[] = [];

  constructor(private readonly options: PoolOptions<T>) {}

  allocate(): T {
    return this.items.length > 0 ? this.items.shift()! : this.options.create();
  }

  release(item: T): void {
    this.options.release(item);
    this.items.push(item);
  }
}
