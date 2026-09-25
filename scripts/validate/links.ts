/** Shared links survive a round trip. */

import { parseView } from '../../src/core/url-parse.ts';
import {
  DEFAULT_LABELS,
  DEFAULT_ORBITS,
  DEFAULT_TOGGLES,
  encodeView,
} from '../../src/core/url-state.ts';
import { ok, section } from './harness.ts';

export function checkSharedLinks(): void {
  section('Shared links round-trip');

  {
    // A link is only shareable if what comes back is what went in. Free flight is
    // the case that matters: orbit mode can rebuild its aim from the focus, but a
    // free camera's orientation exists nowhere else, so losing it turns a shared
    // view into a shrug.
    const view = {
      jdUtc: 2461000.5,
      focusKey: 'moon:Enceladus',
      selectedKey: null,
      scaleMode: 'explore' as const,
      rate: -86400,
      paused: true,
      azimuth: 1.2345,
      elevation: -0.4321,
      distanceRadii: 12.5,
      cameraMode: 'free' as const,
      freePosition: [-2.194157, 0.407622, 0.003545] as const,
      freeOrientation: [0.07707, 0.84076, 0.53366, 0.04892] as const,
      orbits: DEFAULT_ORBITS,
      labels: DEFAULT_LABELS,
      toggles: { ...DEFAULT_TOGGLES },
    };
    const back = parseView(`?${encodeView(view)}`);

    ok('camera mode survives the round trip', back.cameraMode === 'free', String(back.cameraMode));
    ok(
      'free position survives the round trip',
      !!back.freePosition &&
        back.freePosition.every((n, i) => Math.abs(n - view.freePosition[i]) < 1e-6),
      JSON.stringify(back.freePosition),
    );
    ok(
      'free orientation survives the round trip',
      !!back.freeOrientation &&
        back.freeOrientation.every((n, i) => Math.abs(n - view.freeOrientation[i]) < 1e-5),
      JSON.stringify(back.freeOrientation),
    );
    ok('a colon in a body key stays legible', encodeView(view).includes('focus=moon:Enceladus'));

    // Orbit mode must not carry free-flight baggage.
    const orbit = parseView(`?${encodeView({ ...view, cameraMode: 'orbit' as const })}`);
    ok(
      'orbit mode writes no camera parameters',
      orbit.cameraMode === undefined && orbit.freePosition === undefined,
      `cam=${orbit.cameraMode}`,
    );

    // Malformed input is ignored rather than fatal, as everywhere else here.
    const junk = parseView('?cam=free&fp=1,2&fq=0,0,0,0');
    ok(
      'a truncated position and a zero quaternion are both ignored',
      junk.cameraMode === 'free' &&
        junk.freePosition === undefined &&
        junk.freeOrientation === undefined,
    );
  }
}
