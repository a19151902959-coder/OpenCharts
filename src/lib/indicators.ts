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

// ── Order Flow Strategy (TypeScript port of Pine Script v6) ─────
// Port of roan-maverick/tradingview-order-flow-strategy-indicator
// (see docs/order-flow-strategy.pine for the verbatim Pine source).
// OpenCharts has no Pine runtime, so every Pine construct below is
// re-implemented against CandleData[].
//
// What is ported (Pine modules 01-08 + 11, core process only):
// environment (HTF value structure), value area (VAH/POC/VAL),
// discount/premium Fib zones, absorption, first shift, second-failure
// entries, trapped-trader zones, trade management (stop / reclaim /
// breakeven / trailing / daily limits), target map (POC / swing), the
// dashboard values, resting-liquidity swing zones + sweeps, and
// inefficiency corridors + impulse candles (both trivial from OHLCV).
//
// Deliberate approximations (documented, not hidden):
// - Pine reads order flow from LOWER-timeframe candles
//   (request.security_lower_tf): volume on up LTF candles counts as
//   aggressive buying, down as aggressive selling. OpenCharts only has
//   the chart timeframe's candles, so per-bar delta falls back to Pine's
//   own no-LTF fallback: +volume on green bars, -volume on red bars
//   (deltaPct is +100 / -100 / 0). The volume-POC position inside the
//   bar, which Pine measures from LTF candles, is estimated from the
//   candle's wick: a long lower wick with a close well off the low is
//   the OHLCV evidence that volume traded at the low and was rejected.
//   Absorption quality (AQ) uses that estimate.
// - Pine reads HTF structure (1h + 4h) via request.security. This port
//   resamples the chart candles into 1h/4h bars (only completed HTF
//   bars, lagged one HTF bar like Pine's f_structPrev) when the chart
//   timeframe is below them; on 1h+ charts it falls back to the local
//   structure, exactly as Pine does when the HTF is not above the chart.
// - Sessions are UTC calendar days (Pine uses the chart timezone's day
//   boundary). Trade window is Always (24/7): the user trades crypto
//   (BTCUSD), so the New-York-open window is not applied.
// - Gamma regime has no data source in OpenCharts: it is treated as
//   "未设置" (no setups skipped). Call/put walls are 0 (off).
// - Footprint per-price-row, the pressure wave and the AI agent packet /
//   webhook have no equivalent here and are NOT implemented.

export interface OrderFlowMarker {
  time: number;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle";
  text: string;
}

export interface OrderFlowBox {
  fromTime: number;
  toTime: number;
  /** Higher price (Pine box.new `top` argument). */
  top: number;
  /** Lower price (Pine box.new `bottom` argument). */
  bottom: number;
  fill: string;
  stroke: string;
  dashed?: boolean;
}

export interface OrderFlowTrade {
  side: 1 | -1;
  status: string;
  entry: number;
  stop: number;
  target: number;
  targetSource: string;
  risk: number;
  entryTime: number;
  exitR: number | null;
}

export interface OrderFlowHud {
  /** 1 = value up, -1 = value down, 0 = balance (Pine `bias`). */
  bias: number;
  valuePos: "DISCOUNT" | "PREMIUM" | "INSIDE_VALUE" | "UNKNOWN";
  longState: "IDLE" | "ABSORPTION" | "FIRST_SHIFT";
  shortState: "IDLE" | "ABSORPTION" | "FIRST_SHIFT";
  stateLabel: string;
  deltaPct: number | null;
  relVol: number | null;
  /** False when no candle carries volume: absorption runs on wicks only. */
  hasVolume: boolean;
  tradesToday: number;
  lossStreak: number;
  trade: OrderFlowTrade | null;
  lastOutcome: string | null;
  vaPoc: number | null;
  vaHigh: number | null;
  vaLow: number | null;
  longZoneVol: string;
  shortZoneVol: string;
}

export interface OrderFlowResult {
  vaHigh: IndicatorPoint[];
  vaLow: IndicatorPoint[];
  vaPoc: IndicatorPoint[];
  longZoneMid: IndicatorPoint[];
  shortZoneMid: IndicatorPoint[];
  stopLine: IndicatorPoint[];
  targetLine: IndicatorPoint[];
  entryLine: IndicatorPoint[];
  markers: OrderFlowMarker[];
  boxes: OrderFlowBox[];
  hud: OrderFlowHud;
}

// Pine defaults (see the inputs section of order-flow-strategy.pine).
const OF_SWING_LEN = 5;
const OF_STRUCT_SWING = 3;
const OF_LEG_LOOKBACK = 60;
const OF_VA_PCT = 70;
const OF_ROW_ATR = 0.5;
const OF_MIN_DEV_BARS = 12;
const OF_FIB_A = 0.705;
const OF_FIB_B = 0.788;
const OF_FIB_C = 0.886;
const OF_NO_RESULT_PCT = 30;
const OF_SETUP_BARS = 8;
const OF_PART_LEN = 50;
const OF_PART_MULT = 1.0;
const OF_STOP_BUF_ATR = 0.1;
const OF_MIN_R = 1.5;
const OF_TRAIL_START_R = 1.5;
const OF_RECLAIM_BARS = 6;
const OF_BE_AT_R = 1.0;
const OF_MAX_TRADES = 2;
const OF_MAX_LOSS_STREAK = 2;
const OF_MAX_MARKERS = 300;
const OF_MAX_INEFF = 5;
const OF_MAX_LIQ_PER_SIDE = 4;
const OF_INEFF_MIN_ATR = 0.4;
const OF_IMP_BODY_ATR = 1.3;

const OF_GREEN = "#00ff9c";
const OF_RED = "#ff2d55";
const OF_CYAN = "#00e5ff";
const OF_MAGENTA = "#ff2bd6";
const OF_GOLD = "#ffc400";

function ofPivotHighAt(candles: CandleData[], j: number, len: number): boolean {
  const h = candles[j]!.high;
  for (let k = j - len; k < j; k++) if (candles[k]!.high >= h) return false;
  for (let k = j + 1; k <= j + len; k++) if (candles[k]!.high > h) return false;
  return true;
}

function ofPivotLowAt(candles: CandleData[], j: number, len: number): boolean {
  const l = candles[j]!.low;
  for (let k = j - len; k < j; k++) if (candles[k]!.low <= l) return false;
  for (let k = j + 1; k <= j + len; k++) if (candles[k]!.low < l) return false;
  return true;
}

interface OfStructEvent {
  /** Chart-bar index from which this pivot counts (confirmation bar). */
  bar: number;
  kind: "high" | "low";
  price: number;
}

