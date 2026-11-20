/**
 * Technical Indicator Calculations
 * Pure functions for computing chart indicators from OHLCV candle data.
 */

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface IndicatorPoint {
  time: number;
  value: number;
}

/**
 * Coerce a period to a usable positive integer, or null when it is unusable.
 *
 * Without this a zero, negative, fractional or missing period indexed off the
 * front of the candle array (`candles[-1]!.close`) and threw inside render,
 * which the ErrorBoundary turns into a blank terminal. Registry entries are
 * fixed today, but adding an indicator is a documented extension point.
 */
function validPeriod(period: number | undefined | null, min = 1): number | null {
  if (period == null || !Number.isFinite(period)) return null;
  const floored = Math.floor(period);
  return floored >= min ? floored : null;
}

// ── Simple Moving Average ────────────────────────────────────
export function sma(candles: CandleData[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  const p = validPeriod(period);
  if (p === null || candles.length < p) return result;
  period = p;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += candles[i]!.close;

  result.push({ time: candles[period - 1]!.time, value: sum / period });

  for (let i = period; i < candles.length; i++) {
    sum += candles[i]!.close - candles[i - period]!.close;
    result.push({ time: candles[i]!.time, value: sum / period });
  }
  return result;
}

// ── Exponential Moving Average ───────────────────────────────
export function ema(candles: CandleData[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  const p = validPeriod(period);
  if (p === null || candles.length < p) return result;
  period = p;

  const k = 2 / (period + 1);

  // Seed with SMA
  let sum = 0;
  for (let i = 0; i < period; i++) sum += candles[i]!.close;
  let prev = sum / period;
  result.push({ time: candles[period - 1]!.time, value: prev });

  for (let i = period; i < candles.length; i++) {
    prev = candles[i]!.close * k + prev * (1 - k);
    result.push({ time: candles[i]!.time, value: prev });
  }
  return result;
}

/**
 * Wilder's RSI from average gain/loss. A flat stretch has no gains *and* no
 * losses — that is neutral (50), not maximally overbought, which is what the
 * bare `avgLoss === 0 → 100` rule used to report.
 */
function rsiFrom(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// ── Relative Strength Index ──────────────────────────────────
export function rsi(candles: CandleData[], period = 14): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  const p = validPeriod(period);
  if (p === null || candles.length < p + 1) return result;
  period = p;

  let avgGain = 0;
  let avgLoss = 0;

  // First period
  for (let i = 1; i <= period; i++) {
    const change = candles[i]!.close - candles[i - 1]!.close;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  result.push({ time: candles[period]!.time, value: rsiFrom(avgGain, avgLoss) });

  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i]!.close - candles[i - 1]!.close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push({ time: candles[i]!.time, value: rsiFrom(avgGain, avgLoss) });
  }
  return result;
}

// ── MACD ─────────────────────────────────────────────────────
export interface MACDResult {
  macd: IndicatorPoint[];
  signal: IndicatorPoint[];
  histogram: IndicatorPoint[];
}

export function macd(
  candles: CandleData[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MACDResult {
  const fast = validPeriod(fastPeriod);
  const slow = validPeriod(slowPeriod);
  const signalLen = validPeriod(signalPeriod);
  if (fast === null || slow === null || signalLen === null) {
    return { macd: [], signal: [], histogram: [] };
  }
  signalPeriod = signalLen;
  const fastEma = ema(candles, fast);
  const slowEma = ema(candles, slow);

  // Align by time
  const slowTimes = new Map(slowEma.map((p) => [p.time, p.value]));
  const macdLine: IndicatorPoint[] = [];
  for (const fp of fastEma) {
    const sv = slowTimes.get(fp.time);
    if (sv !== undefined) {
      macdLine.push({ time: fp.time, value: fp.value - sv });
    }
  }

  // Signal line = EMA of MACD line
  const signalLine: IndicatorPoint[] = [];
  if (macdLine.length >= signalPeriod) {
    const k = 2 / (signalPeriod + 1);
    let sum = 0;
    for (let i = 0; i < signalPeriod; i++) sum += macdLine[i]!.value;
    let prev = sum / signalPeriod;
    signalLine.push({ time: macdLine[signalPeriod - 1]!.time, value: prev });

    for (let i = signalPeriod; i < macdLine.length; i++) {
      prev = macdLine[i]!.value * k + prev * (1 - k);
      signalLine.push({ time: macdLine[i]!.time, value: prev });
    }
  }

  // Histogram = MACD - Signal
  const signalTimes = new Map(signalLine.map((p) => [p.time, p.value]));
  const histogram: IndicatorPoint[] = [];
  for (const mp of macdLine) {
    const sv = signalTimes.get(mp.time);
    if (sv !== undefined) {
      histogram.push({ time: mp.time, value: mp.value - sv });
    }
  }

  return { macd: macdLine, signal: signalLine, histogram };
}

// ── Bollinger Bands ──────────────────────────────────────────
export interface BollingerResult {
  upper: IndicatorPoint[];
  middle: IndicatorPoint[];
  lower: IndicatorPoint[];
}

export function bollingerBands(
  candles: CandleData[],
  period = 20,
  stdDevMultiplier = 2,
): BollingerResult {
  const upper: IndicatorPoint[] = [];
  const middle: IndicatorPoint[] = [];
  const lower: IndicatorPoint[] = [];

  const p = validPeriod(period);
  if (p === null || candles.length < p) return { upper, middle, lower };
  period = p;

  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j]!.close;
    const avg = sum / period;

    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      variance += (candles[j]!.close - avg) ** 2;
    }
    const stdDev = Math.sqrt(variance / period);

    const t = candles[i]!.time;
    middle.push({ time: t, value: avg });
    upper.push({ time: t, value: avg + stdDevMultiplier * stdDev });
    lower.push({ time: t, value: avg - stdDevMultiplier * stdDev });
  }

  return { upper, middle, lower };
}

