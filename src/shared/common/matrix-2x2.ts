/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/common/Mat22.ts
 * MIT licensed; see LICENSE in the repository root.
 */
/*
 * Planck.js
 *
 * Copyright (c) Erin Catto, Ali Shakiba
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Vec2 } from '../vector';

/**
 * A 2-by-2 matrix. Stored in column-major order.
 */
export class Mat22 {
  ex = Vec2.zero();
  ey = Vec2.zero();

  setZero(): void {
    this.ex.x = 0;
    this.ey.x = 0;
    this.ex.y = 0;
    this.ey.y = 0;
  }
}
