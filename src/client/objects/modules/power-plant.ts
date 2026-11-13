import { Module, type ModuleRenderOptions } from './module';

export class PowerPlant extends Module {
  render({ segment }: ModuleRenderOptions) {
    super.render({ segment, markingsRotation: 0 });
  }
}