// ── Average True Range ───────────────────────────────────────
export function atr(candles: CandleData[], period = 14): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  const p = validPeriod(period);
  if (p === null || candles.length < p + 1) return result;
  period = p;

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i]!.high - candles[i]!.low,
      Math.abs(candles[i]!.high - candles[i - 1]!.close),
      Math.abs(candles[i]!.low - candles[i - 1]!.close),
    );
    trs.push(tr);
  }

  let sum = 0;
  for (let i = 0; i < period; i++) sum += trs[i]!;
  let prev = sum / period;
  result.push({ time: candles[period]!.time, value: prev });

  for (let i = period; i < trs.length; i++) {
    prev = (prev * (period - 1) + trs[i]!) / period;
    result.push({ time: candles[i + 1]!.time, value: prev });
  }
  return result;
}

// ── Stochastic Oscillator ────────────────────────────────────
export interface StochasticResult {
  k: IndicatorPoint[];
  d: IndicatorPoint[];
}

export function stochastic(candles: CandleData[], kPeriod = 14, dPeriod = 3): StochasticResult {
  const kLine: IndicatorPoint[] = [];
  const kLen = validPeriod(kPeriod);
  const dLen = validPeriod(dPeriod);
  if (kLen === null || dLen === null || candles.length < kLen) return { k: [], d: [] };
  kPeriod = kLen;
  dPeriod = dLen;

  for (let i = kPeriod - 1; i < candles.length; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (candles[j]!.high > highest) highest = candles[j]!.high;
      if (candles[j]!.low < lowest) lowest = candles[j]!.low;
    }
    const range = highest - lowest;
    const kVal = range === 0 ? 50 : ((candles[i]!.close - lowest) / range) * 100;
    kLine.push({ time: candles[i]!.time, value: kVal });
  }

  // %D = SMA of %K
  const dLine: IndicatorPoint[] = [];
  if (kLine.length >= dPeriod) {
    let sum = 0;
    for (let i = 0; i < dPeriod; i++) sum += kLine[i]!.value;
    dLine.push({ time: kLine[dPeriod - 1]!.time, value: sum / dPeriod });
    for (let i = dPeriod; i < kLine.length; i++) {
      sum += kLine[i]!.value - kLine[i - dPeriod]!.value;
      dLine.push({ time: kLine[i]!.time, value: sum / dPeriod });
    }
  }

  return { k: kLine, d: dLine };
}