// Pine f_struct(): 1 = higher highs and higher lows, -1 = lower highs and
// lower lows, else 0. Evaluated per bar from pivot events confirmed by then.
function ofStructSeries(events: OfStructEvent[], n: number): number[] {
  const out = new Array<number>(n).fill(0);
  let h1 = NaN;
  let h2 = NaN;
  let l1 = NaN;
  let l2 = NaN;
  let e = 0;
  for (let i = 0; i < n; i++) {
    while (e < events.length && events[e]!.bar <= i) {
      const ev = events[e++]!;
      if (ev.kind === "high") {
        h2 = h1;
        h1 = ev.price;
      } else {
        l2 = l1;
        l1 = ev.price;
      }
    }
    out[i] =
      !Number.isNaN(h1) && !Number.isNaN(h2) && !Number.isNaN(l1) && !Number.isNaN(l2)
        ? h1 > h2 && l1 > l2
          ? 1
          : h1 < h2 && l1 < l2
            ? -1
            : 0
        : 0;
  }
  return out;
}

function ofAggregateCandles(
  candles: CandleData[],
  barsPer: number,
): { htf: CandleData[]; endIdx: number[] } {
  const htf: CandleData[] = [];
  const endIdx: number[] = [];
  for (let i = 0; i < candles.length; i += barsPer) {
    const group = candles.slice(i, i + barsPer);
    let high = -Infinity;
    let low = Infinity;
    let vol = 0;
    for (const c of group) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      vol += c.volume ?? 0;
    }
    htf.push({
      time: group[group.length - 1]!.time,
      open: group[0]!.open,
      high,
      low,
      close: group[group.length - 1]!.close,
      volume: vol,
    });
    endIdx.push(i + group.length - 1);
  }
  return { htf, endIdx };
}

// Pine f_va(): POC is the highest-volume row; the value area expands from
// the POC, each step taking the neighbouring row with the larger volume,
// until it holds vaPct% of the session volume.
function ofValueArea(
  map: Map<number, number>,
  k0: number,
  k1: number,
  step: number,
  vaPct: number,
): { poc: number; vah: number; val: number; maxV: number } | null {
  let total = 0;
  let maxV = 0;
  let pocK = k0;
  for (let k = k0; k <= k1; k++) {
    const v = map.get(k) ?? 0;
    total += v;
    if (v > maxV) {
      maxV = v;
      pocK = k;
    }
  }
  if (total <= 0 || maxV <= 0) return null;
  let upK = pocK;
  let dnK = pocK;
  let acc = maxV;
  while (acc < (total * vaPct) / 100 && (upK < k1 || dnK > k0)) {
    const vUp = upK < k1 ? (map.get(upK + 1) ?? 0) : -1;
    const vDn = dnK > k0 ? (map.get(dnK - 1) ?? 0) : -1;
    if (vUp >= vDn) {
      upK += 1;
      acc += Math.max(0, vUp);
    } else {
      dnK -= 1;
      acc += Math.max(0, vDn);
    }
  }
  return { poc: (pocK + 0.5) * step, vah: (upK + 1) * step, val: dnK * step, maxV };
}

interface OfLevel {
  price: number;
  bar: number;
  isHigh: boolean;
  touches: number;
  half: number;
  swept: boolean;
  sweptBar: number | null;
}

interface OfGap {
  top: number;
  bot: number;
  dir: 1 | -1;
  t0: number;
  fillLvl: number;
  active: boolean;
  filledBar: number | null;
}

/**
 * Full Order Flow Strategy computation. One linear pass in Pine's section
 * order: value area, impulse legs / Fib zones, order flow, liquidity,
 * inefficiencies, then the closed-bar-only trade state machine.
 * The last candle is the live forming bar: it is included in display
 * lines but excluded from setups, liquidity and inefficiency detection,
 * exactly like Pine's barstate.isconfirmed rule (no repainting).
 */
