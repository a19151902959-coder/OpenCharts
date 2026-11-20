import { describe, expect, it } from "vitest";
import {
  atr,
  bollingerBands,
  ema,
  macd,
  orderFlow,
  rsi,
  sma,
  stochastic,
  vwap,
  type CandleData,
} from "@/lib/indicators";

/** Candles from a list of closes; high/low straddle the close by 1. */
function closes(values: number[]): CandleData[] {
  return values.map((close, i) => ({
    time: 1000 + i * 60,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 10,
  }));
}

const INVALID_PERIODS = [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY];

describe("sma", () => {
  it("averages a rolling window", () => {
    const out = sma(closes([1, 2, 3, 4, 5]), 3);
    expect(out.map((p) => p.value)).toEqual([2, 3, 4]);
  });

  it("stamps each point with the closing bar's time", () => {
    const candles = closes([1, 2, 3]);
    expect(sma(candles, 3)[0]?.time).toBe(candles[2]!.time);
  });

  it("returns nothing when there is not enough history", () => {
    expect(sma(closes([1, 2]), 5)).toEqual([]);
  });

  it.each(INVALID_PERIODS)("returns nothing for period %p instead of throwing", (period) => {
    expect(() => sma(closes([1, 2, 3]), period)).not.toThrow();
    expect(sma(closes([1, 2, 3]), period)).toEqual([]);
  });
});

describe("ema", () => {
  it("seeds from the SMA then applies the multiplier", () => {
    const out = ema(closes([1, 2, 3, 4]), 3);
    expect(out[0]?.value).toBe(2); // SMA seed of 1,2,3
    // k = 2/(3+1) = 0.5 → 4*0.5 + 2*0.5 = 3
    expect(out[1]?.value).toBe(3);
  });

  it.each(INVALID_PERIODS)("returns nothing for period %p", (period) => {
    expect(ema(closes([1, 2, 3]), period)).toEqual([]);
  });
});

describe("rsi", () => {
  it("is 100 when every bar gains", () => {
    const out = rsi(closes([1, 2, 3, 4, 5, 6]), 3);
    expect(out[0]?.value).toBe(100);
  });

  it("is 0 when every bar loses", () => {
    const out = rsi(closes([6, 5, 4, 3, 2, 1]), 3);
    expect(out[0]?.value).toBe(0);
  });

  it("is neutral, not overbought, on a flat series", () => {
    const out = rsi(closes([5, 5, 5, 5, 5, 5]), 3);
    expect(out[0]?.value).toBe(50);
  });

  it("stays within 0..100", () => {
    const out = rsi(closes([10, 12, 11, 15, 9, 14, 13, 18, 7, 20]), 4);
    for (const point of out) {
      expect(point.value).toBeGreaterThanOrEqual(0);
      expect(point.value).toBeLessThanOrEqual(100);
    }
  });

  it.each(INVALID_PERIODS)("returns nothing for period %p", (period) => {
    expect(rsi(closes([1, 2, 3, 4]), period)).toEqual([]);
  });
});

describe("macd", () => {
  it("lines up the histogram with macd minus signal", () => {
    const series = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    const { macd: line, signal, histogram } = macd(closes(series), 12, 26, 9);

    expect(line.length).toBeGreaterThan(0);
    expect(signal.length).toBeGreaterThan(0);
    expect(histogram).toHaveLength(signal.length);

    const byTime = new Map(line.map((p) => [p.time, p.value]));
    for (const h of histogram) {
      const s = signal.find((p) => p.time === h.time)!;
      expect(h.value).toBeCloseTo(byTime.get(h.time)! - s.value, 10);
    }
  });

  it("returns empty series for an invalid period", () => {
    expect(macd(closes([1, 2, 3]), 0, 26, 9)).toEqual({ macd: [], signal: [], histogram: [] });
  });
});

describe("bollingerBands", () => {
  it("collapses the bands when price is flat", () => {
    const { upper, middle, lower } = bollingerBands(closes([5, 5, 5, 5, 5]), 3);
    expect(middle[0]?.value).toBe(5);
    expect(upper[0]?.value).toBe(5);
    expect(lower[0]?.value).toBe(5);
  });

  it("places the bands symmetrically around the mean", () => {
    const { upper, middle, lower } = bollingerBands(closes([1, 2, 3, 4, 5]), 3);
    for (let i = 0; i < middle.length; i += 1) {
      const spread = upper[i]!.value - middle[i]!.value;
      expect(middle[i]!.value - lower[i]!.value).toBeCloseTo(spread, 10);
    }
  });

  it.each(INVALID_PERIODS)("returns empty bands for period %p", (period) => {
    expect(bollingerBands(closes([1, 2, 3]), period)).toEqual({
      upper: [],
      middle: [],
      lower: [],
    });
  });
});