// ── Volume Weighted Average Price ────────────────────────────
export function vwap(candles: CandleData[]): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  let cumVolPrice = 0;
  let cumVol = 0;

  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = Number.isFinite(c.volume) && (c.volume ?? 0) > 0 ? c.volume! : 0;
    cumVolPrice += typicalPrice * vol;
    cumVol += vol;
    // Before any volume has traded VWAP is just the typical price — dividing by
    // a zero denominator produced NaN and broke the whole series.
    result.push({ time: c.time, value: cumVol > 0 ? cumVolPrice / cumVol : typicalPrice });
  }
  return result;
}

// ── Quant-Edge (TypeScript port of Pine Script v6) ─────────────
// Port of "Quant-Edge 终极全能手机版" (see docs/quant-edge.pine for the
// verbatim Pine source). OpenCharts has no Pine runtime, so every Pine
// construct below is re-implemented against CandleData[].
//
// Seeding differences vs Pine (documented, not hidden):
// - Pine ta.ema() seeds from the first bar; this repo's ema() seeds with the
//   SMA of the first `period` closes (same for the MACD signal line). The
//   first EMA200 value therefore appears at bar 200 in both, and the two
//   series converge to within a fraction of an ATR after ~200 more bars.
// - Pine ta.rsi() and this repo's rsi() are both Wilder's smoothed RSI, so
//   RSI14/RSI2 match Pine exactly (up to float rounding).
// - Pine ta.atr() is Wilder's smoothed TR; this repo's atr() is identical.
// - ta.pivothigh(high, 5, 5): a pivot at bar j is confirmed at bar j+5.
//   Pine requires the pivot high to be strictly greater than the 5 bars to
//   its left and greater-or-equal to the 5 bars to its right; this port
//   implements exactly that rule.

export interface QuantEdgeMarker {
  time: number;
  position: "aboveBar" | "belowBar";
  color: string;
  /** lightweight-charts v4 has no diamond marker shape; 抄底/逃顶 use "circle". */
  shape: "arrowUp" | "arrowDown" | "circle";
  text: string;
}

export interface QuantEdgeFvgBox {
  fromTime: number;
  toTime: number;
  /** Higher price (Pine box.new `top` argument). */
  top: number;
  /** Lower price (Pine box.new `bottom` argument). */
  bottom: number;
  bullish: boolean;
}

export interface QuantEdgeHud {
  /** 1 = bull structure, -1 = bear structure, 0 = ranging (Pine smcTrend). */
  smcTrend: number;
  isBull: boolean;
  rsi14: number | null;
  rsi2: number | null;
  /** Pine: atr14 * 2 — the ATR stop reference. */
  atrStop: number | null;
}

export interface QuantEdgeResult {
  ema200: IndicatorPoint[];
  donchianUpper: IndicatorPoint[];
  donchianLower: IndicatorPoint[];
  donchianMid: IndicatorPoint[];
  markers: QuantEdgeMarker[];
  fvgBoxes: QuantEdgeFvgBox[];
  hud: QuantEdgeHud;
}

const QUANT_EDGE_MAX_MARKERS = 300;
const QUANT_EDGE_MAX_BOXES = 40; // Pine: max_boxes_count=40

function medianSpacing(times: number[]): number {
  const diffs: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i]! - times[i - 1]!;
    if (d > 0) diffs.push(d);
  }
  if (diffs.length === 0) return 60;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)]!;
}

