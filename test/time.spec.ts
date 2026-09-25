/**
 * The simulation clock.
 *
 * What the transport bar and the URL both rely on: the date never leaves the
 * supported window, pausing keeps the selected speed, and listeners hear about
 * real changes only.
 */

import type { TimeListener } from '../src/core/time.ts';
import { describe, expect, it, vi } from 'vitest';
import { jdUtcToTt, parseUtc } from '../src/astro/timescales.ts';
import { SEC_PER_DAY } from '../src/core/constants.ts';
import { JD_MAX, JD_MIN, RATE_PRESETS, TimeController } from '../src/core/time.ts';

// NaN rather than a cast: should the fixture ever stop parsing, every
// comparison against it fails instead of quietly testing `null`.
const ECLIPSE_2024_JD = parseUtc('2024-04-08 18:17:16') ?? Number.NaN;
const YEAR_1700_JD = parseUtc('1700-01-01') ?? Number.NaN;
const YEAR_2100_JD = parseUtc('2100-01-01') ?? Number.NaN;

describe('the date', () => {
  it('reads back in both UTC and TT', () => {
    const t = new TimeController(ECLIPSE_2024_JD);
    expect(t.jdUtc).toBe(ECLIPSE_2024_JD);
    expect(t.jdTT).toBe(jdUtcToTt(ECLIPSE_2024_JD));
    expect(t.formatUtc()).toBe('2024-04-08 18:17:16');
  });

  it('is clamped to the supported window, and a non-finite date falls to its start', () => {
    expect(new TimeController(0).jdUtc).toBe(JD_MIN);
    expect(new TimeController(1e9).jdUtc).toBe(JD_MAX);
    expect(new TimeController(Number.NaN).jdUtc).toBe(JD_MIN);
    expect(new TimeController(JD_MIN).atLimit).toBe('min');
    expect(new TimeController(JD_MAX).atLimit).toBe('max');
    expect(new TimeController(ECLIPSE_2024_JD).atLimit).toBeNull();
  });

  it('warns outside the best-fit window of the planetary theory', () => {
    expect(new TimeController(ECLIPSE_2024_JD).precisionNote).toBeNull();
    expect(new TimeController(YEAR_1700_JD).precisionNote).toMatch(/1800-2050/u);
    expect(new TimeController(YEAR_2100_JD).precisionNote).not.toBeNull();
  });

  it('accepts typed text and rejects garbage without moving', () => {
    const t = new TimeController(ECLIPSE_2024_JD);
    expect(t.setFromText('nonsense')).toBe(false);
    expect(t.jdUtc).toBe(ECLIPSE_2024_JD);
    expect(t.setFromText('2000-01-01 12:00:00')).toBe(true);
    expect(t.jdUtc).toBe(2451545.0);
  });

  it('jumps to now', () => {
    const t = new TimeController(JD_MIN);
    t.setNow();
    expect(t.jdUtc).toBeGreaterThan(ECLIPSE_2024_JD);
  });
});

describe('advancing', () => {
  it('moves by rate times real seconds, in either direction', () => {
    const t = new TimeController(ECLIPSE_2024_JD);
    t.setRateIndex(6); // 1 day/s
    t.advance(2);
    expect(t.jdUtc).toBeCloseTo(ECLIPSE_2024_JD + 2, 9);
    t.reverse();
    t.advance(1);
    expect(t.jdUtc).toBeCloseTo(ECLIPSE_2024_JD + 1, 9);
  });

  it('stands still while paused, but a manual step still works', () => {
    const t = new TimeController(ECLIPSE_2024_JD);
    t.setPaused(true);
    t.advance(1000);
    expect(t.jdUtc).toBe(ECLIPSE_2024_JD);
    t.step(SEC_PER_DAY);
    expect(t.jdUtc).toBeCloseTo(ECLIPSE_2024_JD + 1, 9);
  });

  it('steps one unit of the selected preset', () => {
    const t = new TimeController(ECLIPSE_2024_JD);
    t.setRateIndex(4); // 1 hour/s
    t.stepOnePreset(-1);
    expect(t.jdUtc).toBeCloseTo(ECLIPSE_2024_JD - 1 / 24, 9);
  });
});

describe('transport', () => {
  it('reports 0 while paused but remembers the selected rate', () => {
    const t = new TimeController(ECLIPSE_2024_JD);
    t.setRateIndex(2);
    t.setDirection(-1);
    expect(t.rate).toBe(-60);
    t.togglePause();
    expect(t.paused).toBe(true);
    expect(t.rate).toBe(0);
    expect(t.selectedRate).toBe(-60);
  });

  it('labels the rate with its sign and pause state', () => {
    const t = new TimeController(ECLIPSE_2024_JD);
    expect(t.rateLabel).toBe('1 sec/s');
    t.faster();
    t.setDirection(-1);
    expect(t.rateLabel).toBe('-10 sec/s');
    t.setPaused(true);
    expect(t.rateLabel).toBe('paused (10 sec/s)');
  });

  it('clamps and rounds the rate index to the ladder', () => {
    const t = new TimeController(ECLIPSE_2024_JD);
    t.slower();
    expect(t.rateIndex).toBe(0);
    t.setRateIndex(99);
    expect(t.rateIndex).toBe(RATE_PRESETS.length - 1);
    t.setRateIndex(2.6);
    expect(t.rateIndex).toBe(3);
  });

  it('resets to real time, forward and running, without touching the date', () => {
    const t = new TimeController(ECLIPSE_2024_JD);
    t.setRateIndex(5);
    t.setDirection(-1);
    t.setPaused(true);
    t.resetRate();
    expect([t.rateIndex, t.direction, t.paused, t.jdUtc]).toEqual([0, 1, false, ECLIPSE_2024_JD]);
  });
});

describe('listeners', () => {
  it('hear real changes only, and stop after unsubscribing', () => {
    const t = new TimeController(ECLIPSE_2024_JD);
    const listener = vi.fn<TimeListener>();
    const unsubscribe = t.subscribe(listener);

    t.setJdUtc(ECLIPSE_2024_JD);
    t.setPaused(false);
    t.setDirection(1);
    t.setRateIndex(0);
    t.advance(0);
    expect(listener).not.toHaveBeenCalled();

    t.setPaused(true);
    t.setDirection(-1);
    t.faster();
    t.step(1);
    expect(listener).toHaveBeenCalledTimes(4);
    expect(listener).toHaveBeenLastCalledWith(t);

    unsubscribe();
    t.step(1);
    expect(listener).toHaveBeenCalledTimes(4);
  });
});