describe("atr", () => {
  it("measures the true range of a steady series", () => {
    // Each bar spans close±1 → true range 2 once the gap is included.
    const out = atr(closes([10, 10, 10, 10, 10]), 3);
    expect(out[0]?.value).toBeCloseTo(2, 10);
  });

  it("is never negative", () => {
    const out = atr(closes([10, 14, 9, 17, 6, 12, 11]), 3);
    for (const point of out) expect(point.value).toBeGreaterThanOrEqual(0);
  });

  it.each(INVALID_PERIODS)("returns nothing for period %p", (period) => {
    expect(atr(closes([1, 2, 3, 4]), period)).toEqual([]);
  });
});

describe("stochastic", () => {
  it("reads 100 when the close sits at the window high", () => {
    const candles = closes([1, 2, 3]);
    const last = candles[2]!;
    last.high = last.close; // close == highest high
    const { k } = stochastic(candles, 3, 2);
    expect(k[k.length - 1]?.value).toBeCloseTo(100, 6);
  });

  it("is neutral when the window has no range", () => {
    const flat: CandleData[] = [0, 1, 2].map((i) => ({
      time: 1000 + i,
      open: 5,
      high: 5,
      low: 5,
      close: 5,
      volume: 1,
    }));
    const { k } = stochastic(flat, 3, 2);
    expect(k[0]?.value).toBe(50);
  });

  it.each(INVALID_PERIODS)("returns empty lines for period %p", (period) => {
    expect(stochastic(closes([1, 2, 3, 4]), period)).toEqual({ k: [], d: [] });
  });
});

describe("vwap", () => {
  it("weights by volume", () => {
    const candles: CandleData[] = [
      { time: 1, open: 10, high: 10, low: 10, close: 10, volume: 1 },
      { time: 2, open: 20, high: 20, low: 20, close: 20, volume: 3 },
    ];
    // (10*1 + 20*3) / 4 = 17.5
    expect(vwap(candles)[1]?.value).toBeCloseTo(17.5, 10);
  });

  it("falls back to the typical price before any volume trades", () => {
    const candles: CandleData[] = [
      { time: 1, open: 9, high: 12, low: 6, close: 9, volume: 0 },
    ];
    const [point] = vwap(candles);
    expect(point?.value).toBeCloseTo(9, 10);
    expect(Number.isNaN(point!.value)).toBe(false);
  });

  it("never produces NaN for a zero-volume series", () => {
    const candles = closes([1, 2, 3]).map((c) => ({ ...c, volume: 0 }));
    for (const point of vwap(candles)) {
      expect(Number.isFinite(point.value)).toBe(true);
    }
  });
});

