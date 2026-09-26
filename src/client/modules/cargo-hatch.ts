import { CargoHatch } from '../../shared/modules/cargo-hatch';
import { giveRender } from '../give-render';
import { playSound } from '../sound-loader';
import './module';

giveRender({
  Type: CargoHatch,
  render({ segment, parent }) {
    if (!segment.catches) parent({ segment });
  },
  updateVisual({ segments }) {
    const active = Boolean(segments.some((segment: any) => segment.active));

    if (active !== Boolean(this.lastActive)) playSound(active ? 0 : 1);
    this.lastActive = active;
  },
});