export function orderFlow(candles: CandleData[]): OrderFlowResult {
  const n = candles.length;
  const emptyHud: OrderFlowHud = {
    bias: 0,
    valuePos: "UNKNOWN",
    longState: "IDLE",
    shortState: "IDLE",
    stateLabel: "观望",
    deltaPct: null,
    relVol: null,
    hasVolume: false,
    tradesToday: 0,
    lossStreak: 0,
    trade: null,
    lastOutcome: null,
    vaPoc: null,
    vaHigh: null,
    vaLow: null,
    longZoneVol: "UNKNOWN",
    shortZoneVol: "UNKNOWN",
  };
  const empty: OrderFlowResult = {
    vaHigh: [],
    vaLow: [],
    vaPoc: [],
    longZoneMid: [],
    shortZoneMid: [],
    stopLine: [],
    targetLine: [],
    entryLine: [],
    markers: [],
    boxes: [],
    hud: emptyHud,
  };
  if (n < 30) return empty;

  const times = candles.map((c) => c.time);
  const spacing = medianSpacing(times);
  const lastTime = times[n - 1]!;
  const hasVolume = candles.some((c) => (c.volume ?? 0) > 0);
  const atrPts = atr(candles, 14);
  const atrByTime = new Map(atrPts.map((p) => [p.time, p.value]));
  const atrAt = (i: number): number | null => atrByTime.get(candles[i]!.time) ?? null;

  // ── Environment: HTF structure ─────────────────────────────
  // Local (chart-timeframe) structure, swing 3, pivots confirmed by bar i.
  const localEvents: OfStructEvent[] = [];
  for (let j = OF_STRUCT_SWING; j + OF_STRUCT_SWING < n; j++) {
    if (ofPivotHighAt(candles, j, OF_STRUCT_SWING)) {
      localEvents.push({ bar: j + OF_STRUCT_SWING, kind: "high", price: candles[j]!.high });
    }
    if (ofPivotLowAt(candles, j, OF_STRUCT_SWING)) {
      localEvents.push({ bar: j + OF_STRUCT_SWING, kind: "low", price: candles[j]!.low });
    }
  }
  const localStruct = ofStructSeries(localEvents, n);
  // HTF structure: resample the chart candles into 1h/4h bars. Pine reads
  // the previous CLOSED HTF bar (f_structPrev), so a pivot only counts
  // one HTF bar after its confirmation bar.
  const htfStruct = (targetSec: number): number[] => {
    const barsPer = Math.max(1, Math.round(targetSec / spacing));
    if (barsPer <= 1) return localStruct;
    const { htf, endIdx } = ofAggregateCandles(candles, barsPer);
    const events: OfStructEvent[] = [];
    for (let j = OF_STRUCT_SWING; j + OF_STRUCT_SWING < htf.length; j++) {
      const confirmBar = endIdx[j + OF_STRUCT_SWING]! + barsPer;
      if (ofPivotHighAt(htf, j, OF_STRUCT_SWING)) {
        events.push({ bar: confirmBar, kind: "high", price: htf[j]!.high });
      }
      if (ofPivotLowAt(htf, j, OF_STRUCT_SWING)) {
        events.push({ bar: confirmBar, kind: "low", price: htf[j]!.low });
      }
    }
    return ofStructSeries(events, n);
  };
  const struct1 = htfStruct(3600);
  const struct2 = htfStruct(14400);
  const biasArr: number[] = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const s1 = struct1[i]!;
    const s2 = struct2[i]!;
    biasArr[i] = s1 === 1 && s2 >= 0 ? 1 : s1 === -1 && s2 <= 0 ? -1 : 0;
  }

  // ── Per-bar state ──────────────────────────────────────────
  const markers: OrderFlowMarker[] = [];
  const vaHighPts: IndicatorPoint[] = [];
  const vaLowPts: IndicatorPoint[] = [];
  const vaPocPts: IndicatorPoint[] = [];
  const longZoneMidPts: IndicatorPoint[] = [];
  const shortZoneMidPts: IndicatorPoint[] = [];
  const stopByBar = new Map<number, number>();
  const targetByBar = new Map<number, number>();
  const entryByBar = new Map<number, number>();

  // Value area (developing session, UTC day).
  const devMap = new Map<number, number>();
  let devStep = NaN;
  let devMinK = Infinity;
  let devMaxK = -Infinity;
  let devBars = 0;
  let sessionDay = NaN;
  let finalDevMaxV = 0;

  // Swing pivots (swing 5) and impulse legs.
  let lastPHBar: number | null = null;
  let lastPHPrice: number | null = null;
  let lastPLBar: number | null = null;
  let lastPLPrice: number | null = null;
  let lH = NaN;
  let lL = NaN;
  let lHBar = -1;
  let lLBar = -1;
  let lInternal = false;
  let lValid = false;
  let sL = NaN;
  let sH = NaN;
  let sLBar = -1;
  let sHBar = -1;
  let sInternal = false;
  let sValid = false;
  // Zone readiness at the last bar (loop-scoped consts below can't escape).
  let finalLongZoneReady = false;
  let finalShortZoneReady = false;

  // Trade state machine (Pine section 4).
  let tradesToday = 0;
  let lossStreak = 0;
  let tSide = 0;
  let tStatus = "NONE";
  let tEntry = NaN;
  let tStop = NaN;
  let tTarget = NaN;
  let tRisk = NaN;
  let tReclaim: number | null = null;
  let tReclaimed = false;
  let tBE = false;
  let tBar = -1;
  let tTargetSrc = "NONE";
  let tTrail = false;
  let tTrailTrig = NaN;
  let lastOutcome: string | null = null;
  let lState = 0;
  let lAbsLow = NaN;
  let lAbsBar = -1;
  let lShiftClose = NaN;
  let lRetest: number | null = null;
  let lRetestBar = -1;
  let sState = 0;
  let sAbsHigh = NaN;
  let sAbsBar = -1;
  let sShiftClose = NaN;
  let sRetest: number | null = null;
  let sRetestBar = -1;
  let lastEntryInfo: {
    side: 1 | -1;
    entryBar: number;
    absBar: number;
    absLevel: number;
    retestBar: number;
    retest: number;
    atr: number;
    closeBar: number | null;
  } | null = null;

  // Resting liquidity (swing highs/lows, equal levels merged).
  const bslLevels: OfLevel[] = [];
  const sslLevels: OfLevel[] = [];
  const addLevel = (arr: OfLevel[], isHigh: boolean, px: number, bar: number, atrV: number) => {
    const tol = atrV * 0.15;
    for (const l of arr) {
      if (Math.abs(l.price - px) <= tol) {
        l.touches += 1;
        l.price = isHigh ? Math.max(l.price, px) : Math.min(l.price, px);
        return;
      }
    }
    arr.push({
      price: px,
      bar,
      isHigh,
      touches: 1,
      half: atrV * 0.12,
      swept: false,
      sweptBar: null,
    });
    while (arr.length > OF_MAX_LIQ_PER_SIDE) arr.shift();
  };

  // Inefficiency corridors.
  const gaps: OfGap[] = [];
  let lastGapUp = -1000;
  let lastGapDn = -1000;

  // Volume average for the participation filter.
  const volAvgAt = (i: number): number | null => {
    if (i < OF_PART_LEN) return null;
    let sum = 0;
    for (let k = i - OF_PART_LEN + 1; k <= i; k++) sum += candles[k]!.volume ?? 0;
    return sum / OF_PART_LEN;
  };

  const targetFor = (
    side: 1 | -1,
    entry: number,
    risk: number,
    swingT: number,
    vaPoc: number | null,
  ): { target: number; src: string } => {
    const minDist = OF_MIN_R * risk;
    const fallback = entry + side * OF_MIN_R * risk;
    const ok = side * (swingT - entry) >= minDist;
    const pocOk = vaPoc !== null && side * (vaPoc - entry) >= minDist;
    if (!ok && pocOk) return { target: vaPoc!, src: "POC" };
    return { target: ok ? swingT : fallback, src: ok ? "SWING" : "R" };
  };

  for (let i = 0; i < n; i++) {
    const c = candles[i]!;
    const t = c.time;
    const dayKey = Math.floor(t / 86400);
    const confirmed = i <= n - 2;
    const atrV = atrAt(i) ?? c.high - c.low;
    const vol = c.volume ?? 0;

    // ── Daily reset (Pine newDay) ──
    if (dayKey !== sessionDay) {
      sessionDay = dayKey;
      devMap.clear();
      devBars = 0;
      devMinK = Infinity;
      devMaxK = -Infinity;
      // Pine sets the profile row height once, at the session start.
      devStep = Math.max(1e-12, atrV * OF_ROW_ATR);
      tradesToday = 0;
      lossStreak = 0;
    }

    // ── Value area: add this candle's volume, spread across its rows ──
    if (vol > 0 && devStep > 0) {
      const kLo = Math.floor(c.low / devStep);
      const kHi = Math.max(kLo, Math.min(kLo + 300, Math.floor(c.high / devStep)));
      const share = vol / (kHi - kLo + 1);
      for (let k = kLo; k <= kHi; k++) devMap.set(k, (devMap.get(k) ?? 0) + share);
      if (kLo < devMinK) devMinK = kLo;
      if (kHi > devMaxK) devMaxK = kHi;
    }
    devBars += 1;
    let vaPoc: number | null = null;
    let vaHigh: number | null = null;
    let vaLow: number | null = null;
    let vaMaxV = 0;
    if (devBars >= OF_MIN_DEV_BARS && Number.isFinite(devMinK)) {
      const va = ofValueArea(devMap, devMinK, devMaxK, devStep, OF_VA_PCT);
      if (va) {
        vaPoc = va.poc;
        vaHigh = va.vah;
        vaLow = va.val;
        vaMaxV = va.maxV;
      }
    }
    if (vaMaxV > 0) finalDevMaxV = vaMaxV;
    if (vaPoc !== null) vaPocPts.push({ time: t, value: vaPoc });
    if (vaHigh !== null) vaHighPts.push({ time: t, value: vaHigh });
    if (vaLow !== null) vaLowPts.push({ time: t, value: vaLow });

    // ── Pivots (swing 5, confirmed at bar i) and impulse legs ──
    const j = i - OF_SWING_LEN;
    let newPh: number | null = null;
    let newPl: number | null = null;
    if (j >= OF_SWING_LEN && j + OF_SWING_LEN < n) {
      if (ofPivotHighAt(candles, j, OF_SWING_LEN)) {
        newPh = candles[j]!.high;
        lastPHBar = j;
        lastPHPrice = newPh;
      }
      if (ofPivotLowAt(candles, j, OF_SWING_LEN)) {
        newPl = candles[j]!.low;
        lastPLBar = j;
        lastPLPrice = newPl;
      }
    }
    // Lowest/highest of the 60 bars ending at the pivot bar.
    const windowLow = (endIdx: number): { v: number; idx: number } => {
      let v = Infinity;
      let idx = endIdx;
      for (let k = Math.max(0, endIdx - OF_LEG_LOOKBACK + 1); k <= endIdx; k++) {
        if (candles[k]!.low < v) {
          v = candles[k]!.low;
          idx = k;
        }
      }
      return { v, idx };
    };
    const windowHigh = (endIdx: number): { v: number; idx: number } => {
      let v = -Infinity;
      let idx = endIdx;
      for (let k = Math.max(0, endIdx - OF_LEG_LOOKBACK + 1); k <= endIdx; k++) {
        if (candles[k]!.high > v) {
          v = candles[k]!.high;
          idx = k;
        }
      }
      return { v, idx };
    };
    let recentHigh = -Infinity;
    let recentLow = Infinity;
    for (let k = Math.max(0, i - OF_SWING_LEN); k <= i; k++) {
      if (candles[k]!.high > recentHigh) recentHigh = candles[k]!.high;
      if (candles[k]!.low < recentLow) recentLow = candles[k]!.low;
    }
    // Pine: `if not na(ph) and (not lValid or ph >= lH) ... else if lValid`
    // — the else-if also runs when a pivot high exists but is not higher.
    if (newPh !== null && (!lValid || newPh >= lH)) {
      const w = windowLow(j);
      lH = Math.max(newPh, recentHigh);
      lHBar = j;
      lL = w.v;
      lLBar = w.idx;
      lInternal =
        lastPLBar !== null && lastPLBar > lLBar && lastPLBar < lHBar && lastPLPrice !== null && lastPLPrice > lL;
      lValid = lH > lL;
    } else if (lValid) {
      lH = Math.max(lH, c.high);
    }
    if (newPl !== null && (!sValid || newPl <= sL)) {
      const w = windowHigh(j);
      sL = Math.min(newPl, recentLow);
      sLBar = j;
      sH = w.v;
      sHBar = w.idx;
      sInternal =
        lastPHBar !== null && lastPHBar > sHBar && lastPHBar < sLBar && lastPHPrice !== null && lastPHPrice < sH;
      sValid = sH > sL;
    } else if (sValid) {
      sL = Math.min(sL, c.low);
    }
    const lRange = lH - lL;
    const lz1 = lH - OF_FIB_A * lRange;
    const lz2 = lH - OF_FIB_B * lRange;
    const lz3 = lH - OF_FIB_C * lRange;
    const sRange = sH - sL;
    const sz1 = sL + OF_FIB_A * sRange;
    const sz2 = sL + OF_FIB_B * sRange;
    const sz3 = sL + OF_FIB_C * sRange;
    // A close beyond 0.886 kills the zone until a new leg forms.
    if (lValid && c.close < lz3) lValid = false;
    if (sValid && c.close > sz3) sValid = false;
    const lZoneReady = lValid && lInternal && vaLow !== null && lz1 <= vaLow;
    const sZoneReady = sValid && sInternal && vaHigh !== null && sz1 >= vaHigh;
    finalLongZoneReady = lZoneReady;
    finalShortZoneReady = sZoneReady;
    const longLoc = lZoneReady && c.low <= lz1 && c.close >= lz3;
    const shortLoc = sZoneReady && c.high >= sz1 && c.close <= sz3;
    if (lZoneReady) longZoneMidPts.push({ time: t, value: lz2 });
    if (sZoneReady) shortZoneMidPts.push({ time: t, value: sz2 });

    // ── Order flow from this bar (Pine's no-LTF fallback) ──
    // barDelta is +volume on green bars, -volume on red bars; deltaPct is
    // therefore +100 / -100 / 0. The volume-POC position inside the bar is
    // estimated from the wick: pocPos is the midpoint of the rejected wick.
    const barDelta = c.close > c.open ? vol : c.close < c.open ? -vol : 0;
    const deltaPct = vol > 0 ? (barDelta / vol) * 100 : null;
    const range = c.high - c.low;
    const closePos = range > 0 ? ((c.close - c.low) / range) * 100 : 50;
    const lowerWick = range > 0 ? (Math.min(c.open, c.close) - c.low) / range : 0;
    const upperWick = range > 0 ? (c.high - Math.max(c.open, c.close)) / range : 0;
    const pocPosLong = lowerWick * 50;
    const pocPosShort = 100 - upperWick * 50;
    const volAvg = volAvgAt(i);
    const relVol = volAvg !== null && volAvg > 0 ? vol / volAvg : null;
    const partOk = !hasVolume ? true : volAvg === null ? false : vol >= OF_PART_MULT * volAvg;
    const sellerAbsorbed =
      c.close < c.open &&
      closePos >= OF_NO_RESULT_PCT &&
      lowerWick >= 0.25 &&
      (!hasVolume || (relVol !== null && relVol >= 1.0));
    const buyerAbsorbed =
      c.close > c.open &&
      closePos <= 100 - OF_NO_RESULT_PCT &&
      upperWick >= 0.25 &&
      (!hasVolume || (relVol !== null && relVol >= 1.0));
    const buyersPush = c.close > c.open;
    const sellersPush = c.close < c.open;
    const aqLong =
      35 * Math.min(Math.max(-(deltaPct ?? 0) / 40, 0), 1) +
      25 * Math.min(Math.max((35 - pocPosLong) / 35, 0), 1) +
      25 * Math.min(Math.max((closePos - OF_NO_RESULT_PCT) / Math.max(100 - OF_NO_RESULT_PCT, 1), 0), 1) +
      15 * (relVol === null ? 0.5 : Math.min(Math.max(relVol / 2, 0), 1));
    const aqShort =
      35 * Math.min(Math.max((deltaPct ?? 0) / 40, 0), 1) +
      25 * Math.min(Math.max((pocPosShort - 65) / 35, 0), 1) +
      25 * Math.min(Math.max((100 - OF_NO_RESULT_PCT - closePos) / Math.max(100 - OF_NO_RESULT_PCT, 1), 0), 1) +
      15 * (relVol === null ? 0.5 : Math.min(Math.max(relVol / 2, 0), 1));

    // ── Resting liquidity: swing levels + sweeps (confirmed bars) ──
    if (confirmed && atrV > 0) {
      if (newPh !== null) addLevel(bslLevels, true, newPh, j, atrV);
      if (newPl !== null) addLevel(sslLevels, false, newPl, j, atrV);
      for (const l of bslLevels) {
        if (!l.swept && c.high - l.price > atrV * 0.03 && c.close < l.price) {
          l.swept = true;
          l.sweptBar = i;
          markers.push({
            time: t,
            position: "aboveBar",
            color: OF_RED,
            shape: "circle",
            text: "BSL扫",
          });
        }
      }
      for (const l of sslLevels) {
        if (!l.swept && l.price - c.low > atrV * 0.03 && c.close > l.price) {
          l.swept = true;
          l.sweptBar = i;
          markers.push({
            time: t,
            position: "belowBar",
            color: OF_GREEN,
            shape: "circle",
            text: "SSL扫",
          });
        }
      }
    }

    // ── Inefficiency corridors (confirmed bars) ──
    if (confirmed && i >= 2 && atrV > 0) {
      for (const g of gaps) {
        if (g.active && i > g.t0 && g.top > g.bot) {
          g.fillLvl = g.dir === 1 ? Math.min(g.fillLvl, c.low) : Math.max(g.fillLvl, c.high);
          if ((g.dir === 1 && g.fillLvl <= g.bot) || (g.dir === -1 && g.fillLvl >= g.top)) {
            g.active = false;
            g.filledBar = i;
          }
        }
      }
      const gapUpRaw =
        c.low > candles[i - 2]!.high &&
        candles[i - 1]!.close > candles[i - 1]!.open &&
        c.low - candles[i - 2]!.high >= atrV * OF_INEFF_MIN_ATR;
      const gapDnRaw =
        c.high < candles[i - 2]!.low &&
        candles[i - 1]!.close < candles[i - 1]!.open &&
        candles[i - 2]!.low - c.high >= atrV * OF_INEFF_MIN_ATR;
      if (gapUpRaw && i - lastGapUp >= 3) {
        gaps.push({ top: c.low, bot: candles[i - 2]!.high, dir: 1, t0: i, fillLvl: c.low, active: true, filledBar: null });
        lastGapUp = i;
      }
      if (gapDnRaw && i - lastGapDn >= 3) {
        gaps.push({ top: candles[i - 2]!.low, bot: c.high, dir: -1, t0: i, fillLvl: c.high, active: true, filledBar: null });
        lastGapDn = i;
      }
      while (gaps.length > OF_MAX_INEFF) gaps.shift();
    }

    // ── Trade state machine (closed bars only) ──
    if (confirmed) {
      const bias = biasArr[i]!;
      let openedLong = false;
      let openedShort = false;
      let absLongMark = false;
      let absShortMark = false;
      let lShiftMark = false;
      let sShiftMark = false;
      let exitR: number | null = null;
      let exitSide = 0;

      // 1) Manage the open trade.
      if (tSide !== 0 && i > tBar) {
        let closed = false;
        if (tSide === 1) {
          if (c.low <= tStop) {
            tStatus = tStop > tEntry ? "TRAIL_STOP" : tBE || tStop === tEntry ? "BREAKEVEN" : "STOPPED";
            closed = true;
          } else if (c.high >= tTarget) {
            tStatus = "TARGET_HIT";
            closed = true;
          } else {
            if (!tReclaimed && (tReclaim === null || c.close > tReclaim)) {
              tReclaimed = true;
              tStatus = "VALUE_RECLAIMED";
            }
            if (!tBE && OF_BE_AT_R > 0 && c.high >= tEntry + OF_BE_AT_R * tRisk) {
              tStop = Math.max(tStop, tEntry);
              tBE = true;
              tStatus = "STOP_AT_ENTRY";
            }
            if (!tBE && !tReclaimed && i - tBar >= OF_RECLAIM_BARS) {
              tStop = Math.max(tStop, tEntry);
              tBE = true;
              tStatus = "NO_RECLAIM_STOP_AT_ENTRY";
            }
            if (!tTrail && c.high >= tTrailTrig) {
              tTrail = true;
              tStatus = "TRAILING";
            }
            if (tTrail && buyersPush && c.low - OF_STOP_BUF_ATR * atrV > tStop) {
              tStop = c.low - OF_STOP_BUF_ATR * atrV;
              tStatus = "TRAILING";
            }
          }
        } else {
          if (c.high >= tStop) {
            tStatus = tStop < tEntry ? "TRAIL_STOP" : tBE || tStop === tEntry ? "BREAKEVEN" : "STOPPED";
            closed = true;
          } else if (c.low <= tTarget) {
            tStatus = "TARGET_HIT";
            closed = true;
          } else {
            if (!tReclaimed && (tReclaim === null || c.close < tReclaim)) {
              tReclaimed = true;
              tStatus = "VALUE_RECLAIMED";
            }
            if (!tBE && OF_BE_AT_R > 0 && c.low <= tEntry - OF_BE_AT_R * tRisk) {
              tStop = Math.min(tStop, tEntry);
              tBE = true;
              tStatus = "STOP_AT_ENTRY";
            }
            if (!tBE && !tReclaimed && i - tBar >= OF_RECLAIM_BARS) {
              tStop = Math.min(tStop, tEntry);
              tBE = true;
              tStatus = "NO_RECLAIM_STOP_AT_ENTRY";
            }
            if (!tTrail && c.low <= tTrailTrig) {
              tTrail = true;
              tStatus = "TRAILING";
            }
            if (tTrail && sellersPush && c.high + OF_STOP_BUF_ATR * atrV < tStop) {
              tStop = c.high + OF_STOP_BUF_ATR * atrV;
              tStatus = "TRAILING";
            }
          }
        }
        if (closed) {
          const exitPx = tStatus === "TARGET_HIT" ? tTarget : tStop;
          exitR = tRisk > 0 ? (tSide * (exitPx - tEntry)) / tRisk : null;
          exitSide = tSide;
          const outcome =
            tStatus === "TARGET_HIT"
              ? `✔ 目标 ${exitR !== null ? "+" + exitR.toFixed(1) : ""}R`
              : tStatus === "TRAIL_STOP"
                ? `✔ 跟踪 ${exitR !== null ? "+" + exitR.toFixed(1) : ""}R`
                : tStatus === "STOPPED"
                  ? `✕ 止损 ${exitR !== null ? exitR.toFixed(1) : ""}R`
                  : `● 保本 ${exitR !== null ? exitR.toFixed(1) : ""}R`;
          lastOutcome = outcome;
          markers.push({
            time: t,
            position: exitSide === 1 ? "aboveBar" : "belowBar",
            color:
              tStatus === "TARGET_HIT" || tStatus === "TRAIL_STOP"
                ? OF_GREEN
                : tStatus === "STOPPED"
                  ? OF_RED
                  : OF_GOLD,
            shape: "circle",
            text: outcome,
          });
          if (lastEntryInfo) lastEntryInfo.closeBar = i;
          tSide = 0;
          if (tStatus === "STOPPED") lossStreak += 1;
          else if (tStatus === "TARGET_HIT" || tStatus === "TRAIL_STOP") lossStreak = 0;
        }
      }

      const rulesOk = tradesToday < OF_MAX_TRADES && lossStreak < OF_MAX_LOSS_STREAK && tSide === 0 && partOk;
      const canLong = rulesOk && bias === 1;
      const canShort = rulesOk && bias === -1;

      // 2) Long setup: absorption of sellers in discount, second failure higher.
      if (lState > 0 && (i - lAbsBar > OF_SETUP_BARS || c.close < lz3 || bias !== 1)) lState = 0;
      if (lState === 0) {
        if (canLong && longLoc && sellerAbsorbed) {
          lAbsLow = c.low;
          lAbsBar = i;
          absLongMark = true;
          if (c.close > c.open) {
            lState = 2;
            lShiftMark = true;
            lShiftClose = c.close;
            lRetest = null;
          } else {
            lState = 1;
          }
        }
      } else if (lState === 1) {
        if (c.low < lAbsLow && sellerAbsorbed && longLoc) {
          lAbsLow = c.low;
          lAbsBar = i;
          absLongMark = true;
        } else if (c.close < lAbsLow) {
          lState = 0;
        } else if (c.close > c.open) {
          lState = 2;
          lShiftMark = true;
          lShiftClose = c.close;
          lRetest = null;
        }
      } else if (lState === 2) {
        if (lRetest === null || c.low < lRetest) lRetestBar = i;
        lRetest = lRetest === null ? c.low : Math.min(lRetest, c.low);
        if (lRetest <= lAbsLow) {
          lState = 0;
        } else if (buyersPush && lRetest < lShiftClose && canLong) {
          const stopLvl = lRetest - OF_STOP_BUF_ATR * atrV;
          tSide = 1;
          tEntry = c.close;
          tStop = stopLvl;
          tRisk = c.close - stopLvl;
          const { target, src } = targetFor(1, c.close, tRisk, lH, vaPoc);
          tTarget = target;
          tTargetSrc = src;
          tTrail = false;
          tTrailTrig = (() => {
            let trig = c.close + Math.min(OF_TRAIL_START_R * tRisk, 0.75 * Math.abs(target - c.close));
            if (vaPoc !== null && vaPoc > c.close && target > vaPoc && vaPoc < trig) trig = vaPoc;
            return trig;
          })();
          tReclaim = vaLow;
          tReclaimed = vaLow === null || c.close > vaLow;
          tBE = false;
          tBar = i;
          tStatus = "ACTIVE";
          tradesToday += 1;
          openedLong = true;
          lState = 0;
          lastEntryInfo = {
            side: 1,
            entryBar: i,
            absBar: lAbsBar,
            absLevel: lAbsLow,
            retestBar: lRetestBar,
            retest: lRetest,
            atr: atrV,
            closeBar: null,
          };
          stopByBar.clear();
          targetByBar.clear();
          entryByBar.clear();
        }
      }

      // 3) Short setup: absorption of buyers in premium, second failure lower.
      if (sState > 0 && (i - sAbsBar > OF_SETUP_BARS || c.close > sz3 || bias !== -1)) sState = 0;
      if (sState === 0) {
        if (canShort && shortLoc && buyerAbsorbed) {
          sAbsHigh = c.high;
          sAbsBar = i;
          absShortMark = true;
          if (c.close < c.open) {
            sState = 2;
            sShiftMark = true;
            sShiftClose = c.close;
            sRetest = null;
          } else {
            sState = 1;
          }
        }
      } else if (sState === 1) {
        if (c.high > sAbsHigh && buyerAbsorbed && shortLoc) {
          sAbsHigh = c.high;
          sAbsBar = i;
          absShortMark = true;
        } else if (c.close > sAbsHigh) {
          sState = 0;
        } else if (c.close < c.open) {
          sState = 2;
          sShiftMark = true;
          sShiftClose = c.close;
          sRetest = null;
        }
      } else if (sState === 2) {
        if (sRetest === null || c.high > sRetest) sRetestBar = i;
        sRetest = sRetest === null ? c.high : Math.max(sRetest, c.high);
        if (sRetest >= sAbsHigh) {
          sState = 0;
        } else if (sellersPush && sRetest > sShiftClose && canShort && !openedLong) {
          const stopLvl = sRetest + OF_STOP_BUF_ATR * atrV;
          tSide = -1;
          tEntry = c.close;
          tStop = stopLvl;
          tRisk = stopLvl - c.close;
          const { target, src } = targetFor(-1, c.close, tRisk, sL, vaPoc);
          tTarget = target;
          tTargetSrc = src;
          tTrail = false;
          tTrailTrig = (() => {
            let trig = c.close - Math.min(OF_TRAIL_START_R * tRisk, 0.75 * Math.abs(target - c.close));
            if (vaPoc !== null && vaPoc < c.close && target < vaPoc && vaPoc > trig) trig = vaPoc;
            return trig;
          })();
          tReclaim = vaHigh;
          tReclaimed = vaHigh === null || c.close < vaHigh;
          tBE = false;
          tBar = i;
          tStatus = "ACTIVE";
          tradesToday += 1;
          openedShort = true;
          sState = 0;
          lastEntryInfo = {
            side: -1,
            entryBar: i,
            absBar: sAbsBar,
            absLevel: sAbsHigh,
            retestBar: sRetestBar,
            retest: sRetest,
            atr: atrV,
            closeBar: null,
          };
          stopByBar.clear();
          targetByBar.clear();
          entryByBar.clear();
        }
      }

      // Markers for this bar's events.
      if (absLongMark) {
        markers.push({
          time: t,
          position: "belowBar",
          color: OF_CYAN,
          shape: "circle",
          text: `吸收 AQ${Math.round(aqLong)}`,
        });
      }
      if (absShortMark) {
        markers.push({
          time: t,
          position: "aboveBar",
          color: OF_MAGENTA,
          shape: "circle",
          text: `吸收 AQ${Math.round(aqShort)}`,
        });
      }
      if (lShiftMark) {
        markers.push({ time: t, position: "belowBar", color: OF_CYAN, shape: "circle", text: "转向" });
      }
      if (sShiftMark) {
        markers.push({ time: t, position: "aboveBar", color: OF_MAGENTA, shape: "circle", text: "转向" });
      }
      if (openedLong) {
        markers.push({ time: t, position: "belowBar", color: OF_GREEN, shape: "arrowUp", text: "做多" });
      }
      if (openedShort) {
        markers.push({ time: t, position: "aboveBar", color: OF_RED, shape: "arrowDown", text: "做空" });
      }

      // Impulse candles: aggression WITH a result (not on entry/absorption bars).
      const body = Math.abs(c.close - c.open);
      const impUp =
        c.close > c.open &&
        range > 0 &&
        body >= OF_IMP_BODY_ATR * atrV &&
        body / range >= 0.6 &&
        closePos >= 70 &&
        (relVol === null || relVol >= 1.2);
      const impDn =
        c.close < c.open &&
        range > 0 &&
        body >= OF_IMP_BODY_ATR * atrV &&
        body / range >= 0.6 &&
        closePos <= 30 &&
        (relVol === null || relVol >= 1.2);
      if ((impUp || impDn) && !openedLong && !openedShort && !absLongMark && !absShortMark) {
        markers.push({
          time: t,
          position: impUp ? "belowBar" : "aboveBar",
          color: impUp ? OF_GREEN : OF_RED,
          shape: "circle",
          text: "脉冲",
        });
      }

      // Record the live stop / target / entry for the open trade.
      if (tSide !== 0) {
        stopByBar.set(i, tStop);
        targetByBar.set(i, tTarget);
        entryByBar.set(i, tEntry);
      }
    }
  }

  // ── Assemble boxes ───────────────────────────────────────────
  const boxes: OrderFlowBox[] = [];
  const boxToTime = lastTime + 16 * spacing;
  if (finalLongZoneReady) {
    boxes.push({
      fromTime: times[lHBar]!,
      toTime: boxToTime,
      top: lz1AtEnd(lH, lL),
      bottom: lz3AtEnd(lH, lL),
      fill: "rgba(0, 255, 156, 0.14)",
      stroke: "rgba(0, 255, 156, 0.45)",
    });
  }
  if (finalShortZoneReady) {
    boxes.push({
      fromTime: times[sHBar]!,
      toTime: boxToTime,
      top: sz3AtEnd(sH, sL),
      bottom: sz1AtEnd(sH, sL),
      fill: "rgba(255, 45, 85, 0.14)",
      stroke: "rgba(255, 45, 85, 0.45)",
    });
  }
  // Trapped-traders zone + risk/reward boxes for the most recent trade.
  if (lastEntryInfo) {
    const e = lastEntryInfo;
    const zp = e.atr * 0.1;
    const lx = Math.max(e.absBar - 1, 0);
    const endBar = Math.min(e.entryBar + 4, n - 1);
    if (e.side === 1) {
      boxes.push({
        fromTime: times[lx]!,
        toTime: times[endBar]!,
        top: Math.max(e.retest, e.absLevel + 0.15 * e.atr) + zp,
        bottom: e.absLevel - zp,
        fill: "rgba(0, 229, 255, 0.14)",
        stroke: "rgba(0, 229, 255, 0.5)",
      });
    } else {
      boxes.push({
        fromTime: times[lx]!,
        toTime: times[endBar]!,
        top: e.absLevel + zp,
        bottom: Math.min(e.retest, e.absLevel - 0.15 * e.atr) - zp,
        fill: "rgba(255, 43, 214, 0.14)",
        stroke: "rgba(255, 43, 214, 0.5)",
      });
    }
    const closeBar = e.closeBar ?? n - 1;
    const entryVal = entryByBar.get(e.entryBar);
    const targetVal = targetByBar.get(e.entryBar);
    const stopVal = stopByBar.get(e.entryBar);
    if (entryVal !== undefined && stopVal !== undefined) {
      boxes.push({
        fromTime: times[e.entryBar]!,
        toTime: times[closeBar]!,
        top: Math.max(entryVal, stopVal),
        bottom: Math.min(entryVal, stopVal),
        fill: "rgba(255, 45, 85, 0.15)",
        stroke: "rgba(255, 45, 85, 0.4)",
      });
    }
    if (entryVal !== undefined && targetVal !== undefined) {
      boxes.push({
        fromTime: times[e.entryBar]!,
        toTime: times[closeBar]!,
        top: Math.max(entryVal, targetVal),
        bottom: Math.min(entryVal, targetVal),
        fill: "rgba(0, 255, 156, 0.13)",
        stroke: "rgba(0, 255, 156, 0.4)",
      });
    }
  }
  // Inefficiency corridors (most recent 5).
  for (const g of gaps.slice(-OF_MAX_INEFF)) {
    const toT = g.filledBar !== null ? times[g.filledBar]! : lastTime;
    boxes.push({
      fromTime: times[Math.max(0, g.t0 - 2)]!,
      toTime: toT,
      top: g.top,
      bottom: g.bot,
      fill: g.dir === 1 ? "rgba(0, 229, 255, 0.12)" : "rgba(168, 85, 247, 0.12)",
      stroke: g.dir === 1 ? "rgba(0, 229, 255, 0.35)" : "rgba(168, 85, 247, 0.35)",
      dashed: true,
    });
  }
  // Resting liquidity: swing highs (BSL, red) / swing lows (SSL, green).
  for (const l of [...bslLevels, ...sslLevels]) {
    boxes.push({
      fromTime: times[l.bar]!,
      toTime: l.sweptBar !== null ? times[l.sweptBar]! : lastTime,
      top: l.price + l.half,
      bottom: l.price - l.half,
      fill: l.isHigh ? "rgba(255, 45, 85, 0.18)" : "rgba(0, 255, 156, 0.18)",
      stroke: l.isHigh ? "rgba(255, 45, 85, 0.4)" : "rgba(0, 255, 156, 0.4)",
      dashed: l.swept,
    });
  }

  // Zone volume (THIN / NORMAL / UNTESTED) from the developing profile.
  const zoneVolume = (zTop: number, zBot: number): string => {
    if (!Number.isFinite(devStep) || !Number.isFinite(devMinK) || finalDevMaxV <= 0) return "UNKNOWN";
    const z0 = Math.floor(zBot / devStep);
    const z1 = Math.floor(zTop / devStep);
    if (z1 < devMinK || z0 > devMaxK) return "UNTESTED";
    let sumV = 0;
    for (let k = Math.max(z0, devMinK); k <= Math.min(z1, devMaxK); k++) sumV += devMap.get(k) ?? 0;
    const rows = Math.min(z1, devMaxK) - Math.max(z0, devMinK) + 1;
    return rows > 0 && sumV / rows < finalDevMaxV * 0.3 ? "THIN" : "NORMAL";
  };
  const lastVaPoc = vaPocPts.length > 0 ? vaPocPts[vaPocPts.length - 1]!.value : null;
  const lastVaHigh = vaHighPts.length > 0 ? vaHighPts[vaHighPts.length - 1]!.value : null;
  const lastVaLow = vaLowPts.length > 0 ? vaLowPts[vaLowPts.length - 1]!.value : null;
  const lastBias = biasArr[n - 1]!;
  const lastC = candles[n - 1]!;
  const lastValuePos =
    lastVaLow === null
      ? "UNKNOWN"
      : lastC.close < lastVaLow
        ? "DISCOUNT"
        : lastC.close > lastVaHigh!
          ? "PREMIUM"
          : "INSIDE_VALUE";
  const lastDeltaPct = (() => {
    const v = lastC.volume ?? 0;
    if (v <= 0) return null;
    return lastC.close > lastC.open ? 100 : lastC.close < lastC.open ? -100 : 0;
  })();
  const lastRelVol = (() => {
    const avg = volAvgAt(n - 1);
    const v = lastC.volume ?? 0;
    return avg !== null && avg > 0 ? v / avg : null;
  })();
  const stateLabel =
    tSide !== 0
      ? `持仓 ${tSide === 1 ? "做多" : "做空"} · ${tStatus === "NONE" ? "持仓中" : tStatus === "TRAILING" ? "跟踪中" : tStatus === "BREAKEVEN" ? "保本" : tStatus}`
      : tradesToday >= OF_MAX_TRADES
        ? "今日已满"
        : lossStreak >= OF_MAX_LOSS_STREAK
          ? "今日已停"
          : lState === 2 || sState === 2
            ? "待二次失败"
            : lState === 1 || sState === 1
              ? "吸收中"
              : "观望";
  const trade: OrderFlowTrade | null =
    tSide !== 0
      ? {
          side: tSide as 1 | -1,
          status: tStatus,
          entry: tEntry,
          stop: tStop,
          target: tTarget,
          targetSource: tTargetSrc,
          risk: tRisk,
          entryTime: times[tBar]!,
          exitR: null,
        }
      : null;

  markers.sort((a, b) => a.time - b.time);
  const recentMarkers = markers.slice(-OF_MAX_MARKERS);

  return {
    vaHigh: vaHighPts,
    vaLow: vaLowPts,
    vaPoc: vaPocPts,
    longZoneMid: longZoneMidPts,
    shortZoneMid: shortZoneMidPts,
    stopLine: [...stopByBar.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([idx, value]) => ({ time: times[idx]!, value })),
    targetLine: [...targetByBar.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([idx, value]) => ({ time: times[idx]!, value })),
    entryLine: [...entryByBar.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([idx, value]) => ({ time: times[idx]!, value })),
    markers: recentMarkers,
    boxes,
    hud: {
      bias: lastBias,
      valuePos: lastValuePos,
      longState: lState === 2 ? "FIRST_SHIFT" : lState === 1 ? "ABSORPTION" : "IDLE",
      shortState: sState === 2 ? "FIRST_SHIFT" : sState === 1 ? "ABSORPTION" : "IDLE",
      stateLabel,
      deltaPct: lastDeltaPct,
      relVol: lastRelVol,
      hasVolume,
      tradesToday,
      lossStreak,
      trade,
      lastOutcome,
      vaPoc: lastVaPoc,
      vaHigh: lastVaHigh,
      vaLow: lastVaLow,
      longZoneVol: finalLongZoneReady ? zoneVolume(Math.max(lz1AtEnd(lH, lL), lz3AtEnd(lH, lL)), Math.min(lz1AtEnd(lH, lL), lz3AtEnd(lH, lL))) : "UNKNOWN",
      shortZoneVol: finalShortZoneReady ? zoneVolume(Math.max(sz3AtEnd(sH, sL), sz1AtEnd(sH, sL)), Math.min(sz3AtEnd(sH, sL), sz1AtEnd(sH, sL))) : "UNKNOWN",
    },
  };
}

