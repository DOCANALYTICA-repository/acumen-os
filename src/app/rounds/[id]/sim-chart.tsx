"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "@/lib/sim/model";

export type YearPoint = { year: string; Revenue: number; "Net profit": number; Cash: number };

/**
 * Revenue, profit and cash by year. Its own file so the chart library (recharts, ~100 kB) loads only when this
 * chart is on screen, not with every round page (sim-workspace.tsx imports it with next/dynamic).
 */
export default function YearChart({ data }: { data: YearPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
        <XAxis dataKey="year" tick={{ fontSize: 12 }} />
        <YAxis tickFormatter={(v: number) => money(v)} tick={{ fontSize: 11 }} width={72} />
        <Tooltip formatter={(v) => money(Number(v), false)} />
        <Legend />
        <Line type="monotone" dataKey="Revenue" stroke="#2a78d6" strokeWidth={2} dot={{ r: 4 }} />
        <Line type="monotone" dataKey="Net profit" stroke="#eb6834" strokeWidth={2} dot={{ r: 4 }} />
        <Line type="monotone" dataKey="Cash" stroke="#1f9e6e" strokeWidth={2} dot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
