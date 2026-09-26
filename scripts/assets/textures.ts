/** Where the planetary, sky and USGS imagery comes from. */

import { tier } from './cli.ts';
import { C, fetchText } from './io.ts';

// ---------------------------------------------------------------------------
// 1. Solar System Scope planetary maps  (CC BY 4.0)
// ---------------------------------------------------------------------------

interface TextureSpec {
  out: string;
  /** Candidate source filenames, best first. */
  candidates: string[];
  /** Max dimension when the source needs conversion. */
  convertTo?: number;
}

export const SSS_BASE = 'https://www.solarsystemscope.com/textures/download/';

export function sssTextures(): TextureSpec[] {
  // Solar System Scope only publishes certain bodies at certain sizes, so each
  // entry degrades gracefully from the requested tier downward.
  const big = tier === 'lean' ? ['2k'] : tier === 'high' ? ['4k', '2k'] : ['8k', '4k', '2k'];
  const pick = (stem: string, sizes = big): string[] => sizes.map((s) => `${s}_${stem}`);

  return [
    { out: 'sun.jpg', candidates: pick('sun.jpg') },
    { out: 'mercury.jpg', candidates: pick('mercury.jpg') },
    { out: 'venus_surface.jpg', candidates: pick('venus_surface.jpg') },
    { out: 'venus_atmosphere.jpg', candidates: pick('venus_atmosphere.jpg', ['4k', '2k']) },
    { out: 'earth_day.jpg', candidates: pick('earth_daymap.jpg') },
    { out: 'earth_night.jpg', candidates: pick('earth_nightmap.jpg') },
    { out: 'earth_clouds.jpg', candidates: pick('earth_clouds.jpg') },
    { out: 'earth_normal.jpg', candidates: pick('earth_normal_map.tif'), convertTo: 8192 },
    { out: 'earth_specular.jpg', candidates: pick('earth_specular_map.tif'), convertTo: 4096 },
    { out: 'moon.jpg', candidates: pick('moon.jpg') },
    { out: 'mars.jpg', candidates: pick('mars.jpg') },
    { out: 'jupiter.jpg', candidates: pick('jupiter.jpg') },
    { out: 'saturn.jpg', candidates: pick('saturn.jpg') },
    { out: 'saturn_ring.png', candidates: pick('saturn_ring_alpha.png') },
    { out: 'uranus.jpg', candidates: pick('uranus.jpg', ['2k']) },
    { out: 'neptune.jpg', candidates: pick('neptune.jpg', ['2k']) },
    { out: 'ceres.jpg', candidates: pick('ceres_fictional.jpg', ['4k', '2k']) },
    { out: 'eris.jpg', candidates: pick('eris_fictional.jpg', ['4k', '2k']) },
    { out: 'haumea.jpg', candidates: pick('haumea_fictional.jpg', ['4k', '2k']) },
    { out: 'makemake.jpg', candidates: pick('makemake_fictional.jpg', ['4k', '2k']) },
  ];
}

// ---------------------------------------------------------------------------
// 1b. NASA SVS Deep Star Maps 2020 -- the sky background  (public domain)
//
// `milkyway_2020` is the deep sky with the Hipparcos and Tycho stars taken back
// out: 1.7 billion Gaia DR2 sources too faint to resolve, which is precisely
// what the Milky Way *is*. Aphelion draws the bright stars itself from the
// Hipparcos catalogue below, so the two layers reassemble the sky the same way
// NASA split it, and no star is drawn twice.
//
// Three facts about this product decide the whole conversion, and all three are
// stated on the SVS page rather than guessed:
//
//   - It is a plate carree in **celestial (ICRF/J2000) coordinates**, so the
//     sphere carrying it has to be rotated into Aphelion's ecliptic frame.
//   - It is centred on RA 0h with **right ascension increasing to the LEFT**,
//     which is a mirror image of every planetary map here. Flopping it at build
//     time (as the `dd360` basemaps are rolled at build time) makes u = 0.5 land
//     on RA 0 with RA increasing east, and leaves the shader with nothing to
//     know about the convention.
//   - It is linear-light OpenEXR, so the conversion has to declare the source
//     linear and let the sRGB transfer do the encoding. Skipping that step
//     crushes a mean pixel from 15/255 to 1.6/255 -- a black sky that still
//     looks like a plausible one.
// ---------------------------------------------------------------------------

