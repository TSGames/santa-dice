import { Component, Input } from '@angular/core';

type Tone = 'sage' | 'mustard' | 'cream' | 'petrol' | 'forest';
type Motif = 'tree' | 'sparkles' | 'gift' | 'branch' | 'ornaments' | 'stocking' | 'snowflakes' | 'stars' | 'berries' | 'bauble' | 'giftShine';

/** Farbe und Motiv je Türchen, nach der Design-Vorlage (docs/design-adventskalender.png). */
const DESIGN: { [day: number]: [Tone, Motif, string?] } = {
  1: ['sage', 'tree'],
  2: ['mustard', 'sparkles'],
  3: ['cream', 'gift'],
  4: ['petrol', 'branch'],
  5: ['forest', 'ornaments'],
  6: ['mustard', 'stocking', 'Nikolaus'],
  7: ['cream', 'snowflakes'],
  8: ['forest', 'stars'],
  9: ['sage', 'gift'],
  10: ['mustard', 'tree'],
  11: ['cream', 'ornaments'],
  12: ['sage', 'branch'],
  13: ['forest', 'stocking'],
  14: ['cream', 'gift'],
  15: ['mustard', 'tree'],
  16: ['sage', 'stars'],
  17: ['petrol', 'tree'],
  18: ['cream', 'ornaments'],
  19: ['sage', 'berries'],
  20: ['petrol', 'gift'],
  21: ['cream', 'snowflakes'],
  22: ['mustard', 'bauble'],
  23: ['forest', 'sparkles'],
  24: ['sage', 'giftShine'],
};

@Component({
  selector: 'app-door-tile',
  templateUrl: './door-tile.component.html',
  styleUrls: ['./door-tile.component.scss'],
})
export class DoorTileComponent {
  @Input() day = 1;

  get tone(): Tone {
    return DESIGN[this.day][0];
  }

  get motif(): Motif {
    return DESIGN[this.day][1];
  }

  get label(): string | undefined {
    return DESIGN[this.day][2];
  }

  get number() {
    return String(this.day).padStart(2, '0');
  }
}
