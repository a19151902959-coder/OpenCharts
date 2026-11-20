import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  Coordinate,
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import type { QuantEdgeFvgBox } from "../../indicators.ts";

// ── Quant-Edge FVG boxes ──────────────────────────────────────────
// Renders the Pine FVG boxes (bull: low > high[2]; bear: high < low[2]) as
// translucent rectangles on the candle pane. Follows the same
// ISeriesPrimitive pattern as the tooltip primitive: the pane view converts
// times/prices to coordinates on update(), the renderer draws them.
//
// Cleanup is guarded: detached() only clears references, and the owner
// (useIndicators) wraps attach/detach in try/catch — a box-primitive failure
// must never throw out of chart teardown (see the removeChild fix).

interface FvgBoxViewData {
  x1: Coordinate;
  x2: Coordinate;
  top: Coordinate;
  bottom: Coordinate;
  bullish: boolean;
}

class FvgBoxesPaneRenderer implements ISeriesPrimitivePaneRenderer {
  _data: FvgBoxViewData[];

  constructor(data: FvgBoxViewData[]) {
    this._data = data;
  }

  draw() {}

  drawBackground(target: CanvasRenderingTarget2D) {
    if (this._data.length === 0) return;
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      ctx.scale(scope.horizontalPixelRatio, scope.verticalPixelRatio);
      for (const box of this._data) {
        const width = box.x2 - box.x1;
        const height = box.bottom - box.top;
        if (width <= 0 || height <= 0) continue;
        // Pine: bgcolor green/red with 82% transparency (alpha ≈ 0.18).
        ctx.fillStyle = box.bullish ? "rgba(0, 200, 83, 0.18)" : "rgba(255, 23, 68, 0.18)";
        ctx.fillRect(box.x1, box.top, width, height);
        ctx.strokeStyle = box.bullish ? "rgba(0, 200, 83, 0.5)" : "rgba(255, 23, 68, 0.5)";
        ctx.lineWidth = 1;
        ctx.strokeRect(box.x1, box.top, width, height);
      }
    });
  }
}

class FvgBoxesPaneView implements ISeriesPrimitivePaneView {
  _source: FvgBoxesPrimitive;
  _data: FvgBoxViewData[] = [];

  constructor(source: FvgBoxesPrimitive) {
    this._source = source;
  }

  update() {
    const chart = this._source.chart();
    const series = this._source.series();
    if (!chart || !series) {
      this._data = [];
      return;
    }
    const timeScale = chart.timeScale();
    this._data = this._source.boxes
      .map((box) => {
        const x1 = timeScale.timeToCoordinate(box.fromTime as Time) as Coordinate | null;
        const x2 = timeScale.timeToCoordinate(box.toTime as Time) as Coordinate | null;
        const top = series.priceToCoordinate(box.top) as Coordinate | null;
        const bottom = series.priceToCoordinate(box.bottom) as Coordinate | null;
        if (x1 === null || x2 === null || top === null || bottom === null) return null;
        return { x1, x2, top, bottom, bullish: box.bullish };
      })
      .filter((b): b is FvgBoxViewData => b !== null);
  }

  renderer() {
    return new FvgBoxesPaneRenderer(this._data);
  }
}

export class FvgBoxesPrimitive implements ISeriesPrimitive<Time> {
  boxes: QuantEdgeFvgBox[];
  _paneViews: FvgBoxesPaneView[];
  _attachedParams: SeriesAttachedParameter<Time> | undefined;

  constructor(boxes: QuantEdgeFvgBox[]) {
    this.boxes = boxes;
    this._paneViews = [new FvgBoxesPaneView(this)];
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._attachedParams = param;
    this.updateAllViews();
  }

  detached(): void {
    this._attachedParams = undefined;
  }

  paneViews() {
    return this._paneViews;
  }

  updateAllViews() {
    this._paneViews.forEach((pw) => pw.update());
  }

  chart() {
    return this._attachedParams?.chart;
  }

  series() {
    return this._attachedParams?.series;
  }
}
