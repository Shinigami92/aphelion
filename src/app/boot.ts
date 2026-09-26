/** The boot veil: preload the imagery everyone sees first, then get out of the way. */

import type { SolarSystem } from '../core/system.ts';
import type { TextureLibrary } from '../render/textures.ts';
import type { Toast } from '../ui/panels/toast.ts';
import { need } from './dom.ts';

/** The imagery on screen in the first seconds, worth holding the veil for. */
const BOOT_TEXTURES = [
  'sky_milkyway.jpg',
  'sun.jpg',
  'earth_day.jpg',
  'earth_night.jpg',
  'earth_clouds.jpg',
  'moon.jpg',
  'mars.jpg',
  'jupiter.jpg',
  'saturn.jpg',
  'saturn_ring.png',
  'venus_surface.jpg',
  'mercury.jpg',
  'uranus.jpg',
  'neptune.jpg',
];

export function startBoot(
  library: TextureLibrary,
  system: SolarSystem,
  toast: Toast,
  isMobile: () => boolean,
): void {
  const bootEl = need('boot');
  const bootFill = need('boot-fill');
  const bootStatus = need('boot-status');

  bootStatus.textContent = `${system.bodies.length} bodies · 459 satellites · 221 minor planets`;

  void library.preload(BOOT_TEXTURES);

  let booted = false;
  function finishBoot(): void {
    if (booted) {
      return;
    }
    booted = true;
    bootEl.classList.add('boot--done');
    setTimeout(() => {
      bootEl.style.display = 'none';
    }, 800);
    // The boot hint has to name something the reader can actually do: there is no
    // H to press on a phone, and the "?" chip is the only route to the reference
    // either way.
    toast.show(isMobile() ? 'Tap ? for gestures and credits' : 'Press H for the keyboard map');
  }

  library.onProgress((loaded, total) => {
    const fraction = total > 0 ? loaded / total : 1;
    bootFill.style.width = `${Math.round(fraction * 100)}%`;
    bootStatus.textContent = `loading imagery… ${loaded} / ${total}`;
    if (loaded >= total) {
      finishBoot();
    }
  });
  // Never let a slow or missing texture keep the app behind the veil.
  setTimeout(finishBoot, 9000);
}
