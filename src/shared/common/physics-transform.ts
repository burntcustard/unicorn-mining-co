/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/common/Transform.ts
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

import { Vec2, Vec2Value } from '../vector';
import { setRotAngle } from './physics-matrix';

export interface RotValue {
  s: number;
  c: number;
}

export interface TransformValue {
  p: Vec2Value;
  q: RotValue;
}

// Position and rotation of a collider in the solver.
export class Transform implements TransformValue {
  p = Vec2.zero();
  q: RotValue = { s: 0, c: 1 };

  constructor(position?: Vec2Value, rotation?: number) {
    if (position) this.p.setVec2(position);

    if (rotation !== undefined) setRotAngle(this.q, rotation);
  }

  setNum(position: Vec2Value, rotation: number): void {
    this.p.setVec2(position);
    setRotAngle(this.q, rotation);
  }
}
