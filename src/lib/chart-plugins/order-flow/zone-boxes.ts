import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  Coordinate,
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import type { OrderFlowBox } from "../../indicators.ts";

// ── Order Flow zone boxes ───────────────────────────────────────
// Renders Order Flow boxes (discount/premium Fib zones, trapped-trader
// zones, risk/reward boxes, inefficiency corridors, resting-liquidity
// zones) as translucent rectangles on the candle pane. Follows the same
// ISeriesPrimitive pattern as the FVG-boxes primitive: the pane view
// converts times/prices to coordinates on update(), the renderer draws
// them. Colours come from the box itself (OrderFlowBox.fill/stroke),
// so one primitive serves every box kind.
//
// Cleanup is guarded: detached() only clears references, and the owner
// (useIndicators) wraps attach/detach in try/catch — a box-primitive
// failure must never throw out of chart teardown (see the removeChild fix).

interface ZoneBoxViewData {
  x1: Coordinate;
  x2: Coordinate;
  top: Coordinate;
  bottom: Coordinate;
  fill: string;
  stroke: string;
  dashed: boolean;
}

class ZoneBoxesPaneRenderer implements ISeriesPrimitivePaneRenderer {
  _data: ZoneBoxViewData[];

  constructor(data: ZoneBoxViewData[]) {
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
        ctx.fillStyle = box.fill;
        ctx.fillRect(box.x1, box.top, width, height);
        ctx.strokeStyle = box.stroke;
        ctx.lineWidth = 1;
        ctx.setLineDash(box.dashed ? [4, 3] : []);
        ctx.strokeRect(box.x1, box.top, width, height);
        ctx.setLineDash([]);
      }
    });
  }
}

class ZoneBoxesPaneView implements ISeriesPrimitivePaneView {
  _source: ZoneBoxesPrimitive;
  _data: ZoneBoxViewData[] = [];

  constructor(source: ZoneBoxesPrimitive) {
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
        return { x1, x2, top, bottom, fill: box.fill, stroke: box.stroke, dashed: box.dashed ?? false };
      })
      .filter((b): b is ZoneBoxViewData => b !== null);
  }

  renderer() {
    return new ZoneBoxesPaneRenderer(this._data);
  }
}

export class ZoneBoxesPrimitive implements ISeriesPrimitive<Time> {
  boxes: OrderFlowBox[];
  _paneViews: ZoneBoxesPaneView[];
  _attachedParams: SeriesAttachedParameter<Time> | undefined;

  constructor(boxes: OrderFlowBox[]) {
    this.boxes = boxes;
    this._paneViews = [new ZoneBoxesPaneView(this)];
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
