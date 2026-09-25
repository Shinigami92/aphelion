/** Number formatting shared by the panels and the page title. */

import { AU_KM } from '../../core/constants.ts';

export const fmt = (value: number, digits = 0): string =>
  value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Distance with a unit that suits its magnitude. */
export function formatDistance(km: number): string {
  const abs = Math.abs(km);
  if (abs < 1) {
    return `${fmt(km * 1000, 0)} m`;
  }
  if (abs < 10_000) {
    return `${fmt(km, 1)} km`;
  }
  if (abs < 1_000_000) {
    return `${fmt(km, 0)} km`;
  }
  if (abs < 0.05 * AU_KM) {
    return `${fmt(km / 1000, 0)} thousand km`;
  }
  return `${fmt(km / AU_KM, abs / AU_KM < 10 ? 4 : 3)} AU`;
}

export function formatMass(kg: number): string {
  if (kg >= 1e27) {
    return `${(kg / 1e27).toFixed(3)} × 10²⁷ kg`;
  }
  if (kg >= 1e24) {
    return `${(kg / 1e24).toFixed(3)} × 10²⁴ kg`;
  }
  if (kg >= 1e21) {
    return `${(kg / 1e21).toFixed(3)} × 10²¹ kg`;
  }
  if (kg >= 1e18) {
    return `${(kg / 1e18).toFixed(3)} × 10¹⁸ kg`;
  }
  return `${kg.toExponential(3)} kg`;
}

export function formatDuration(days: number): string {
  const abs = Math.abs(days);
  const sign = days < 0 ? '−' : '';
  if (abs < 1 / 24) {
    return `${sign}${fmt(abs * 1440, 1)} min`;
  }
  if (abs < 2) {
    return `${sign}${fmt(abs * 24, 2)} hours`;
  }
  if (abs < 800) {
    return `${sign}${fmt(abs, abs < 30 ? 3 : 2)} days`;
  }
  return `${sign}${fmt(abs / 365.25, 2)} years`;
}

export function formatHours(hours: number): string {
  const abs = Math.abs(hours);
  const retro = hours < 0 ? ' (retrograde)' : '';
  if (abs < 48) {
    return `${fmt(abs, 3)} h${retro}`;
  }
  return `${fmt(abs / 24, 2)} days${retro}`;
}

export function formatLightTime(km: number): string {
  const seconds = km / 299_792.458;
  if (seconds < 90) {
    return `${seconds.toFixed(1)} s`;
  }
  if (seconds < 5400) {
    return `${(seconds / 60).toFixed(1)} min`;
  }
  if (seconds < 172_800) {
    return `${(seconds / 3600).toFixed(2)} h`;
  }
  return `${(seconds / 86_400).toFixed(2)} days`;
}
