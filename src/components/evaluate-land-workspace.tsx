"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";

import { DrawingToolbar } from "@/components/drawing-toolbar";
import { MapEditor } from "@/components/map-editor";
import { MapSearch } from "@/components/map-search";
import { DrawingStatus } from "@/components/drawing-status";
import { AnalysisMode } from "@/components/solar-controls";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBuildingStore, useSelectedPlot } from "@/hooks/use-building-store";
import { BuildingIntendedUse } from "@/lib/types";

export function EvaluateLandWorkspace() {
  const drawingState = useBuildingStore((state) => state.drawingState);
  const mapLocation = useBuildingStore((state) => state.mapLocation);
  const selectedPlot = useSelectedPlot();

  const [isMapReady, setIsMapReady] = useState(false);
  const [isSimulatorEnabled, setIsSimulatorEnabled] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("none");
  const [solarDate, setSolarDate] = useState<Date>(() => new Date());

  const [projectName, setProjectName] = useState("");
  const [location, setLocation] = useState("");
  const [landSize, setLandSize] = useState("");
  const [intendedUse, setIntendedUse] = useState<BuildingIntendedUse>(
    BuildingIntendedUse.Residential,
  );
  const [plotType, setPlotType] = useState("vacant");
  const [zoningPreference, setZoningPreference] = useState("built-up");
  const [priceRange, setPriceRange] = useState("");

  useEffect(() => {
    if (!mapLocation) return;
    setLocation((current) => current || mapLocation);
  }, [mapLocation]);

  useEffect(() => {
    if (!selectedPlot) return;
    setLandSize(Math.round(selectedPlot.area).toString());
  }, [selectedPlot]);

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-background text-foreground">
      <MapEditor
        onMapReady={() => setIsMapReady(true)}
        solarDate={solarDate}
        setSolarDate={setSolarDate}
        isSimulatorEnabled={isSimulatorEnabled}
        setIsSimulatorEnabled={setIsSimulatorEnabled}
        analysisMode={analysisMode}
        setAnalysisMode={setAnalysisMode}
      />
      <DrawingToolbar />

      {!isMapReady && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-xl border bg-background px-5 py-4 shadow-lg">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div>
              <p className="text-sm font-semibold">Preparing Evaluate Land</p>
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 z-20">
        <div className="pointer-events-auto absolute left-3 top-3 right-3 flex items-center gap-3">
          <div className="flex items-center gap-3 rounded-xl border bg-background/95 px-3 py-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-sm font-semibold">Evaluate a Land</h1>
            </div>
          </div>

          <div className="hidden md:block absolute left-1/2 -translate-x-1/2 w-full max-w-md">
            <MapSearch />
          </div>
        </div>

        <div className="pointer-events-auto absolute left-3 top-16 bottom-3 w-[340px]">
          <Card className="flex h-full flex-col overflow-hidden rounded-xl border bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <CardHeader className="space-y-3 border-b border-border/40 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Land Inputs</CardTitle>
                </div>
                <div className="rounded-lg bg-muted/40 p-2 text-muted-foreground">
                  <Sparkles className="h-5 w-5" />
                </div>
              </div>

              <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Selected Plot
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {selectedPlot
                    ? `${Math.round(selectedPlot.area).toLocaleString()} sqm captured`
                    : "Draw or select a plot on the map"}
                </p>
              </div>
            </CardHeader>

            <ScrollArea className="flex-1">
              <div className="space-y-5 p-4">
                <div className="space-y-2">
                  <Label htmlFor="project-name">Project Name</Label>
                  <Input
                    id="project-name"
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder="Northwest growth parcel"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <Input
                    id="location"
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                    placeholder="Search on the map or type city / district"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="land-size">Land Size</Label>
                    <Input
                      id="land-size"
                      value={landSize}
                      onChange={(event) => setLandSize(event.target.value)}
                      placeholder="sqm"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Intended Use</Label>
                    <Select
                      value={intendedUse}
                      onValueChange={(value) =>
                        setIntendedUse(value as BuildingIntendedUse)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={BuildingIntendedUse.Residential}>
                          Residential
                        </SelectItem>
                        <SelectItem value={BuildingIntendedUse.Commercial}>
                          Commercial
                        </SelectItem>
                        <SelectItem value={BuildingIntendedUse.MixedUse}>
                          Mixed Use
                        </SelectItem>
                        <SelectItem value={BuildingIntendedUse.Industrial}>
                          Industrial
                        </SelectItem>
                        <SelectItem value={BuildingIntendedUse.Public}>
                          Public
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Plot Type</Label>
                    <Select value={plotType} onValueChange={setPlotType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="vacant">Vacant</SelectItem>
                        <SelectItem value="redevelopment">
                          Redevelopment
                        </SelectItem>
                        <SelectItem value="both">Both</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Zoning Preference</Label>
                    <Select
                      value={zoningPreference}
                      onValueChange={setZoningPreference}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="built-up">Built-up</SelectItem>
                        <SelectItem value="agricultural">
                          Agricultural
                        </SelectItem>
                        <SelectItem value="mixed-use">Mixed-use</SelectItem>
                        <SelectItem value="industrial">Industrial</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="price-range">Price Range / Land Value</Label>
                  <Input
                    id="price-range"
                    value={priceRange}
                    onChange={(event) => setPriceRange(event.target.value)}
                    placeholder="e.g. 6 Cr - 9 Cr"
                  />
                </div>
              </div>
            </ScrollArea>
          </Card>
        </div>
        {drawingState.isDrawing && (
          <div className="pointer-events-auto">
            <DrawingStatus />
          </div>
        )}
      </div>
    </div>
  );
}
