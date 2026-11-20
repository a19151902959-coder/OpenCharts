import {
  CandlestickChart,
  Crosshair,
  GripVertical,
  Newspaper,
  Palette,
  RotateCcw,
  Target,
  X,
} from "lucide-react";
import { isHyperliquidMode } from "../../hyperliquid/ui/mode.ts";
import { useState, type ReactNode } from "react";
import { type ChartPreferences, updateChartPreferences } from "../../hooks/useChartPreferences.ts";
import { useDragOffset } from "../../hooks/useDragOffset.ts";
import { cn } from "../../lib/utils.ts";
import { CHART_COLORS, type ChartColors } from "./constants.ts";

// ── Chart Settings dialog ─────────────────────────────────────────────────────
// Opened from the chart context menu. Every control writes straight through
// updateChartPreferences, which broadcasts to all useChartPreferences
// subscribers — the chart applies changes live, no Save button needed.
// The dialog is draggable by its header so it can be moved off the chart area.

export interface ChartSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  prefs: ChartPreferences;
  isDark: boolean;
  activePlugins: string[];
  onTogglePlugin?: (id: string) => void;
  onOpenNewsConfig: () => void;
  /** Whether the account has challenge metrics (controls the Challenge tab note). */
  hasAccount: boolean;
}

type TabId = "appearance" | "colors" | "trading" | "events" | "challenge";

const TABS: Array<{ id: TabId; label: string; icon: ReactNode }> = [
  { id: "appearance", label: "外观", icon: <CandlestickChart className="h-3.5 w-3.5" /> },
  { id: "colors", label: "颜色", icon: <Palette className="h-3.5 w-3.5" /> },
  { id: "trading", label: "交易", icon: <Crosshair className="h-3.5 w-3.5" /> },
  { id: "events", label: "事件", icon: <Newspaper className="h-3.5 w-3.5" /> },
  { id: "challenge", label: "挑战", icon: <Target className="h-3.5 w-3.5" /> },
];

/** Per-tab "恢复默认设置" payloads. Events tab has none (plugin-driven). */
const RESET_BY_TAB: Partial<Record<TabId, Partial<ChartPreferences>>> = {
  appearance: {
    showWicks: true,
    showCandleBorders: true,
    showVolume: true,
    showGrid: true,
    showWatermark: true,
    showCountdown: true,
    showOhlcLegend: true,
  },
  colors: {
    candleUpColor: "",
    candleDownColor: "",
    colorBackground: "",
    colorGrid: "",
    colorScaleText: "",
    colorCrosshair: "",
    colorBidLine: "",
    colorAskLine: "",
    colorPositionLong: "",
    colorPositionShort: "",
    colorOrderLine: "",
    colorTpLine: "",
    colorSlLine: "",
  },
  trading: { showBidLine: true, showAskLine: true, overlayPositionsOnChart: true },
  challenge: {
    challengeOverlay: true,
    challengeDailyLossLine: true,
    challengeMaxDrawdownLine: true,
    challengeProfitTargetLine: true,
  },
};

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  // In-flow flex knob with explicit p-0/border-0 — relying on absolute
  // positioning let the browser's default button padding push the knob off
  // the track, which is what made these render misaligned.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-0 p-0 transition-colors",
        checked ? "bg-primary" : "bg-secondary",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4 py-2", disabled && "opacity-40")}>
      <div className="min-w-0">
        <div className="text-xs text-foreground">{label}</div>
        {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={disabled ? () => undefined : onChange} />
    </div>
  );
}

function ColorSwatch({
  value,
  fallback,
  onChange,
}: {
  value: string;
  fallback: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="color"
      value={value || fallback}
      onChange={(e) => onChange(e.target.value)}
      className="h-6 w-8 cursor-pointer rounded-full border border-border bg-transparent p-0"
    />
  );
}

function ColorRow({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  /** Stored override; empty string means "theme default". */
  value: string;
  fallback: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="text-xs text-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <ColorSwatch value={value} fallback={fallback} onChange={onChange} />
        {value && (
          <button
            onClick={() => onChange("")}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            重置
          </button>
        )}
      </div>
    </div>
  );
}

/** Two swatches on one row (e.g. long/short, up/down). */
function ColorPairRow({
  label,
  a,
  b,
}: {
  label: string;
  a: { value: string; fallback: string; onChange: (v: string) => void };
  b: { value: string; fallback: string; onChange: (v: string) => void };
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="text-xs text-foreground">{label}</div>
      <div className="flex items-center gap-1.5">
        <ColorSwatch {...a} />
        <ColorSwatch {...b} />
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">
      {children}
    </div>
  );
}

