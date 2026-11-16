import { Module, type ModuleRenderOptions } from './module';

export class PowerPlant extends Module {
  static category = 'core' as const;

  render({ segment }: ModuleRenderOptions) {
    super.render({ segment, markingsRotation: 0 });
  }
}
