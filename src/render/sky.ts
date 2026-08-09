/**
 * The sky.
 *
 * Two layers that together reconstruct the real celestial sphere:
 *
 *   - **The deep sky**, an equirectangular image of the Milky Way built by NASA
 *     from 1.7 billion Gaia DR2 sources, with the bright catalogued stars taken
 *     back out. What is left is exactly the unresolved component — which is what
 *     the Milky Way physically is, a haze of stars too faint to separate.
 *   - **41,394 real stars** from the Hipparcos catalogue, drawn as point
 *     sources: correct position, correct Johnson V magnitude, colour from the
 *     measured B-V index, and each carrying its own proper motion so the
 *     constellations are right at whatever date the clock is showing.
 *
 * The split is the same one NASA used to build the texture, so no star is drawn
 * twice and none is missing between the two layers except the Tycho range
 * (V 8-11.5), which is individually invisible at any exposure that keeps Sirius
 * on the screen.
 *
 * **Frames.** Both layers are authored in ICRF/J2000 equatorial coordinates and
 * the whole group is rotated once into Aphelion's ecliptic J2000 frame. That
 * rotation is the only place the obliquity appears, and it is built by pushing
 * the three unit axes through the same `equatorialToEcliptic` every other part
 * of the astronomy uses, so the sky cannot drift away from the planets.
 *
 * There is deliberately **no precession**. Aphelion's frame is inertial, so
 * precession of the equinoxes moves the coordinate grid, not the stars, and
 * applying it would swing the entire sky by 12 degrees across the clock's range
 * for no physical reason. Proper motion is the only thing that genuinely moves.
 */

import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  type PerspectiveCamera,
  Points,
  type ShaderMaterial,
  Uint8BufferAttribute,
} from 'three'
import { createSkyMaterial, createStarMaterial } from './materials.ts'
import { solidTexture } from './procedural.ts'
import type { TextureLibrary } from './textures.ts'
import { equatorialToEcliptic } from '../astro/frames.ts'
import { STAR_CATALOGUE } from '../data/generated/stars.ts'
import { unpackStars, type StarData } from '../data/stars.ts'

/** Equirectangular deep-sky image, celestial coordinates. */
const SKY_TEXTURE = 'sky_milkyway.jpg'

/**
 * Exposure for the deep sky.
 *
 * The source is linear-light photometry encoded straight to sRGB, so this is a
 * pure exposure choice rather than a correction. Any visible Milky Way is
 * already an exaggeration — its surface brightness is around 22 magnitudes per
 * square arcsecond, twenty-odd magnitudes below the planets drawn in front of
 * it, and at a shared exposure it would be black. This is set where the band
 * and its dust lanes read without the asteroid belt and the orbit lines having
 * to compete with them. ATTRIBUTION.md records it as a knowing departure.
 */
const SKY_BRIGHTNESS = 0.85

/**
 * Rotation from ICRF/J2000 equatorial into ecliptic J2000.
 *
 * Built from the transform itself rather than written out as a rotation about
 * x by the obliquity, so there is exactly one definition of the angle in the
 * codebase and this cannot disagree with the ephemerides.
 */
function equatorialToEclipticMatrix(): Matrix4 {
  const axis = (x: number, y: number, z: number) => equatorialToEcliptic({ x, y, z })
  const ex = axis(1, 0, 0)
  const ey = axis(0, 1, 0)
  const ez = axis(0, 0, 1)
  return new Matrix4().set(
    ex.x, ey.x, ez.x, 0,
    ex.y, ey.y, ez.y, 0,
    ex.z, ey.z, ez.z, 0,
    0, 0, 0, 1,
  )
}

/** Julian days per Julian year, for turning the clock into proper-motion time. */
const DAYS_PER_YEAR = 365.25
const J2000_JD = 2451545.0

