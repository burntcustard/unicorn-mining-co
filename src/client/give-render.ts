/**
 * Install client-only presentation on a shared class, retaining its parent's
 * renderer. No constructor, update, collision or lifecycle method is replaced.
 */
export const giveRender = ({
  Type,
  render,
  updateVisual,
}: {
  Type: { prototype: any };
  render?: (this: any, options: any) => void;
  updateVisual?: (this: any, options: any) => void;
}) => {
  const parent = Object.getPrototypeOf(Type.prototype).render;

  if (render) {
    Type.prototype.render = function (options: any = {}) {
      render.call(this, {
        ...options,
        parent: (next: any) => parent?.call(this, next),
      });
    };
  }

  if (updateVisual) Type.prototype.updateVisual = updateVisual;
};