function AppearanceTab({ prefs }: { prefs: ChartPreferences }) {
  const set = updateChartPreferences;
  return (
    <div>
      <SectionTitle>K 线</SectionTitle>
      <ToggleRow label="影线" checked={prefs.showWicks} onChange={(v) => set({ showWicks: v })} />
      <ToggleRow
        label="K 线边框"
        checked={prefs.showCandleBorders}
        onChange={(v) => set({ showCandleBorders: v })}
      />
      <SectionTitle>图表元素</SectionTitle>
      <ToggleRow
        label="数量"
        hint="图表底部的成交量柱"
        checked={prefs.showVolume}
        onChange={(v) => set({ showVolume: v })}
      />
      <ToggleRow
        label="网格线"
        checked={prefs.showGrid}
        onChange={(v) => set({ showGrid: v })}
      />
      <ToggleRow
        label="品种水印"
        checked={prefs.showWatermark}
        onChange={(v) => set({ showWatermark: v })}
      />
      <ToggleRow
        label="K 线倒计时"
        hint="距离 K 线收盘的剩余时间"
        checked={prefs.showCountdown}
        onChange={(v) => set({ showCountdown: v })}
      />
      <ToggleRow
        label="OHLC 图例"
        checked={prefs.showOhlcLegend}
        onChange={(v) => set({ showOhlcLegend: v })}
      />
    </div>
  );
}

function ElementColorRows({ prefs, theme }: { prefs: ChartPreferences; theme: ChartColors }) {
  const set = updateChartPreferences;
  return (
    <>
      <SectionTitle>图表元素</SectionTitle>
      <ColorRow
        label="背景"
        value={prefs.colorBackground}
        fallback={theme.background}
        onChange={(v) => set({ colorBackground: v })}
      />
      <ColorRow
        label="网格"
        value={prefs.colorGrid}
        fallback={theme.grid}
        onChange={(v) => set({ colorGrid: v })}
      />
      <ColorRow
        label="坐标轴文字"
        value={prefs.colorScaleText}
        fallback={theme.text}
        onChange={(v) => set({ colorScaleText: v })}
      />
      <ColorRow
        label="十字光标"
        value={prefs.colorCrosshair}
        fallback={theme.crosshair}
        onChange={(v) => set({ colorCrosshair: v })}
      />
    </>
  );
}

function LineColorRows({ prefs, theme }: { prefs: ChartPreferences; theme: ChartColors }) {
  const set = updateChartPreferences;
  return (
    <>
      <SectionTitle>价格与订单线</SectionTitle>
      <ColorRow
        label="买价线"
        value={prefs.colorBidLine}
        fallback={theme.bidLine}
        onChange={(v) => set({ colorBidLine: v })}
      />
      <ColorRow
        label="卖价线"
        value={prefs.colorAskLine}
        fallback={theme.askLine}
        onChange={(v) => set({ colorAskLine: v })}
      />
      <ColorPairRow
        label="持仓"
        a={{
          value: prefs.colorPositionLong,
          fallback: theme.positionLong,
          onChange: (v) => set({ colorPositionLong: v }),
        }}
        b={{
          value: prefs.colorPositionShort,
          fallback: theme.positionShort,
          onChange: (v) => set({ colorPositionShort: v }),
        }}
      />
      <ColorRow
        label="待成交订单"
        value={prefs.colorOrderLine}
        fallback={theme.orderLine}
        onChange={(v) => set({ colorOrderLine: v })}
      />
      <ColorRow
        label="止盈"
        value={prefs.colorTpLine}
        fallback={theme.tpLine}
        onChange={(v) => set({ colorTpLine: v })}
      />
      <ColorRow
        label="止损"
        value={prefs.colorSlLine}
        fallback={theme.slLine}
        onChange={(v) => set({ colorSlLine: v })}
      />
    </>
  );
}

function ColorsTab({ prefs, isDark }: { prefs: ChartPreferences; isDark: boolean }) {
  const theme = isDark ? CHART_COLORS.dark : CHART_COLORS.light;
  const set = updateChartPreferences;
  return (
    <div>
      <ElementColorRows prefs={prefs} theme={theme} />
      <LineColorRows prefs={prefs} theme={theme} />
      <SectionTitle>K 线</SectionTitle>
      <ColorPairRow
        label="K 线实体、边框与影线"
        a={{
          value: prefs.candleUpColor,
          fallback: theme.up,
          onChange: (v) => set({ candleUpColor: v }),
        }}
        b={{
          value: prefs.candleDownColor,
          fallback: theme.down,
          onChange: (v) => set({ candleDownColor: v }),
        }}
      />
    </div>
  );
}

function TradingTab({ prefs }: { prefs: ChartPreferences }) {
  const set = updateChartPreferences;
  return (
    <div>
      <SectionTitle>价格线</SectionTitle>
      <ToggleRow
        label="买价线"
        checked={prefs.showBidLine}
        onChange={(v) => set({ showBidLine: v })}
      />
      <ToggleRow
        label="卖价线"
        checked={prefs.showAskLine}
        onChange={(v) => set({ showAskLine: v })}
      />
      <SectionTitle>持仓与订单</SectionTitle>
      <ToggleRow
        label="在图表上显示持仓和订单"
        hint="Entry, TP and SL lines with drag-to-edit"
        checked={prefs.overlayPositionsOnChart}
        onChange={(v) => set({ overlayPositionsOnChart: v })}
      />
    </div>
  );
}

