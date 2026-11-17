"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Validated categorical slots (dataviz reference palette, light mode).
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a"];
const AXIS = { stroke: "#94a3b8", fontSize: 12, tickLine: false };
const GRID = <CartesianGrid stroke="#e2e8f0" vertical={false} />;
const TIP = { contentStyle: { borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }, cursor: { fill: "rgba(15,23,42,0.04)" } };

type Row = Record<string, string | number>;

export function Bars({ data, x, y, label, height = 240, horizontal = false }: { data: Row[]; x: string; y: string; label: string; height?: number; horizontal?: boolean }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-muted">No data yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={horizontal ? Math.max(height, data.length * 34 + 30) : height}>
      {horizontal ? (
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid stroke="#e2e8f0" horizontal={false} />
          <XAxis type="number" allowDecimals={false} {...AXIS} axisLine={false} />
          <YAxis type="category" dataKey={x} width={140} {...AXIS} axisLine={false} />
          <Tooltip {...TIP} />
          <Bar dataKey={y} name={label} fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={22} />
        </BarChart>
      ) : (
        <BarChart data={data} margin={{ left: -16, right: 8 }}>
          {GRID}
          <XAxis dataKey={x} {...AXIS} axisLine={false} />
          <YAxis allowDecimals={false} {...AXIS} axisLine={false} />
          <Tooltip {...TIP} />
          <Bar dataKey={y} name={label} fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

export function Trend({ data, x, y, label, height = 240 }: { data: Row[]; x: string; y: string; label: string; height?: number }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-muted">No data yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ left: -16, right: 8 }}>
        {GRID}
        <XAxis dataKey={x} {...AXIS} axisLine={false} minTickGap={24} />
        <YAxis allowDecimals={false} {...AXIS} axisLine={false} />
        <Tooltip {...TIP} cursor={{ stroke: "#94a3b8", strokeDasharray: "3 3" }} />
        <Line type="monotone" dataKey={y} name={label} stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function GroupedBars({ data, x, series, height = 260 }: { data: Row[]; x: string; series: { key: string; label: string }[]; height?: number }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-muted">No data yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: -16, right: 8 }} barGap={2}>
        {GRID}
        <XAxis dataKey={x} {...AXIS} axisLine={false} />
        <YAxis allowDecimals={false} {...AXIS} axisLine={false} />
        <Tooltip {...TIP} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES[i]} radius={[4, 4, 0, 0]} maxBarSize={28} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Funnel as horizontal bars; each stage's width is proportional to its count. */
export function Funnel({ stages }: { stages: { stage: string; count: number }[] }) {
  const first = stages[0]?.count || 1;
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const pct = (s.count / first) * 100;
        const prev = i > 0 ? stages[i - 1].count : null;
        return (
          <div key={s.stage} title={`${s.stage}: ${s.count}`}>
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-medium text-ink">{s.stage}</span>
              <span className="text-muted">
                <strong className="text-ink">{s.count}</strong>
                {prev !== null && prev > 0 && ` · ${((s.count / prev) * 100).toFixed(0)}% of previous`}
              </span>
            </div>
            <div className="h-6 rounded bg-surface">
              <div className="h-6 rounded" style={{ width: `${Math.max(pct, 1)}%`, background: SERIES[0] }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
