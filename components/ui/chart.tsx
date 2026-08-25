"use client";

import * as React from "react";
import { Tooltip as RechartsTooltip } from "recharts";
import { cn } from "@/lib/utils";

export type ChartConfig = Record<string, { label?: React.ReactNode; color?: string }>;

const ChartContext = React.createContext<{ config: ChartConfig }>({ config: {} });

function ChartContainer({ id, className, config, children }: { id?: string; className?: string; config: ChartConfig; children: React.ReactNode }) {
  const chartId = React.useId();
  const vars = Object.entries(config).reduce<Record<string, string>>((styles, [key, value]) => {
    if (value.color) styles[`--color-${key}`] = value.color;
    return styles;
  }, {});
  return (
    <ChartContext.Provider value={{ config }}>
      <div data-chart={id ?? chartId.replace(/:/g, "")} className={cn("shadcn-chart", className)} style={vars as React.CSSProperties}>
        {children}
      </div>
    </ChartContext.Provider>
  );
}

function ChartTooltip(props: React.ComponentProps<typeof RechartsTooltip>) {
  return <RechartsTooltip {...props} />;
}

function useChartConfig() {
  return React.useContext(ChartContext).config;
}

export { ChartContainer, ChartTooltip, useChartConfig };
