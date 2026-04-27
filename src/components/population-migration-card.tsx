"use client";

import { TrendingUp } from "lucide-react";

import type { PopulationMigrationAnalysis } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";

function formatPopulation(value: number) {
  return Math.round(value).toLocaleString("en-IN");
}

function formatPct(value: number) {
  return `${value.toLocaleString("en-IN", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function DataRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function TrendPill({
  label,
  tone,
}: {
  label: string;
  tone: "emerald" | "amber" | "red" | "blue";
}) {
  const className =
    tone === "emerald"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
      : tone === "amber"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700"
        : tone === "red"
          ? "border-red-500/40 bg-red-500/10 text-red-700"
          : "border-blue-500/40 bg-blue-500/10 text-blue-700";

  return (
    <Badge variant="outline" className={cn("text-[10px] font-semibold", className)}>
      {label}
    </Badge>
  );
}

export function PopulationMigrationCard({
  analysis,
  className,
  emphasized = false,
}: {
  analysis: PopulationMigrationAnalysis | null;
  className?: string;
  emphasized?: boolean;
}) {
  if (!analysis) {
    return (
      <div
        className={cn(
          "overflow-hidden rounded-lg border border-border/40 bg-secondary/10",
          emphasized && "border-blue-500/40 bg-gradient-to-br from-blue-500/10 via-cyan-500/5 to-transparent shadow-[0_0_0_1px_rgba(59,130,246,0.12)]",
          className,
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2 border-b border-border/30 bg-secondary/20 px-3 py-2",
            emphasized && "bg-blue-500/10",
          )}
        >
          <TrendingUp className="h-4 w-4 shrink-0 text-blue-500" />
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Population Migration Trend
          </span>
          {emphasized ? (
            <Badge variant="outline" className="ml-auto border-blue-500/40 bg-blue-500/10 text-[10px] font-semibold text-blue-700">
              Featured
            </Badge>
          ) : null}
        </div>
        <div className="space-y-3 p-3 text-sm">
          <div className="flex flex-wrap gap-1.5">
            <TrendPill label="data unavailable" tone="amber" />
            <TrendPill label="visible for testing" tone="blue" />
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The migration card is mounted correctly, but the current location does not yet have
            supporting census coverage in the local dataset, so no 2001 → 2011 → 2025 trend could
            be generated for this run.
          </p>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-600">
              Why It Is Empty
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              The current project dataset only has migration-ready census records for a small set of
              cities and districts. For uncovered places like your current test location, the API was
              returning `null`, which hid this card entirely until now.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const peakPopulation = Math.max(...analysis.timeSeries.map((point) => point.population), 1);
  const directionTone =
    analysis.migrationDirection === "inward"
      ? "emerald"
      : analysis.migrationDirection === "outward"
        ? "red"
        : "amber";
  const confidenceTone = analysis.confidence >= 0.75 ? "emerald" : analysis.confidence >= 0.6 ? "amber" : "red";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border/40 bg-secondary/10",
        emphasized && "border-blue-500/40 bg-gradient-to-br from-blue-500/10 via-cyan-500/5 to-transparent shadow-[0_0_0_1px_rgba(59,130,246,0.12)]",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 border-b border-border/30 bg-secondary/20 px-3 py-2",
          emphasized && "bg-blue-500/10",
        )}
      >
        <TrendingUp className={cn("h-4 w-4 shrink-0 text-blue-500", emphasized && "h-4.5 w-4.5")} />
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Population Migration Trend
        </span>
        {emphasized ? (
          <Badge variant="outline" className="ml-auto border-blue-500/40 bg-blue-500/10 text-[10px] font-semibold text-blue-700">
            Featured
          </Badge>
        ) : null}
      </div>
      <div className="space-y-3 p-3 text-sm">
        <div className="flex flex-wrap gap-1.5">
          <TrendPill
            label={`${analysis.migrationIntensity} ${analysis.migrationDirection}`}
            tone={directionTone}
          />
          <TrendPill
            label={analysis.growthPattern.replace(/-/g, " ")}
            tone="blue"
          />
          <TrendPill
            label={`${Math.round(analysis.confidence * 100)}% confidence`}
            tone={confidenceTone}
          />
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">{analysis.summary}</p>

        <div className="grid gap-2 md:grid-cols-3">
          {analysis.timeSeries.map((point) => {
            const pct = (point.population / peakPopulation) * 100;
            return (
              <div key={point.year} className="rounded-lg border border-border/40 bg-background/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{point.year}</span>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {point.kind}
                  </Badge>
                </div>
                <div className="mt-2 text-lg font-black tabular-nums">{formatPopulation(point.population)}</div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-border/30">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-700 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <div className="rounded-lg border border-border/40 bg-background/60 p-3">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Growth Metrics
            </div>
            <div className="mt-2 space-y-1.5">
              <DataRow label="2001-2011 decadal growth" value={formatPct(analysis.decadalGrowth2001To2011)} />
              <DataRow label="Annualized growth to 2011" value={formatPct(analysis.annualGrowthRate2001To2011)} />
              <DataRow label="Projected annual growth to 2025" value={formatPct(analysis.projectedAnnualGrowthRate2011To2025)} />
            </div>
          </div>
          <div className="rounded-lg border border-border/40 bg-background/60 p-3">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Urban Pressure
            </div>
            <div className="mt-2 space-y-1.5">
              <DataRow label="2011 density" value={`${formatPopulation(analysis.density2011)} / sq km`} />
              <DataRow label="Projected 2025 density" value={`${formatPopulation(analysis.projectedDensity2025)} / sq km`} />
              <DataRow label="Projected urban share" value={formatPct(analysis.projectedUrbanPopulationPct2025)} />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
          <div className="text-xs font-bold uppercase tracking-wider text-blue-600">
            Demand Implication
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{analysis.implications}</p>
        </div>

        <div className="space-y-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Drivers</div>
            <div className="mt-2 space-y-1.5">
              {analysis.drivers.map((driver, index) => (
                <div key={index} className="rounded bg-secondary/30 px-2 py-1.5 text-xs text-muted-foreground">
                  {driver}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Caveats</div>
            <div className="mt-2 space-y-1.5">
              {analysis.caveats.map((caveat, index) => (
                <div key={index} className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-xs text-muted-foreground">
                  {caveat}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
