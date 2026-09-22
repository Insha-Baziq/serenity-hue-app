"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import s from "./reports-workspace.module.css";

export type ReportChartPoint = { label: string; value: number; secondary?: number };

const plum = "#6c285f";
const magenta = "#c13a9b";
const rose = "#d88a9e";
const grid = "#eadfe3";
const axis = "#897a82";

function shortLabel(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }).format(new Date(`${value}T12:00:00Z`));
  }
  return value.length > 13 ? `${value.slice(0, 12)}…` : value;
}

function moneyTick(value: number) {
  const pounds = value / 100;
  if (Math.abs(pounds) >= 1000) return `£${(pounds / 1000).toFixed(0)}k`;
  return `£${Math.round(pounds)}`;
}

function countTick(value: number) {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return `${Math.round(value)}`;
}

function tooltipValue(value: unknown, money: boolean) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return money ? `£${(numeric / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : numeric.toLocaleString("en-GB");
}

export function ReportAreaChart({ data, dataKey = "value", money = false, colour = magenta, secondaryColour = rose }: { data: ReportChartPoint[]; dataKey?: "value" | "secondary"; money?: boolean; colour?: string; secondaryColour?: string }) {
  if (!data.length) return <div className={s.chartEmpty}>No recorded activity in this period.</div>;
  const hasSecondary = data.some((point) => point.secondary !== undefined);
  return (
    <div className={s.chartCanvas}>
      <ChartContainer id="report-area-chart" config={{ series: { label: "Series", color: colour } }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={grid} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="label" tickFormatter={shortLabel} tick={{ fill: axis, fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis tickFormatter={money ? moneyTick : countTick} tick={{ fill: axis, fontSize: 10 }} axisLine={false} tickLine={false} width={42} />
            <Tooltip formatter={(value: unknown) => tooltipValue(value, money)} />
            {hasSecondary && <Area type="monotone" dataKey="secondary" stroke={secondaryColour} fill={secondaryColour} fillOpacity={0.08} strokeWidth={2} dot={{ r: 2, fill: secondaryColour, strokeWidth: 0 }} activeDot={{ r: 4 }} />}
            <Area type="monotone" dataKey={dataKey} stroke={colour} fill={colour} fillOpacity={0.14} strokeWidth={2.5} dot={{ r: 2.5, fill: colour, strokeWidth: 0 }} activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
}

export function ReportBarChart({ data, money = false, colour = plum, secondaryColour = rose }: { data: ReportChartPoint[]; money?: boolean; colour?: string; secondaryColour?: string }) {
  if (!data.length) return <div className={s.chartEmpty}>No recorded activity in this period.</div>;
  const hasSecondary = data.some((point) => point.secondary !== undefined);
  return (
    <div className={s.chartCanvas}>
      <ChartContainer id="report-bar-chart" config={{ primary: { label: "Primary", color: colour }, secondary: { label: "Secondary", color: secondaryColour } }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 18, bottom: 0, left: 4 }} barCategoryGap="26%">
            <CartesianGrid stroke={grid} strokeDasharray="2 4" horizontal={false} />
            <XAxis type="number" tickFormatter={money ? moneyTick : countTick} tick={{ fill: axis, fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" tickFormatter={shortLabel} tick={{ fill: "#4f3949", fontSize: 10 }} axisLine={false} tickLine={false} width={96} />
            <Tooltip formatter={(value: unknown) => tooltipValue(value, money)} />
            <Bar dataKey="value" name="Primary" fill={colour} radius={[0, 4, 4, 0]} maxBarSize={18} />
            {hasSecondary && <Bar dataKey="secondary" name="Secondary" fill={secondaryColour} radius={[0, 4, 4, 0]} maxBarSize={18} />}
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
}

export function ReportDonut({ data, centre, colours = [plum, magenta, rose] }: { data: Array<{ name: string; value: number }>; centre: string; colours?: string[] }) {
  const total = data.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  if (!total) return <div className={s.chartEmpty}>No recorded activity in this period.</div>;
  return (
    <div className={s.donutWrap}>
      <div className={s.donutCanvas}>
        <ChartContainer id="report-donut-chart" config={{ primary: { label: "Share", color: plum } }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data.map((item) => ({ ...item, value: Math.max(0, item.value) }))} dataKey="value" nameKey="name" innerRadius="57%" outerRadius="80%" paddingAngle={2} stroke="none">
                {data.map((item, index) => <Cell key={item.name} fill={colours[index % colours.length]} />)}
              </Pie>
              <Tooltip formatter={(value: unknown) => `${(Number(value ?? 0) / total * 100).toFixed(1)}%`} />
            </PieChart>
          </ResponsiveContainer>
        </ChartContainer>
        <div className={s.donutCentre}>{centre}</div>
      </div>
      <div className={s.legendList}>
        {data.map((item, index) => <div key={item.name} className={s.legendRow}><span className={s.legendSwatch} style={{ background: colours[index % colours.length] }} /><span>{item.name}</span><strong>{(Math.max(0, item.value) / total * 100).toFixed(1)}%</strong></div>)}
      </div>
    </div>
  );
}