export const SVS_BASE = 'https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/';

interface SkySpec {
  out: string;
  source: string;
  maxDim: number;
  note: string;
}

export function skyTextures(): SkySpec[] {
  const size = tier === 'lean' ? '4k' : '8k';
  const maxDim = tier === 'lean' ? 4096 : 8192;
  return [
    {
      out: 'sky_milkyway.jpg',
      source: `milkyway_2020_${size}.exr`,
      maxDim,
      note: 'Gaia DR2 deep sky, Hipparcos/Tycho stars removed',
    },
  ];
}

// ---------------------------------------------------------------------------
// 2. USGS Astrogeology global mosaics  (public domain)
// ---------------------------------------------------------------------------

interface UsgsSpec {
  out: string;
  url: string;
  maxDim: number;
  /**
   * Horizontal shift to apply, e.g. '50%'. The mosaics run -180..180 and need
   * none; the WMS basemaps are named `dd360` and start at the prime meridian,
   * so they need half a turn to sit in the same frame as everything else.
   */
  roll?: string;
  note: string;
}

export const USGS: UsgsSpec[] = [
  {
    out: 'io.jpg',
    url: 'https://planetarymaps.usgs.gov/mosaic/Io_GalileoSSI-Voyager_Global_Mosaic_1km.tif',
    maxDim: 4096,
    note: 'Galileo SSI + Voyager, 1 km/px',
  },
  {
    out: 'europa.jpg',
    url: 'https://planetarymaps.usgs.gov/mosaic/Europa_Voyager_GalileoSSI_global_mosaic_500m.tif',
    maxDim: 4096,
    note: 'Voyager + Galileo SSI, 500 m/px',
  },
  {
    out: 'ganymede.jpg',
    url: 'https://planetarymaps.usgs.gov/mosaic/Ganymede_Voyager_GalileoSSI_global_mosaic_1km.tif',
    maxDim: 4096,
    note: 'Voyager + Galileo SSI, 1 km/px',
  },
  {
    out: 'callisto.jpg',
    url: 'https://planetarymaps.usgs.gov/mosaic/Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif',
    maxDim: 4096,
    note: 'Voyager + Galileo SSI, 1 km/px',
  },
  {
    out: 'enceladus.jpg',
    url: 'https://planetarymaps.usgs.gov/mosaic/Enceladus_Cassini_mosaic_global_110m.tif',
    maxDim: 4096,
    note: 'Cassini ISS, 110 m/px',
  },
  // Titan comes from the same basemap bucket but needs neither of the two
  // adjustments Mimas and Phoebe do: it is a single-page TIFF, and `clon0` means
  // it is already centred on longitude 0 with its left edge at 180, which is
  // this project's convention. Its PDS3 label agrees — centre longitude 180 W
  // with the left edge at the prime meridian, half a turn from this file — so
  // two independent statements say the same thing and neither was assumed.
  //
  // What it shows is the surface *through* the haze: ISS's 938 nm methane window
  // is the only way Titan's ground was ever imaged from orbit. In visible light
  // Titan is a featureless orange ball, which is what the atmosphere shell over
  // this map renders.
  {
    out: 'titan.jpg',
    url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/wms_basemaps/Saturn/Titan/Cassini/Titan_ISS_P19658_Mosaic_Global_4km_clon0.tif',
    maxDim: 4096,
    note: 'Cassini ISS 938 nm, 4 km/px',
  },
  // Mimas and Phoebe are absent from the mosaic set and from Astropedia, but the
  // Cassini Imaging Team basemaps behind the USGS map viewer cover both. They
  // are 8 px/deg pyramidal GeoTIFFs starting at longitude 0, hence the roll.
  {
    out: 'mimas.jpg',
    url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/wms_basemaps/Saturn/Mimas/Cassini/Mimas_PDS_8ppd_dd360.tif',
    maxDim: 2048,
    roll: '50%',
    note: 'Cassini ISS, 8 px/deg',
  },
  {
    out: 'phoebe.jpg',
    url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/wms_basemaps/Saturn/Phoebe/Cassini/Phoebe_PDS_8ppd_dd360.tif',
    maxDim: 2048,
    roll: '50%',
    note: 'Cassini ISS, 8 px/deg',
  },
];

