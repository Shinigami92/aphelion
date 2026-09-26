/** Reading the JPL Solar System Dynamics tables. */

import { parseLeadingFloat } from './gridded-topo.ts';

// ---------------------------------------------------------------------------
// 3. JPL satellite elements + physical parameters
// ---------------------------------------------------------------------------

const stripTags = (s: string): string =>
  s
    .replaceAll(/<[^>]+>/gu, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&deg;', '')
    .replaceAll(/\s+/gu, ' ')
    .trim();

export function tableRows(html: string, tableId: string): string[][] {
  const table = new RegExp(`<table[^>]*id="${tableId}"[^>]*>([\\s\\S]*?)</table>`, 'u').exec(html);
  if (!table) {
    return [];
  }
  const out: string[][] = [];
  for (const tr of table[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gu)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gu)].map((m) => stripTags(m[1]));
    if (cells.length > 0) {
      out.push(cells);
    }
  }
  return out;
}

export const num = (s: string | undefined): number | null => {
  if (s === undefined || s === '') {
    return null;
  }
  const t = s.trim();
  if (!t || t === '-' || t === 'n/a') {
    return null;
  }
  const v = parseLeadingFloat(t);
  return Number.isFinite(v) ? v : null;
};

export function gregorianToJd(year: number, month: number, day: number): number {
  let y = year;
  let mo = month;
  if (mo <= 2) {
    y -= 1;
    mo += 12;
  }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (mo + 1)) + day + B - 1524.5;
}

/** `2000-01-01.5` -> Julian Date (TDB). */
export function epochStringToJd(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:\.(\d+))?$/u.exec(s.trim());
  if (!m) {
    return 2451545.0;
  }
  const frac = m[4] ? Number(`0.${m[4]}`) : 0;
  return gregorianToJd(Number(m[1]), Number(m[2]), Number(m[3]) + frac);
}

/**
 * Mean radii (km) for satellites JPL's physical-parameters table omits — it
 * only covers the 46 moons with measured GM. These are published values for the
 * classical irregulars and shepherd moons; anything still missing gets a
 * nominal radius and is flagged `radiusEstimated` so the UI can say so.
 */
export const KNOWN_RADII: Record<string, number> = {
  // Jupiter: inner group + Himalia/Ananke/Carme/Pasiphae families
  Metis: 21.5,
  Adrastea: 8.2,
  Amalthea: 83.5,
  Thebe: 49.3,
  Himalia: 69.8,
  Elara: 43,
  Lysithea: 18,
  Leda: 10,
  Dia: 2,
  Ananke: 14,
  Praxidike: 3.4,
  Harpalyke: 2.2,
  Iocaste: 2.6,
  Thyone: 2,
  Carme: 23,
  Taygete: 2.5,
  Chaldene: 1.9,
  Kalyke: 2.6,
  Isonoe: 1.9,
  Erinome: 1.6,
  Pasiphae: 30,
  Sinope: 19,
  Callirrhoe: 4.8,
  Megaclite: 2.7,
  Autonoe: 2,
  Themisto: 4,
  Carpo: 1.5,
  Valetudo: 0.5,
  Eupheme: 1,
  // Saturn: ring shepherds, co-orbitals, Trojans, Phoebe/Norse group
  Pan: 14.1,
  Daphnis: 3.8,
  Atlas: 15.1,
  Prometheus: 43.1,
  Pandora: 40.6,
  Epimetheus: 58.1,
  Janus: 89.5,
  Aegaeon: 0.33,
  Methone: 1.6,
  Anthe: 0.5,
  Pallene: 2.2,
  Telesto: 12.4,
  Calypso: 10.7,
  Polydeuces: 1.3,
  Helene: 17.6,
  Hyperion: 135,
  Phoebe: 106.5,
  Kiviuq: 8,
  Ijiraq: 6,
  Paaliaq: 11,
  Siarnaq: 20,
  Tarvos: 7.5,
  Albiorix: 14.3,
  Erriapus: 5,
  Ymir: 9,
  Skathi: 4,
  Mundilfari: 3.5,
  Suttungr: 3.5,
  Thrymr: 3.5,
  Narvi: 3.5,
  Bebhionn: 3,
  Bergelmir: 3,
  Bestla: 3.5,
  Farbauti: 2.5,
  Fenrir: 2,
  Fornjot: 3,
  Hati: 3,
  Hyrrokkin: 3.5,
  Kari: 3.5,
  Loge: 3,
  Skoll: 3,
  Surtur: 3,
  Jarnsaxa: 3,
  Greip: 3,
  Tarqeq: 3.5,
  Aegir: 3,
  // Uranus
  Cordelia: 20.1,
  Ophelia: 21.4,
  Bianca: 25.7,
  Cressida: 39.8,
  Desdemona: 32,
  Juliet: 46.8,
  Portia: 67.6,
  Rosalind: 36,
  Cupid: 9,
  Belinda: 40.3,
  Perdita: 15,
  Puck: 81,
  Mab: 12,
  Caliban: 36,
  Sycorax: 75,
  Prospero: 25,
  Setebos: 24,
  Stephano: 16,
  Trinculo: 9,
  Francisco: 11,
  Margaret: 10,
  Ferdinand: 10,
  // Neptune
  Naiad: 33,
  Thalassa: 41,
  Despina: 75,
  Galatea: 88,
  Larissa: 97,
  Hippocamp: 17.4,
  Proteus: 210,
  Nereid: 170,
  Halimede: 31,
  Sao: 22,
  Laomedeia: 21,
  Psamathe: 20,
  Neso: 30,
  // Pluto
  Nix: 24.8,
  Hydra: 30.2,
  Kerberos: 6,
  Styx: 5.2,
};

/** Nominal radius for undocumented satellites, by parent. */
export const NOMINAL_RADIUS: Record<string, number> = {
  Jupiter: 1.5,
  Saturn: 2.0,
  Uranus: 5.0,
  Neptune: 20.0,
  Pluto: 5.0,
  Mars: 6.0,
  Earth: 1000,
};