/**
 * Full Quant-Edge computation. All seven Pine features are computed here:
 * EMA200 trend line, MACD+RSI BUY/SELL, SMC BOS/CHoCH, FVG boxes, Donchian
 * 20 channel, Connors RSI(2) 抄底/逃顶, and the HUD values. Alerts
 * (alertcondition) have no equivalent in OpenCharts and are intentionally
 * not implemented.
 */
export function quantEdge(candles: CandleData[], swingLen = 5, dcLen = 20): QuantEdgeResult {
  const n = candles.length;
  const empty: QuantEdgeResult = {
    ema200: [],
    donchianUpper: [],
    donchianLower: [],
    donchianMid: [],
    markers: [],
    fvgBoxes: [],
    hud: { smcTrend: 0, isBull: false, rsi14: null, rsi2: null, atrStop: null },
  };
  if (n === 0) return empty;

  const ema200 = ema(candles, 200);
  const sma200 = sma(candles, 200);
  const rsi14Pts = rsi(candles, 14);
  const rsi2Pts = rsi(candles, 2);
  const atr14Pts = atr(candles, 14);
  const macdRes = macd(candles, 12, 26, 9);
  const times = candles.map((c) => c.time);
  const spacing = medianSpacing(times);

  const byTime = (pts: IndicatorPoint[]) => new Map(pts.map((p) => [p.time, p.value]));
  const emaByTime = byTime(ema200);
  const smaByTime = byTime(sma200);
  const rsi14ByTime = byTime(rsi14Pts);
  const rsi2ByTime = byTime(rsi2Pts);
  const atrByTime = byTime(atr14Pts);
  const macdByTime = byTime(macdRes.macd);
  const signalByTime = byTime(macdRes.signal);

  // ── Donchian 20 ──────────────────────────────────────────────
  // Pine: dcUpper = ta.highest(high, 20)[1] — at bar i, the highest high of
  // bars [i-20, i-1] (the [1] shifts the 20-bar window one bar back).
  const donchianUpper: IndicatorPoint[] = [];
  const donchianLower: IndicatorPoint[] = [];
  const donchianMid: IndicatorPoint[] = [];
  for (let i = dcLen; i < n; i++) {
    let upper = -Infinity;
    let lower = Infinity;
    for (let j = i - dcLen; j < i; j++) {
      if (candles[j]!.high > upper) upper = candles[j]!.high;
      if (candles[j]!.low < lower) lower = candles[j]!.low;
    }
    const t = candles[i]!.time;
    donchianUpper.push({ time: t, value: upper });
    donchianLower.push({ time: t, value: lower });
    donchianMid.push({ time: t, value: (upper + lower) / 2 });
  }

  // ── SMC pivots + BUY/SELL + Connors, bar by bar (Pine order) ─
  const markers: QuantEdgeMarker[] = [];
  const fvgBoxes: QuantEdgeFvgBox[] = [];
  let lastHigh: number | null = null;
  let lastLow: number | null = null;
  let smcTrend = 0;

  const isPivotHigh = (j: number): boolean => {
    const h = candles[j]!.high;
    for (let k = j - swingLen; k < j; k++) if (candles[k]!.high >= h) return false;
    for (let k = j + 1; k <= j + swingLen; k++) if (candles[k]!.high > h) return false;
    return true;
  };
  const isPivotLow = (j: number): boolean => {
    const l = candles[j]!.low;
    for (let k = j - swingLen; k < j; k++) if (candles[k]!.low <= l) return false;
    for (let k = j + 1; k <= j + swingLen; k++) if (candles[k]!.low < l) return false;
    return true;
  };

  for (let i = 0; i < n; i++) {
    const c = candles[i]!;
    const t = c.time;

    // FVG — Pine checks bar i against bar i-2 (needs close[1] > open[1]).
    if (i >= 2) {
      const bullFvg = c.low > candles[i - 2]!.high && candles[i - 1]!.close > candles[i - 1]!.open;
      const bearFvg = c.high < candles[i - 2]!.low && candles[i - 1]!.close < candles[i - 1]!.open;
      // Pine box.new(left, top, right, bottom) — top is the HIGHER price:
      // bull box top = low (> high[2] by the FVG condition), bottom = high[2];
      // bear box top = low[2] (> high by the condition), bottom = high.
      if (bullFvg) {
        fvgBoxes.push({
          fromTime: candles[i - 2]!.time,
          toTime: t + 6 * spacing,
          top: c.low,
          bottom: candles[i - 2]!.high,
          bullish: true,
        });
      } else if (bearFvg) {
        fvgBoxes.push({
          fromTime: candles[i - 2]!.time,
          toTime: t + 6 * spacing,
          top: candles[i - 2]!.low,
          bottom: c.high,
          bullish: false,
        });
      }
    }

    // SMC: pivots confirmed at bar i belong to pivot bar j = i - swingLen.
    const j = i - swingLen;
    if (j >= swingLen && j + swingLen < n) {
      if (isPivotHigh(j)) lastHigh = candles[j]!.high;
      if (isPivotLow(j)) lastLow = candles[j]!.low;
    }

    const e200 = emaByTime.get(t);
    const r14 = rsi14ByTime.get(t);
    const r2 = rsi2ByTime.get(t);
    const s200 = smaByTime.get(t);
    const m = macdByTime.get(t);
    const s = signalByTime.get(t);
    const prev = i > 0 ? candles[i - 1]! : null;
    const prevT = prev ? prev.time : null;
    const prevM = prevT !== null ? macdByTime.get(prevT) : undefined;
    const prevS = prevT !== null ? signalByTime.get(prevT) : undefined;
    const prevE200 = prevT !== null ? emaByTime.get(prevT) : undefined;

    // SMC breaks — Pine crossover/ crossunder against the tracked pivot.
    const bullBreak =
      lastHigh !== null && prev !== null && prev.close <= lastHigh && c.close > lastHigh;
    const bearBreak =
      lastLow !== null && prev !== null && prev.close >= lastLow && c.close < lastLow;
    if (bullBreak) {
      markers.push({
        time: t,
        position: "aboveBar",
        color: smcTrend === -1 ? "#00ffff" : "#00ff00",
        shape: "arrowDown",
        text: smcTrend === -1 ? "CHoCH" : "BOS",
      });
      smcTrend = 1;
      lastHigh = null;
    }
    if (bearBreak) {
      markers.push({
        time: t,
        position: "belowBar",
        color: smcTrend === 1 ? "#ff00ff" : "#ff0000",
        shape: "arrowUp",
        text: smcTrend === 1 ? "CHoCH" : "BOS",
      });
      smcTrend = -1;
      lastLow = null;
    }

    // BUY / SELL — EMA200 trend + MACD crossover + RSI14 band.
    if (e200 !== undefined && r14 !== undefined && m !== undefined && s !== undefined) {
      const isBull = c.close > e200;
      const macdCrossUp =
        prevM !== undefined && prevS !== undefined && prevM <= prevS && m > s;
      const macdCrossDown =
        prevM !== undefined && prevS !== undefined && prevM >= prevS && m < s;
      if (isBull && macdCrossUp && r14 > 50 && r14 < 70) {
        markers.push({
          time: t,
          position: "belowBar",
          color: "#00c853",
          shape: "arrowUp",
          text: "BUY",
        });
      }
      const emaCrossDown =
        prevE200 !== undefined && prev !== null && prev.close >= prevE200 && c.close < e200;
      if ((!isBull && macdCrossDown && r14 < 50 && r14 > 30) || (isBull && emaCrossDown)) {
        markers.push({
          time: t,
          position: "aboveBar",
          color: "#ff1744",
          shape: "arrowDown",
          text: "SELL",
        });
      }
    }

    // Connors RSI(2) — dip-buy / pop-sell.
    if (s200 !== undefined && r2 !== undefined) {
      if (c.close > s200 && r2 < 10) {
        markers.push({
          time: t,
          position: "belowBar",
          color: "#00ffff",
          shape: "circle",
          text: "抄底",
        });
      } else if (c.close < s200 && r2 > 90) {
        markers.push({
          time: t,
          position: "aboveBar",
          color: "#ffff00",
          shape: "circle",
          text: "逃顶",
        });
      }
    }
  }

  // Keep the most recent markers/boxes (Pine caps labels at 80, boxes at 40).
  const recentMarkers = markers.slice(-QUANT_EDGE_MAX_MARKERS);
  const recentBoxes = fvgBoxes.slice(-QUANT_EDGE_MAX_BOXES);

  const lastT = times[n - 1]!;
  const lastE200 = emaByTime.get(lastT);
  const lastClose = candles[n - 1]!.close;
  const lastR14 = rsi14ByTime.get(lastT) ?? null;
  const lastR2 = rsi2ByTime.get(lastT) ?? null;
  const lastAtr = atrByTime.get(lastT) ?? null;

  return {
    ema200,
    donchianUpper,
    donchianLower,
    donchianMid,
    markers: recentMarkers,
    fvgBoxes: recentBoxes,
    hud: {
      smcTrend,
      isBull: lastE200 !== undefined ? lastClose > lastE200 : false,
      rsi14: lastR14,
      rsi2: lastR2,
      atrStop: lastAtr !== null ? lastAtr * 2 : null,
    },
  };
}

