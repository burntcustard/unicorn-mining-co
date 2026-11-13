import { type Module } from '../../client/objects/modules/module';
import shipPreview from '../../client/ui/dom/ship-preview';

/**
 * Keep a module thumbnail fitted to its canvas as the grid changes size.
 */
export const createModulePreview = ({
  canvas,
  module,
}: {
  canvas: HTMLCanvasElement;
  module: Module;
}) => {
  const draw = () => shipPreview.itemThumbnail(canvas, module);
  const observer = new ResizeObserver(draw);

  observer.observe(canvas);
  draw();

  return () => observer.disconnect();
};
