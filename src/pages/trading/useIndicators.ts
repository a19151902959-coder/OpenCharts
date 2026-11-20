import { useEffect, useRef } from "react";
import type { IChartApi, ISeriesApi, CandlestickData, Time } from "lightweight-charts";
import { LineStyle } from "lightweight-charts";
import {
  sma,
  ema,
  rsi,
  macd,
  bollingerBands,
  atr,
  stochastic,
  vwap,
  quantEdge,
  INDICATOR_REGISTRY,
  type IndicatorType,
} from "../../lib/indicators.ts";
import { FvgBoxesPrimitive } from "../../lib/chart-plugins/fvg-boxes/fvg-boxes.ts";
import { toIndicatorCandles } from "./utils.ts";
import { CHART_COLORS } from "./constants.ts";

export function useIndicators(
  chartRef: React.RefObject<IChartApi | null>,
  candleSeriesRef: React.RefObject<ISeriesApi<"Candlestick"> | null>,
  chartData: CandlestickData<Time>[],
  activeIndicators: IndicatorType[],
  isDark: boolean,
): void {
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<"Line"> | ISeriesApi<"Histogram">>>(
    new Map(),
  );
  // Quant-Edge FVG boxes are drawn by a series primitive, not a series, so
  // they need their own ref. Attach/detach is always guarded: a primitive
  // failure must never throw out of chart teardown (removeChild fix).
  const fvgPrimitiveRef = useRef<FvgBoxesPrimitive | null>(null);
  const colors = isDark ? CHART_COLORS.dark : CHART_COLORS.light;

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || chartData.length === 0) return;

    const chart = chartRef.current;
    // Capture the series for the cleanup closure (lint: refs may change by
    // the time cleanup runs).
    const candleSeries = candleSeriesRef.current;
    const indCandles = toIndicatorCandles(chartData);

    // Remove old indicator series
    for (const [_key, series] of indicatorSeriesRef.current) {
      try {
        chart.removeSeries(series);
      } catch {
        /* already removed */
      }
    }
    indicatorSeriesRef.current.clear();

    // Detach the old FVG primitive (if any) before re-attaching a fresh one.
    if (fvgPrimitiveRef.current) {
      try {
        candleSeries.detachPrimitive(fvgPrimitiveRef.current);
      } catch {
        /* already detached */
      }
      fvgPrimitiveRef.current = null;
    }

    for (const type of activeIndicators) {
      const config = INDICATOR_REGISTRY.find((r) => r.type === type);
      if (!config) continue;

      switch (type) {
        case "SMA": {
          const data = sma(indCandles, config.defaultParams.period!);
          const s = chart.addLineSeries({
            color: config.color,
            lineWidth: 1,
            priceScaleId: "right",
          });
          s.setData(data.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("SMA", s);
          break;
        }
        case "EMA": {
          const data = ema(indCandles, config.defaultParams.period!);
          const s = chart.addLineSeries({
            color: config.color,
            lineWidth: 1,
            priceScaleId: "right",
          });
          s.setData(data.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("EMA", s);
          break;
        }
        case "RSI": {
          const data = rsi(indCandles, config.defaultParams.period);
          const s = chart.addLineSeries({ color: config.color, lineWidth: 1, priceScaleId: "rsi" });
          s.setData(data.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("RSI", s);
          const refHigh = chart.addLineSeries({
            color: "#555",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            priceScaleId: "rsi",
          });
          refHigh.setData(data.map((p) => ({ time: p.time as Time, value: 70 })));
          indicatorSeriesRef.current.set("RSI-70", refHigh);
          const refLow = chart.addLineSeries({
            color: "#555",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            priceScaleId: "rsi",
          });
          refLow.setData(data.map((p) => ({ time: p.time as Time, value: 30 })));
          indicatorSeriesRef.current.set("RSI-30", refLow);
          break;
        }
        case "MACD": {
          const data = macd(
            indCandles,
            config.defaultParams.fast,
            config.defaultParams.slow,
            config.defaultParams.signal,
          );
          const mLine = chart.addLineSeries({
            color: "#2196f3",
            lineWidth: 1,
            priceScaleId: "macd",
          });
          mLine.setData(data.macd.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("MACD-line", mLine);
          const sLine = chart.addLineSeries({
            color: "#ff9800",
            lineWidth: 1,
            priceScaleId: "macd",
          });
          sLine.setData(data.signal.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("MACD-signal", sLine);
          const histo = chart.addHistogramSeries({ priceScaleId: "macd" });
          histo.setData(
            data.histogram.map((p) => ({
              time: p.time as Time,
              value: p.value,
              color: p.value >= 0 ? colors.up + "99" : colors.down + "99",
            })),
          );
          indicatorSeriesRef.current.set("MACD-hist", histo);
          break;
        }
        case "BOLL": {
          const data = bollingerBands(
            indCandles,
            config.defaultParams.period,
            config.defaultParams.stdDev,
          );
          const upper = chart.addLineSeries({
            color: config.color + "80",
            lineWidth: 1,
            priceScaleId: "right",
          });
          upper.setData(data.upper.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("BOLL-upper", upper);
          const mid = chart.addLineSeries({
            color: config.color,
            lineWidth: 1,
            priceScaleId: "right",
          });
          mid.setData(data.middle.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("BOLL-mid", mid);
          const lower = chart.addLineSeries({
            color: config.color + "80",
            lineWidth: 1,
            priceScaleId: "right",
          });
          lower.setData(data.lower.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("BOLL-lower", lower);
          break;
        }
        case "ATR": {
          const data = atr(indCandles, config.defaultParams.period);
          const s = chart.addLineSeries({ color: config.color, lineWidth: 1, priceScaleId: "atr" });
          s.setData(data.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("ATR", s);
          break;
        }
        case "STOCH": {
          const data = stochastic(
            indCandles,
            config.defaultParams.kPeriod,
            config.defaultParams.dPeriod,
          );
          const kLine = chart.addLineSeries({
            color: "#ab47bc",
            lineWidth: 1,
            priceScaleId: "stoch",
          });
          kLine.setData(data.k.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("STOCH-K", kLine);
          const dLine = chart.addLineSeries({
            color: "#ff7043",
            lineWidth: 1,
            priceScaleId: "stoch",
          });
          dLine.setData(data.d.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("STOCH-D", dLine);
          break;
        }
        case "VWAP": {
          const data = vwap(indCandles);
          const s = chart.addLineSeries({
            color: config.color,
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            priceScaleId: "right",
          });
          s.setData(data.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("VWAP", s);
          break;
        }
        case "QUANTEDGE": {
          // TypeScript port of Pine "Quant-Edge 终极全能手机版" — see
          // quantEdge() in lib/indicators.ts and docs/quant-edge.pine.
          // Markers (BUY/SELL/BOS/CHoCH/抄底/逃顶) are NOT set here:
          // ChartPanel owns candle-series markers (replay trade markers) and
          // merges Quant-Edge markers into the same setMarkers() call, so
          // setting them here would be clobbered on every replay-effect run.
          const qe = quantEdge(
            indCandles,
            config.defaultParams.swingLen ?? 5,
            config.defaultParams.dcLen ?? 20,
          );

          // EMA200 — Pine colours it lime in a bull trend, orange in a bear
          // trend. A lightweight-charts line has one colour, so it takes the
          // current trend's colour (lime bull / orange bear).
          const ema200 = chart.addLineSeries({
            color: qe.hud.isBull ? "#00ff00" : "#ffa500",
            lineWidth: 2,
            priceScaleId: "right",
          });
          ema200.setData(qe.ema200.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("QUANTEDGE-EMA200", ema200);

          // Donchian 20 channel — Pine plots the [1]-shifted highest/lowest
          // of the prior 20 bars; mid is a dotted grey line (Pine uses
          // circles, which lightweight-charts line series cannot draw).
          const dcUpper = chart.addLineSeries({
            color: "rgba(0, 128, 128, 0.7)",
            lineWidth: 1,
            priceScaleId: "right",
          });
          dcUpper.setData(qe.donchianUpper.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("QUANTEDGE-DC-UPPER", dcUpper);
          const dcLower = chart.addLineSeries({
            color: "rgba(128, 0, 0, 0.7)",
            lineWidth: 1,
            priceScaleId: "right",
          });
          dcLower.setData(qe.donchianLower.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("QUANTEDGE-DC-LOWER", dcLower);
          const dcMid = chart.addLineSeries({
            color: "rgba(128, 128, 128, 0.6)",
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            priceScaleId: "right",
          });
          dcMid.setData(qe.donchianMid.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("QUANTEDGE-DC-MID", dcMid);

          // FVG boxes as a series primitive (most recent 40, Pine cap).
          if (qe.fvgBoxes.length > 0) {
            const primitive = new FvgBoxesPrimitive(qe.fvgBoxes);
            try {
              candleSeries.attachPrimitive(primitive);
              fvgPrimitiveRef.current = primitive;
            } catch {
              /* primitive attach failed — lines above still render */
            }
          }
          break;
        }
      }
    }

    // Detach the FVG primitive on cleanup (effect re-run / unmount) so it
    // never outlives the series it was attached to.
    return () => {
      if (fvgPrimitiveRef.current) {
        try {
          candleSeries.detachPrimitive(fvgPrimitiveRef.current);
        } catch {
          /* already detached */
        }
        fvgPrimitiveRef.current = null;
      }
    };
    // chartRef/candleSeriesRef are stable refs; colors derived from isDark dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndicators, chartData, isDark]);
}