// ── Indicator Registry (for UI) ──────────────────────────────
export type IndicatorType =
  | "SMA"
  | "EMA"
  | "RSI"
  | "MACD"
  | "BOLL"
  | "ATR"
  | "STOCH"
  | "VWAP"
  | "QUANTEDGE";

export type IndicatorPane = "overlay" | "below";

export interface IndicatorConfig {
  type: IndicatorType;
  label: string;
  pane: IndicatorPane;
  defaultParams: Record<string, number>;
  color: string;
}

export const INDICATOR_REGISTRY: IndicatorConfig[] = [
  {
    type: "SMA",
    label: "Simple Moving Average",
    pane: "overlay",
    defaultParams: { period: 20 },
    color: "#f0b90b",
  },
  {
    type: "EMA",
    label: "Exponential Moving Average",
    pane: "overlay",
    defaultParams: { period: 20 },
    color: "#e377c2",
  },
  {
    type: "RSI",
    label: "Relative Strength Index",
    pane: "below",
    defaultParams: { period: 14 },
    color: "#8884d8",
  },
  {
    type: "MACD",
    label: "MACD",
    pane: "below",
    defaultParams: { fast: 12, slow: 26, signal: 9 },
    color: "#2196f3",
  },
  {
    type: "BOLL",
    label: "Bollinger Bands",
    pane: "overlay",
    defaultParams: { period: 20, stdDev: 2 },
    color: "#26a69a",
  },
  {
    type: "ATR",
    label: "Average True Range",
    pane: "below",
    defaultParams: { period: 14 },
    color: "#ff7043",
  },
  {
    type: "STOCH",
    label: "Stochastic Oscillator",
    pane: "below",
    defaultParams: { kPeriod: 14, dPeriod: 3 },
    color: "#ab47bc",
  },
  {
    type: "VWAP",
    label: "Volume Weighted Avg Price",
    pane: "overlay",
    defaultParams: {},
    color: "#42a5f5",
  },
  {
    type: "QUANTEDGE",
    label: "Quant-Edge",
    pane: "overlay",
    defaultParams: { swingLen: 5, dcLen: 20 },
    color: "#00ff00",
  },
];