describe("orderFlow", () => {
  // 15m bars starting at a UTC midnight so sessions align to calendar days.
  const DAY = 1763596800; // 2026-11-20 00:00 UTC
  const STEP = 900;

  function bar(i: number, o: number, h: number, l: number, c: number, v: number): CandleData {
    return { time: DAY + i * STEP, open: o, high: h, low: l, close: c, volume: v };
  }

  /** Candles from close waypoints with a ±2 zigzag (period 10) so swing pivots form at reversals. */
  function fromWaypoints(waypoints: [number, number][], volAt: (i: number) => number): CandleData[] {
    const n = waypoints[waypoints.length - 1]![0] + 1;
    const closesArr: number[] = [];
    for (let seg = 0; seg < waypoints.length - 1; seg++) {
      const [b0, p0] = waypoints[seg]!;
      const [b1, p1] = waypoints[seg + 1]!;
      for (let i = b0; i < b1; i++) {
        const f = (i - b0) / (b1 - b0);
        closesArr[i] = p0 + (p1 - p0) * f + (i % 10 < 5 ? 2.0 : -2.0);
      }
    }
    closesArr[n - 1] = waypoints[waypoints.length - 1]![1];
    return closesArr.map((c, i) => {
      const o = i === 0 ? c : closesArr[i - 1]!;
      return bar(i, o, Math.max(o, c) + 0.3, Math.min(o, c) - 0.3, c, volAt(i));
    });
  }

  // Day 1: rise 88->114, drop ->96, wave A ->118, drift ->116.
  // Day 2 (bar 96+): flat 116 on huge volume (VA ~116), drop ->102,
  // wave 1 ->126, pullback ->110, wave 2 ->134, then the entry sequence
  // (absorption 179, first shift 180, retest 181, LONG 182) inside day 2.
  function longScenario(): CandleData[] {
    const cs = fromWaypoints(
      [
        [0, 88],
        [28, 114],
        [42, 96],
        [70, 118],
        [96, 116],
        [116, 116],
        [132, 102],
        [148, 126],
        [156, 110],
        [172, 134],
        [184, 124],
        [191, 124],
      ],
      (i) => (i >= 96 && i < 116 ? 10000 : 100),
    );
    cs[179] = bar(179, 128.0, 128.3, 106.5, 113.5, 900);
    cs[180] = bar(180, 113.5, 115.0, 113.0, 114.8, 400);
    cs[181] = bar(181, 114.8, 115.0, 108.0, 111.5, 300);
    cs[182] = bar(182, 111.5, 113.5, 111.2, 113.0, 600);
    return cs;
  }

  it("puts the POC on the highest-volume price row", () => {
    const cs: CandleData[] = [];
    for (let i = 0; i < 60; i++) {
      const big = i >= 30 && i < 35;
      cs.push(bar(i, 100, big ? 100.5 : 101, big ? 99.5 : 99, 100, big ? 5000 : 100));
    }
    const r = orderFlow(cs);
    expect(r.hud.vaPoc).not.toBeNull();
    expect(Math.abs(r.hud.vaPoc! - 100)).toBeLessThan(1.5);
    expect(r.hud.vaHigh! >= r.hud.vaPoc! && r.hud.vaPoc! >= r.hud.vaLow!).toBe(true);
  });

  it("fires absorption, first shift and a LONG entry in order", () => {
    const r = orderFlow(longScenario());
    expect(r.hud.bias).toBe(1);
    const abs = r.markers.find((m) => m.text.startsWith("吸收"));
    const entry = r.markers.find((m) => m.text === "LONG");
    expect(abs).toBeDefined();
    expect(entry).toBeDefined();
    expect(abs!.time).toBeLessThan(entry!.time);
    expect(r.hud.tradesToday).toBe(1);
    const t = r.hud.trade!;
    expect(t.side).toBe(1);
    expect(t.entry - t.risk).toBeLessThan(t.entry); // initial stop below entry
    expect(t.target).toBeGreaterThan(t.entry);
    expect(Math.abs(t.target - 136.3)).toBeLessThan(4); // swing-high target
  });

  it("draws the discount zone at the 0.705 / 0.886 Fib levels of the leg", () => {
    const r = orderFlow(longScenario());
    const zb = r.boxes.find((b) => b.fill.includes("0, 255, 156") && b.top - b.bottom > 2);
    expect(zb).toBeDefined();
    // Leg ~102.3 -> ~136.3: lz1 = 136.3-0.705*34 = 112.3, lz3 = 136.3-0.886*34 = 106.2.
    expect(Math.abs(zb!.top - 112.3)).toBeLessThan(4);
    expect(Math.abs(zb!.bottom - 106.2)).toBeLessThan(4);
    expect(Math.abs(zb!.top - zb!.bottom - 6.15)).toBeLessThan(2);
  });

  it("only uses closed bars: the entry bar alone as the live bar fires nothing", () => {
    const base = longScenario().slice(0, 182); // entry bar (182) cut off
    expect(orderFlow(base).markers.some((m) => m.text === "LONG")).toBe(false);
    expect(orderFlow(longScenario()).markers.some((m) => m.text === "LONG")).toBe(true);
  });

  it("never exceeds the daily trade limit on choppy data", () => {
    const cs: CandleData[] = [];
    let price = 100;
    for (let i = 0; i < 400; i++) {
      price += Math.sin(i / 5) * 1.2 + (i % 7 === 0 ? 0.8 : -0.3);
      cs.push(bar(i, price - 0.5, price + 1, price - 1, price, 500 + (i % 3) * 200));
    }
    const r = orderFlow(cs);
    expect(r.hud.tradesToday).toBeLessThanOrEqual(2);
    expect(r.hud.lossStreak).toBeLessThanOrEqual(2);
    expect(r.markers.length).toBeLessThanOrEqual(300);
    expect(r.boxes.every((b) => b.top > b.bottom)).toBe(true);
  });

  it("handles empty input without throwing", () => {
    expect(() => orderFlow([])).not.toThrow();
    expect(orderFlow([]).markers).toEqual([]);
  });
});