// ---------------------------------------------------------------------------
// 2b. USGS Astropedia  (public domain)
//
// Covers the bodies that matter most to anyone exploring and that the bulk
// mosaic bucket does not name predictably: Pluto, Charon, Phobos, Triton, the
// mid-sized Saturnians and Vesta. Before this, all of those fell back to
// procedural surfaces — which is the wrong place to economise, because they are
// exactly the worlds people go looking for.
// ---------------------------------------------------------------------------

interface AstropediaSpec {
  out: string;
  /** Astropedia item id, lowercase-with-underscores. */
  id: string;
  note: string;
}

const ASTROPEDIA_BASE = 'https://astrogeology.usgs.gov/search/map/';

export const ASTROPEDIA: AstropediaSpec[] = [
  {
    out: 'pluto.jpg',
    id: 'pluto_new_horizons_lorri_mvic_global_mosaic_300m',
    note: 'New Horizons LORRI+MVIC, 300 m/px',
  },
  {
    out: 'charon.jpg',
    id: 'charon_new_horizons_lorri_mvic_global_mosaic_300m',
    note: 'New Horizons LORRI+MVIC, 300 m/px',
  },
  {
    out: 'phobos.jpg',
    id: 'phobos_mars_express_src_global_mosaic_12m',
    note: 'Mars Express SRC + Viking, 12 m/px',
  },
  {
    out: 'triton.jpg',
    id: 'triton_voyager_2_global_color_mosaic_600m',
    note: 'Voyager 2 colour, 600 m/px',
  },
  {
    out: 'iapetus.jpg',
    id: 'iapetus_cassini_voyager_global_mosaic_803m',
    note: 'Cassini + Voyager, 803 m/px',
  },
  {
    out: 'dione.jpg',
    id: 'dione_cassini_voyager_global_mosaic_154m',
    note: 'Cassini + Voyager, 154 m/px',
  },
  {
    out: 'rhea.jpg',
    id: 'rhea_cassini_voyager_global_mosaic_417m',
    note: 'Cassini + Voyager, 417 m/px',
  },
  { out: 'tethys.jpg', id: 'tethys_cassini_global_mosaic_293m', note: 'Cassini ISS, 293 m/px' },
  { out: 'vesta.jpg', id: 'vesta_dawn_fc_hamo_global_mosaic_60m', note: 'Dawn FC HAMO, 60 m/px' },
  { out: 'eros.jpg', id: 'near_msi_albedo_mosaics', note: 'NEAR MSI albedo mosaic, 1024 px' },
];

/**
 * Resolve an Astropedia item to a downloadable image.
 *
 * The HTML item pages are JavaScript-rendered and carry no usable links, but
 * each one has a static FGDC metadata sibling at `<id>.xml` that contains the
 * CKAN download URL. An unknown id returns the site's ordinary 404 page — which
 * is HTML, and which carries its own footer thumbnails, so we reject on the
 * doctype and skip anything with "thumb" in the name.
 */
export async function astropediaImageUrl(spec: AstropediaSpec): Promise<string | null> {
  const xml = await fetchText(
    `${ASTROPEDIA_BASE}${spec.id}.xml`,
    `astropedia-${spec.id}.xml`,
    `metadata for ${spec.out}`,
  );
  if (xml === null || xml === '') {
    return null;
  }
  if (/^\s*<!DOCTYPE html/iu.test(xml)) {
    console.log(`  ${C.yellow('missing')} Astropedia id not found: ${spec.id}`);
    return null;
  }
  const urls = [
    ...xml.matchAll(/https:\/\/astrogeology\.usgs\.gov[^\s"'<>]+\/download\/[^\s"'<>]+/gu),
  ].map((m) => m[0]);
  return urls.find((u) => !/thumb/iu.test(u) && /\.(jpe?g|png|tif)$/iu.test(u)) ?? null;
}
