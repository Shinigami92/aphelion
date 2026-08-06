/**
 * Simulation clock.
 *
 * Holds a UTC Julian Date and advances it by `rate` simulated seconds per real
 * second. Rate can be negative (time runs backwards) and zero (paused). All
 * dynamics read `jdTT`; all UI reads `jdUTC`.
 */

import { SEC_PER_DAY } from './constants.ts'
import { formatUtc, jdUtcToTt, nowJdUtc, parseUtc } from '../astro/timescales.ts'

export interface RatePreset {
  /** Simulated seconds per real second. */
  secondsPerSecond: number
  label: string
}

/**
 * Rate ladder. Index 0 is real time; stepping up multiplies roughly by 6-10 so
 * the whole range from "watch the ISS" to "watch Neptune orbit" is a handful of
 * keypresses away.
 */
export const RATE_PRESETS: readonly RatePreset[] = [
  { secondsPerSecond: 1, label: '1 sec/s' },
  { secondsPerSecond: 10, label: '10 sec/s' },
  { secondsPerSecond: 60, label: '1 min/s' },
  { secondsPerSecond: 600, label: '10 min/s' },
  { secondsPerSecond: 3600, label: '1 hour/s' },
  { secondsPerSecond: 21_600, label: '6 hours/s' },
  { secondsPerSecond: 86_400, label: '1 day/s' },
  { secondsPerSecond: 604_800, label: '1 week/s' },
  { secondsPerSecond: 2_592_000, label: '30 days/s' },
  { secondsPerSecond: 31_557_600, label: '1 year/s' },
  { secondsPerSecond: 315_576_000, label: '10 years/s' },
  { secondsPerSecond: 3_155_760_000, label: '100 years/s' },
]

/**
 * Clamp range. The planetary theory is a Keplerian fit whose quoted validity is
 * 1800-2050; it degrades smoothly outside that, so we allow a wide band for
 * exploration but surface a precision warning (see `precisionNote`).
 */
export const JD_MIN = 2305447.5 // 1600-01-01
export const JD_MAX = 2634167.5 // 2500-01-01

const EPHEMERIS_BEST_MIN = 2378496.5 // 1800-01-01
const EPHEMERIS_BEST_MAX = 2469807.5 // 2050-01-01

export type TimeListener = (t: TimeController) => void

export class TimeController {
  /** UTC Julian Date. */
  private _jdUtc: number
  private _rateIndex = 0
  private _direction: 1 | -1 = 1
  private _paused = false
  private listeners = new Set<TimeListener>()

  constructor(jdUtc: number = nowJdUtc()) {
    this._jdUtc = clampJd(jdUtc)
  }

  // -- state ---------------------------------------------------------------

  get jdUtc(): number {
    return this._jdUtc
  }

  get jdTT(): number {
    return jdUtcToTt(this._jdUtc)
  }

  get paused(): boolean {
    return this._paused
  }

  get direction(): 1 | -1 {
    return this._direction
  }

  get rateIndex(): number {
    return this._rateIndex
  }

  /** Signed simulated seconds per real second (0 while paused). */
  get rate(): number {
    if (this._paused) return 0
    return RATE_PRESETS[this._rateIndex]!.secondsPerSecond * this._direction
  }

  /**
   * Signed seconds per real second of the selected preset, ignoring pause.
   *
   * `rate` reports 0 while paused, which is right for advancing the clock but
   * wrong for persisting the setting — a shared link should remember the speed
   * you were paused at.
   */
  get selectedRate(): number {
    return RATE_PRESETS[this._rateIndex]!.secondsPerSecond * this._direction
  }

  get rateLabel(): string {
    const preset = RATE_PRESETS[this._rateIndex]!
    if (this._paused) return `paused (${preset.label})`
    return this._direction < 0 ? `-${preset.label}` : preset.label
  }

  /** Non-null when the current date is outside the theory's best-fit window. */
  get precisionNote(): string | null {
    if (this._jdUtc < EPHEMERIS_BEST_MIN || this._jdUtc > EPHEMERIS_BEST_MAX) {
      return 'outside 1800-2050: positions degrade'
    }
    return null
  }

  get atLimit(): 'min' | 'max' | null {
    if (this._jdUtc <= JD_MIN) return 'min'
    if (this._jdUtc >= JD_MAX) return 'max'
    return null
  }

  // -- advancing -----------------------------------------------------------

  /**
   * Advance by a real-time delta in seconds. Called once per frame; the frame
   * delta is clamped by the caller so a backgrounded tab doesn't jump years.
   */
  advance(realDtSeconds: number): void {
    if (this._paused || realDtSeconds === 0) return
    this.setJdUtc(this._jdUtc + (this.rate * realDtSeconds) / SEC_PER_DAY)
  }

  /** Jump by a fixed number of simulated seconds, ignoring pause state. */
  step(simSeconds: number): void {
    this.setJdUtc(this._jdUtc + simSeconds / SEC_PER_DAY)
  }

  /** Step by one unit of the current rate (used by the frame-step buttons). */
  stepOnePreset(sign: 1 | -1): void {
    this.step(sign * RATE_PRESETS[this._rateIndex]!.secondsPerSecond)
  }

  setJdUtc(jd: number): void {
    const next = clampJd(jd)
    if (next === this._jdUtc) return
    this._jdUtc = next
    this.emit()
  }

  setNow(): void {
    this.setJdUtc(nowJdUtc())
  }

  /** Parse and apply `YYYY-MM-DD HH:MM:SS`. Returns false if unparseable. */
  setFromText(text: string): boolean {
    const jd = parseUtc(text)
    if (jd === null || !Number.isFinite(jd)) return false
    this.setJdUtc(jd)
    return true
  }

  // -- transport -----------------------------------------------------------

  setPaused(paused: boolean): void {
    if (this._paused === paused) return
    this._paused = paused
    this.emit()
  }

  togglePause(): void {
    this.setPaused(!this._paused)
  }

  setDirection(dir: 1 | -1): void {
    if (this._direction === dir) return
    this._direction = dir
    this.emit()
  }

  reverse(): void {
    this._direction = this._direction === 1 ? -1 : 1
    this.emit()
  }

  setRateIndex(index: number): void {
    const clamped = Math.max(0, Math.min(RATE_PRESETS.length - 1, Math.round(index)))
    if (clamped === this._rateIndex) return
    this._rateIndex = clamped
    this.emit()
  }

  faster(): void {
    this.setRateIndex(this._rateIndex + 1)
  }

  slower(): void {
    this.setRateIndex(this._rateIndex - 1)
  }

  /** Reset to real-time, forward, unpaused — without changing the date. */
  resetRate(): void {
    this._rateIndex = 0
    this._direction = 1
    this._paused = false
    this.emit()
  }

  // -- formatting ----------------------------------------------------------

  formatUtc(withMs = false): string {
    return formatUtc(this._jdUtc, withMs)
  }

  // -- notification --------------------------------------------------------

  subscribe(fn: TimeListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this)
  }
}

function clampJd(jd: number): number {
  if (!Number.isFinite(jd)) return JD_MIN
  return Math.max(JD_MIN, Math.min(JD_MAX, jd))
}