/** Fetch and unpack the catalogue, or resolve null if it is not on disk. */
async function loadStars(): Promise<StarData | null> {
  try {
    const res = await fetch(STAR_CATALOGUE.file)
    if (!res.ok) return null
    return unpackStars(await res.arrayBuffer())
  } catch {
    return null
  }
}

export class SkyView {
  /** Rides the camera; rotated once from the equatorial frame to the ecliptic. */
  readonly group = new Group()

  private diffuse: Mesh
  private diffuseMaterial: ShaderMaterial
  private stars: Points | null = null
  private starMaterial: ShaderMaterial | null = null

  visible = true

  /**
   * @param geometry a unit sphere; the radius is immaterial because both
   *   materials pin their vertices to the far plane, so this only has to be
   *   round.
   */
  constructor(geometry: BufferGeometry, library: TextureLibrary) {
    this.group.matrixAutoUpdate = false
    this.group.matrix.copy(equatorialToEclipticMatrix())

    this.diffuseMaterial = createSkyMaterial(solidTexture(0x03050a), {
      brightness: SKY_BRIGHTNESS,
    })
    this.diffuse = new Mesh(geometry, this.diffuseMaterial)
    this.diffuse.frustumCulled = false
    // Before everything, so the depth buffer it tests against is still the
    // cleared far plane and nothing can be behind it.
    this.diffuse.renderOrder = -1000
    this.group.add(this.diffuse)

    void library.load(SKY_TEXTURE).then((tex) => {
      if (!tex) return
      tex.flipY = false
      this.diffuseMaterial.uniforms.uMap!.value = tex
      this.diffuseMaterial.needsUpdate = true
    })

    void loadStars().then((data) => {
      if (data) this.attachStars(data)
      else console.warn('[aphelion] no star catalogue; the sky keeps only its deep-sky layer')
    })
  }

  private attachStars(data: StarData): void {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(data.direction, 3))
    geometry.setAttribute('aProperMotion', new Float32BufferAttribute(data.properMotion, 3))
    geometry.setAttribute('aMagnitude', new Float32BufferAttribute(data.magnitude, 1))
    geometry.setAttribute('aColor', new Uint8BufferAttribute(data.colour, 3, true))

    this.starMaterial = createStarMaterial()
    this.starMaterial.uniforms.uMagLimit!.value = STAR_CATALOGUE.magnitudeLimit + 1

    const points = new Points(geometry, this.starMaterial)
    points.frustumCulled = false
    // After the deep sky, still before every solid body.
    points.renderOrder = -999
    this.stars = points
    this.group.add(points)
  }

  /** True once the catalogue has been unpacked and uploaded. */
  get starsReady(): boolean {
    return this.stars !== null
  }

  /**
   * Keep the sky centred on the eye and wound to the right date.
   *
   * @param jdTT Julian Date, terrestrial time. Only proper motion uses it, and
   *   TT runs about 69 seconds ahead of UTC — during which even the fastest star
   *   in the catalogue moves 2 x 10^-5 arcseconds, so which of the two arrives
   *   here could not matter less.
   */
  update(camera: PerspectiveCamera, jdTT: number, pixelRatio: number): void {
    this.group.visible = this.visible
    if (!this.visible) return

    // The sphere rides the camera, so the eye is always at its centre and no
    // parallax is implied — which is right to a part in 10^5 even from Pluto:
    // the nearest star's parallax across the whole solar system is under an
    // arcsecond, a hundredth of a pixel here.
    this.group.matrix.setPosition(camera.position)
    this.group.matrixWorldNeedsUpdate = true

    if (this.starMaterial) {
      this.starMaterial.uniforms.uYears!.value = (jdTT - J2000_JD) / DAYS_PER_YEAR
      this.starMaterial.uniforms.uPixelRatio!.value = pixelRatio
    }
  }

  dispose(): void {
    this.diffuse.geometry.dispose()
    this.diffuseMaterial.dispose()
    if (this.stars) {
      this.stars.geometry.dispose()
      ;(this.stars.material as ShaderMaterial).dispose()
    }
  }
}
