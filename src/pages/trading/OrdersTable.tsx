import { formatNumber, formatDate } from "../../lib/utils.ts";

interface OrderRow {
  id: string;
  symbolName: string;
  side: "BUY" | "SELL" | string;
  type: string;
  quantity: number;
  price?: number | null;
  stopPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  status: string;
  createdAt: string | Date;
}

export function OrdersTable({
  orders,
  onCancel,
  onModify,
  onSelectSymbol,
}: {
  orders: OrderRow[];
  onCancel: (id: string) => void;
  onModify?: (order: OrderRow) => void;
  onSelectSymbol?: (symbolName: string) => void;
}) {
  if (orders.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
        暂无待成交订单
      </div>
    );
  }

  return (
    <table className="w-full text-[11px]">
      <thead className="sticky top-0 bg-card z-10">
        <tr>
          <th>品种</th>
          <th>方向</th>
          <th>类型</th>
          <th>数量</th>
          <th>价格</th>
          <th>止损</th>
          <th>止盈</th>
          <th>状态</th>
          <th>时间</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr
            key={o.id}
            className={
              onSelectSymbol ? "hover:bg-secondary/30 cursor-pointer" : "hover:bg-secondary/30"
            }
            onClick={() => onSelectSymbol?.(o.symbolName)}
            onKeyDown={(e) => {
              if (!onSelectSymbol) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectSymbol(o.symbolName);
              }
            }}
            tabIndex={onSelectSymbol ? 0 : undefined}
          >
            <td className="font-semibold">{o.symbolName}</td>
            <td className={o.side === "BUY" ? "text-buy" : "text-sell"}>{o.side === "BUY" ? "买入" : o.side === "SELL" ? "卖出" : o.side}</td>
            <td>{{ MARKET: "市价", LIMIT: "限价", STOP: "止损单" }[o.type] ?? o.type}</td>
            <td className="font-mono">{o.quantity}</td>
            <td className="font-mono">
              {o.price
                ? formatNumber(o.price, 5)
                : o.stopPrice
                  ? formatNumber(o.stopPrice, 5)
                  : "市价"}
            </td>
            <td className="font-mono text-sell">
              {o.stopLoss ? formatNumber(o.stopLoss, 5) : "--"}
            </td>
            <td className="font-mono text-buy">
              {o.takeProfit ? formatNumber(o.takeProfit, 5) : "--"}
            </td>
            <td>{{ PENDING: "待成交", NEW: "新建", FILLED: "已成交", PARTIAL: "部分成交", CANCELLED: "已取消", REJECTED: "已拒绝" }[o.status] ?? o.status}</td>
            <td className="text-muted-foreground">{formatDate(o.createdAt)}</td>
            <td>
              <div className="flex gap-1">
                {onModify && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onModify(o);
                    }}
                    className="px-1.5 py-0.5 text-[10px] rounded bg-accent/20 text-accent hover:bg-accent/30"
                  >
                    修改
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel(o.id);
                  }}
                  className="px-1.5 py-0.5 text-[10px] rounded bg-warning/20 text-warning hover:bg-warning/30"
                >
                  取消
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