function EventsTab({
  activePlugins,
  onTogglePlugin,
  onOpenNewsConfig,
  onClose,
}: {
  activePlugins: string[];
  onTogglePlugin?: (id: string) => void;
  onOpenNewsConfig: () => void;
  onClose: () => void;
}) {
  return (
    <div>
      <SectionTitle>交易时段</SectionTitle>
      <ToggleRow
        label="时段分隔线"
        hint="Vertical line at each trading-day boundary (intraday only)"
        checked={activePlugins.includes("session-breaks")}
        disabled={!onTogglePlugin}
        onChange={() => onTogglePlugin?.("session-breaks")}
      />
      <ToggleRow
        label="时段高亮"
        hint="Shade Asia / London / New York forex sessions"
        checked={activePlugins.includes("session")}
        disabled={!onTogglePlugin}
        onChange={() => onTogglePlugin?.("session")}
      />
      <SectionTitle>资讯</SectionTitle>
      <button
        onClick={() => {
          onClose();
          onOpenNewsConfig();
        }}
        className="mt-1 rounded border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary"
      >
        配置资讯叠加层…
      </button>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Impact filter, event markers and no-trade window shading are configured in the news overlay
        dialog.
      </p>
    </div>
  );
}

function ChallengeTab({ prefs, hasAccount }: { prefs: ChartPreferences; hasAccount: boolean }) {
  const set = updateChartPreferences;
  const master = prefs.challengeOverlay;
  return (
    <div>
      <SectionTitle>图表上的挑战等级线</SectionTitle>
      <ToggleRow
        label="显示挑战等级"
        hint="Projects your account's rule thresholds onto the chart as price lines"
        checked={master}
        onChange={(v) => set({ challengeOverlay: v })}
      />
      <ToggleRow
        label="日亏损上限"
        checked={prefs.challengeDailyLossLine}
        disabled={!master}
        onChange={(v) => set({ challengeDailyLossLine: v })}
      />
      <ToggleRow
        label="最大回撤"
        checked={prefs.challengeMaxDrawdownLine}
        disabled={!master}
        onChange={(v) => set({ challengeMaxDrawdownLine: v })}
      />
      <ToggleRow
        label="盈利目标"
        checked={prefs.challengeProfitTargetLine}
        disabled={!master}
        onChange={(v) => set({ challengeProfitTargetLine: v })}
      />
      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
        当图表品种有持仓时显示这些线——净值触及各上限的价格按净敞口计算，并随每个报价跳动更新。
        {!hasAccount && " 选择账户后启用。"}
      </p>
    </div>
  );
}

function TabBody({
  tab,
  props,
}: {
  tab: TabId;
  props: Pick<
    ChartSettingsDialogProps,
    "prefs" | "isDark" | "activePlugins" | "onTogglePlugin" | "onOpenNewsConfig" | "hasAccount"
  > & { onClose: () => void };
}) {
  if (tab === "appearance") return <AppearanceTab prefs={props.prefs} />;
  if (tab === "colors") return <ColorsTab prefs={props.prefs} isDark={props.isDark} />;
  if (tab === "trading") return <TradingTab prefs={props.prefs} />;
  if (tab === "events") {
    return (
      <EventsTab
        activePlugins={props.activePlugins}
        onTogglePlugin={props.onTogglePlugin}
        onOpenNewsConfig={props.onOpenNewsConfig}
        onClose={props.onClose}
      />
    );
  }
  return <ChallengeTab prefs={props.prefs} hasAccount={props.hasAccount} />;
}

export function ChartSettingsDialog(props: ChartSettingsDialogProps) {
  const { open, onClose } = props;
  const [tab, setTab] = useState<TabId>("appearance");
  const drag = useDragOffset();
  if (!open) return null;

  const close = () => {
    drag.reset();
    onClose();
  };
  const resetPayload = RESET_BY_TAB[tab];
  // Challenge-rule levels belong to prop-firm accounts; a brokerage account has none.
  const tabs = isHyperliquidMode() ? TABS.filter((t) => t.id !== "challenge") : TABS;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={close}
    >
      <div
        className="flex h-[440px] w-[560px] max-w-[94vw] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
        style={drag.style}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle header */}
        <div
          onPointerDown={drag.onPointerDown}
          className="flex cursor-grab select-none items-center justify-between border-b border-border px-3 py-2.5 active:cursor-grabbing"
        >
          <div className="flex items-center gap-1.5">
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />
            <h2 className="text-sm font-semibold text-foreground">图表设置</h2>
          </div>
          <button onClick={close} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="w-36 shrink-0 border-r border-border p-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs transition-colors",
                  tab === t.id
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <TabBody tab={tab} props={{ ...props, onClose: close }} />
          </div>
        </div>
        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          {resetPayload ? (
            <button
              onClick={() => updateChartPreferences(resetPayload)}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              恢复默认设置
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={close}
            className="rounded bg-secondary px-3 py-1 text-xs text-foreground hover:bg-secondary/70"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