// Fib levels at the loop's end state (used for the final zone boxes / HUD).
function lz1AtEnd(lH: number, lL: number): number {
  return lH - OF_FIB_A * (lH - lL);
}
function lz3AtEnd(lH: number, lL: number): number {
  return lH - OF_FIB_C * (lH - lL);
}
function sz1AtEnd(sH: number, sL: number): number {
  return sL + OF_FIB_A * (sH - sL);
}
function sz3AtEnd(sH: number, sL: number): number {
  return sL + OF_FIB_C * (sH - sL);
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
  | "QUANTEDGE"
  | "ORDERFLOW";

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
    label: "简单移动平均线",
    pane: "overlay",
    defaultParams: { period: 20 },
    color: "#f0b90b",
  },
  {
    type: "EMA",
    label: "指数移动平均线",
    pane: "overlay",
    defaultParams: { period: 20 },
    color: "#e377c2",
  },
  {
    type: "RSI",
    label: "相对强弱指数",
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
    label: "布林带",
    pane: "overlay",
    defaultParams: { period: 20, stdDev: 2 },
    color: "#26a69a",
  },
  {
    type: "ATR",
    label: "平均真实波幅",
    pane: "below",
    defaultParams: { period: 14 },
    color: "#ff7043",
  },
  {
    type: "STOCH",
    label: "随机指标",
    pane: "below",
    defaultParams: { kPeriod: 14, dPeriod: 3 },
    color: "#ab47bc",
  },
  {
    type: "VWAP",
    label: "成交量加权均价",
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
  {
    type: "ORDERFLOW",
    label: "订单流",
    pane: "overlay",
    defaultParams: {},
    color: "#00e5ff",
  },
];
