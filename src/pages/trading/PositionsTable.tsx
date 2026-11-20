import { useState } from "react";
import { toast } from "../../services/toast.ts";
import { X, Scissors } from "lucide-react";
import { formatNumber, formatCurrency, formatDate, cn, pnlClass } from "../../lib/utils.ts";

interface PositionRow {
  id: string;
  symbolName: string;
  side: "LONG" | "SHORT" | string;
  quantity: number;
  entryPrice: number;
  currentPrice?: number | null;
  unrealizedPnl: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  openedAt: string | Date;
  /** Exchange-reported liquidation price (Hyperliquid). */
  liquidationPx?: number | null;
  /** Funding since the position opened, USD, as reported by the exchange. */
  fundingSinceOpen?: number;
  marginMode?: "cross" | "isolated";
  leverage?: number;
}

export function PositionsTable({
  positions,
  onClose,
  onModify,
  onPartialClose,
  onSelectSymbol,
}: {
  positions: PositionRow[];
  onClose: (id: string) => void;
  onModify?: (p: PositionRow) => void;
  onPartialClose?: (id: string, quantity: number) => void;
  onSelectSymbol?: (symbolName: string) => void;
}) {
  const [partialCloseId, setPartialCloseId] = useState<string | null>(null);
  const [partialQty, setPartialQty] = useState("");

  // Optional exchange detail: columns appear only when the adapter supplies it.
  const showLiq = positions.some((p) => p.liquidationPx !== undefined);
  const showFunding = positions.some((p) => p.fundingSinceOpen !== undefined);
  const showMargin = positions.some((p) => p.marginMode !== undefined);

  if (positions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
        暂无持仓
      </div>
    );
  }

  const handlePartialSubmit = (positionId: string, maxQty: number) => {
    const qty = parseFloat(partialQty);
    // Explain the rejection instead of swallowing the click: an out-of-range
    // value previously looked identical to a successful partial close.
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.warning("数量无效", "请输入要平仓的正数数量");
      return;
    }
    if (qty >= maxQty) {
      toast.warning(
        "数量过大",
        `请输入小于 ${maxQty} 的数量——全部平仓请用「平仓」`,
      );
      return;
    }
    onPartialClose?.(positionId, qty);
    setPartialCloseId(null);
    setPartialQty("");
  };

  return (
    <table className="w-full text-[11px]">
      <thead className="sticky top-0 bg-card z-10">
        <tr>
          <th>品种</th>
          <th>方向</th>
          <th>数量</th>
          <th>入场价</th>
          <th>现价</th>
          <th>盈亏</th>
          {showLiq && <th>强平价</th>}
          {showFunding && <th title="持仓开仓以来的资金费（Hyperliquid 上报）">资金费</th>}
          {showMargin && <th>保证金</th>}
          <th>止损</th>
          <th>止盈</th>
          <th>时间</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => (
          <tr
            key={p.id}
            className={cn("hover:bg-secondary/30", onSelectSymbol ? "cursor-pointer" : undefined)}
            onClick={() => onSelectSymbol?.(p.symbolName)}
            onKeyDown={(e) => {
              if (!onSelectSymbol) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectSymbol(p.symbolName);
              }
            }}
            tabIndex={onSelectSymbol ? 0 : undefined}
          >
            <td className="font-semibold">{p.symbolName}</td>
            <td className={p.side === "LONG" ? "text-buy" : "text-sell"}>{p.side === "LONG" ? "做多" : p.side === "SHORT" ? "做空" : p.side}</td>
            <td className="font-mono">{p.quantity}</td>
            <td className="font-mono">{formatNumber(p.entryPrice, 5)}</td>
            <td className="font-mono">{p.currentPrice ? formatNumber(p.currentPrice, 5) : "--"}</td>
            <td className={cn("font-mono font-semibold", pnlClass(p.unrealizedPnl))}>
              {p.unrealizedPnl >= 0 ? "+" : ""}
              {formatCurrency(p.unrealizedPnl)}
            </td>
            {showLiq && (
              <td className="font-mono text-warning" data-testid="liq-price">
                {p.liquidationPx ? formatNumber(p.liquidationPx, 5) : "--"}
              </td>
            )}
            {showFunding && (
              <td className="font-mono" data-testid="funding">
                {p.fundingSinceOpen !== undefined ? formatCurrency(p.fundingSinceOpen) : "--"}
              </td>
            )}
            {showMargin && (
              <td className="capitalize" data-testid="margin-mode">
                {p.marginMode ?? "--"}
                {p.leverage ? ` ${p.leverage}x` : ""}
              </td>
            )}
            <td className="font-mono text-sell">
              {p.stopLoss ? formatNumber(p.stopLoss, 5) : "--"}
            </td>
            <td className="font-mono text-buy">
              {p.takeProfit ? formatNumber(p.takeProfit, 5) : "--"}
            </td>
            <td className="text-muted-foreground">{formatDate(p.openedAt)}</td>
            <td>
              {partialCloseId === p.id ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={partialQty}
                    onChange={(e) => setPartialQty(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    placeholder={`最大 ${p.quantity}`}
                    min={0}
                    max={p.quantity}
                    step="any"
                    className="w-16 h-5 text-[10px] rounded border border-border bg-background px-1 font-mono"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handlePartialSubmit(p.id, p.quantity);
                      if (e.key === "Escape") {
                        setPartialCloseId(null);
                        setPartialQty("");
                      }
                    }}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePartialSubmit(p.id, p.quantity);
                    }}
                    className="px-1 py-0.5 text-[9px] rounded bg-warning/20 text-warning hover:bg-warning/30"
                  >
                    确认
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPartialCloseId(null);
                      setPartialQty("");
                    }}
                    className="px-1 py-0.5 text-[9px] rounded bg-secondary text-muted-foreground hover:bg-secondary/80"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-1">
                  {onModify && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onModify(p);
                      }}
                      className="px-1.5 py-0.5 text-[10px] rounded bg-accent/20 text-accent hover:bg-accent/30"
                    >
                      修改
                    </button>
                  )}
                  {onPartialClose && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPartialCloseId(p.id);
                        setPartialQty("");
                      }}
                      className="px-1.5 py-0.5 text-[10px] rounded bg-warning/20 text-warning hover:bg-warning/30 flex items-center gap-0.5"
                      title="部分平仓"
                    >
                      <Scissors className="h-2.5 w-2.5" /> 部分
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose(p.id);
                    }}
                    className="px-1.5 py-0.5 text-[10px] rounded bg-destructive/20 text-destructive hover:bg-destructive/30"
                  >
                    平仓
                  </button>
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
