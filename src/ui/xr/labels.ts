/**
 * Body names in the headset.
 *
 * The page's labels are DOM elements over the canvas, which a headset cannot
 * show. These are drawn in the overlay instead, for the same bodies the page
 * labels (its label layer's candidates, so the none / major / all modes carry
 * over), plus the body the right ray is hovering, so a speck can be named
 * before it is picked.
 *
 * A label sits along the direction from the eye to its body — the overlay's
 * axes are the solar system's, so a direction means the same in both scenes —
 * no further than a few metres out, or at the body itself when that is nearer,
 * so its stereo depth never puts it behind what it names. It is lifted clear
 * of the body's disc and scaled with its distance, so every label reads at the
 * same angular size.
 */

import type { SimBody } from '../../core/system.ts';
import type { SceneView } from '../../render/scene.ts';
import { Container } from '@pmndrs/uikit';
import { Group, Quaternion, Vector3 } from 'three';
import { LiveText } from './live-text.ts';
import { COLOR, FONT_FAMILIES } from './theme.ts';

/** Labels drawn at most. The page draws up to 120; each of these is a layout root of its own. */
const POOL = 40;
/** The furthest a label is placed from the eye, metres. */
const MAX_METRES = 6;
/** The nearest, so a label at a body you are skimming is still readable. */
const MIN_METRES = 0.6;
/** Metres per layout pixel at one metre away: 14 px text is then about 1.1° tall. */
const PIXEL_AT_ONE_METRE = 0.00135;
/** A body wider than this, in angular radius, is its own label: you know where it is. */
const MAX_ANGULAR_RADIUS = 0.6;

interface Slot {
  holder: Group;
  root: Container;
  text: LiveText;
  body: SimBody | null;
  emphasis: 'plain' | 'selected' | 'hovered' | null;
}

// Scratch values, reused every frame.
const eyeWorld = new Vector3();
const eyeOverlay = new Vector3();
const toBody = new Vector3();
const up = new Vector3();
const facing = new Quaternion();

function slot(): Slot {
  const text = new LiveText('', { fontSize: 14 });
  const root = new Container({
    pixelSize: PIXEL_AT_ONE_METRE,
    anchorY: 'bottom',
    paddingX: 6,
    paddingY: 2,
    borderRadius: 5,
    backgroundColor: '#0a0e1699',
    fontFamilies: FONT_FAMILIES,
    fontFamily: 'inter',
  });
  root.add(text.node);
  const holder = new Group();
  holder.add(root);
  holder.visible = false;
  return { holder, root, text, body: null, emphasis: null };
}

function colourOf(body: SimBody, emphasis: Slot['emphasis']): string {
  if (emphasis !== 'plain') {
    return COLOR.accent;
  }
  return body.type === 'moon' || body.type === 'asteroid' ? COLOR.textDim : COLOR.text;
}

export class VrLabels {
  private readonly slots: Slot[] = [];
  private readonly group = new Group();

  constructor(
    private readonly scene: SceneView,
    private readonly focused: () => SimBody,
    private readonly selected: () => SimBody,
  ) {
    for (let i = 0; i < POOL; i++) {
      const s = slot();
      this.slots.push(s);
      this.group.add(s.holder);
    }
    scene.xr.overlay.scene.add(this.group);
  }

  /** Place this frame's labels, `deltaMs` after the last. */
  update(hovered: SimBody | null, deltaMs: number): void {
    const bodies = [...this.scene.labels.candidates];
    if (hovered && !bodies.includes(hovered)) {
      bodies.unshift(hovered);
    }
    const rig = this.scene.xr;
    rig.head.getWorldPosition(eyeWorld);
    rig.overlay.head.getWorldPosition(eyeOverlay);
    rig.overlay.head.getWorldQuaternion(facing);
    up.set(0, 1, 0).applyQuaternion(facing);
    let used = 0;
    for (const body of bodies) {
      if (used === POOL) {
        break;
      }
      if (this.place(this.slots[used], body, body === hovered, rig.dolly.scale.x)) {
        this.slots[used].root.update(deltaMs);
        used++;
      }
    }
    for (let i = used; i < POOL; i++) {
      this.slots[i].holder.visible = false;
    }
  }

  /** Put `body`'s label in slot `s`; false if the body needs none from here. */
  private place(s: Slot, body: SimBody, hovered: boolean, unitsPerMetre: number): boolean {
    const origin = this.focused().scene;
    toBody.set(body.scene.x - origin.x, body.scene.y - origin.y, body.scene.z - origin.z);
    toBody.sub(eyeWorld);
    const distance = toBody.length();
    const angularRadius = Math.asin(Math.min(1, body.sceneRadius / Math.max(distance, 1e-9)));
    if (body.type !== 'lagrange' && angularRadius > MAX_ANGULAR_RADIUS) {
      return false;
    }
    const metres = Math.min(MAX_METRES, Math.max(MIN_METRES, distance / unitsPerMetre));
    const lift = body.type === 'lagrange' ? 0.01 : Math.tan(angularRadius) + 0.01;
    s.holder.position
      .copy(eyeOverlay)
      .addScaledVector(toBody.normalize(), metres)
      .addScaledVector(up, lift * metres);
    s.holder.quaternion.copy(facing);
    s.holder.scale.setScalar(metres);
    s.holder.visible = true;
    this.write(s, body, hovered ? 'hovered' : body === this.selected() ? 'selected' : 'plain');
    return true;
  }

  /** Rewrite a slot's text and colour, only when they change. */
  private write(s: Slot, body: SimBody, emphasis: Slot['emphasis']): void {
    if (s.body !== body) {
      s.body = body;
      s.text.set(body.name);
      s.emphasis = null;
    }
    if (s.emphasis !== emphasis) {
      s.emphasis = emphasis;
      s.text.node.setProperties({ color: colourOf(body, emphasis) });
      s.root.setProperties({
        borderWidth: emphasis === 'hovered' ? 1 : 0,
        borderColor: COLOR.accent,
      });
    }
  }
}
