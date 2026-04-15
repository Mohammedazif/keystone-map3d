"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Sparkles,
} from "lucide-react";

import { DrawingToolbar } from "@/components/drawing-toolbar";
import { MapEditor } from "@/components/map-editor";
import { MapSearch } from "@/components/map-search";
import { DrawingStatus } from "@/components/drawing-status";
import { AnalysisMode } from "@/components/solar-controls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBuildingStore, useSelectedPlot } from "@/hooks/use-building-store";
import { useToast } from "@/hooks/use-toast";
import {
  BuildingIntendedUse,
  LandPlotType,
  LandProximity,
  LandZoningPreference,
  type EvaluateLandInput,
  type Plot,
} from "@/lib/types";

const PLOT_TYPE_OPTIONS = Object.values(LandPlotType);
const PROXIMITY_OPTIONS = Object.values(LandProximity);
const ZONING_OPTIONS = Object.values(LandZoningPreference);
const INTENDED_USE_OPTIONS = Object.values(BuildingIntendedUse);

// Schema
const evaluateLandFormSchema = z.object({
  projectName: z.string().trim().min(1, "Enter a project or opportunity name."),
  location: z.string().trim().min(1, "Enter or select a location."),
  landSize: z
    .string()
    .min(1, "Land size must be a positive number.")
    .refine((value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric > 0;
    }, "Land size must be a positive number."),
  intendedUse: z.nativeEnum(BuildingIntendedUse, {
    errorMap: () => ({ message: "Select an intended use case." }),
  }),
  priceRange: z.string().trim().min(1, "Enter a price range or land value."),
  plotType: z.nativeEnum(LandPlotType, {
    errorMap: () => ({ message: "Select a plot type." }),
  }),
  zoningPreference: z.nativeEnum(LandZoningPreference, {
    errorMap: () => ({ message: "Select a zoning preference." }),
  }),
  proximity: z.array(z.nativeEnum(LandProximity)),
});

type EvaluateLandForm = z.infer<typeof evaluateLandFormSchema>;

// Default values
const createDefaultForm = (): EvaluateLandForm => ({
  projectName: "",
  location: "",
  landSize: "",
  intendedUse: BuildingIntendedUse.Residential,
  priceRange: "",
  plotType: LandPlotType.Vacant,
  zoningPreference: LandZoningPreference.BuiltUp,
  proximity: [],
});

// Keeps land size input numeric.
const normalizeNumericInput = (value: string) =>
  value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");

// Normalizes the price field.
const normalizePriceRangeInput = (value: string) =>
  value.replace(/\s+/g, " ").trimStart();

// Evaluate Land flow before a project record exists.
export function EvaluateLandWorkspace() {
  const router = useRouter();
  const { toast } = useToast();
  const actions = useBuildingStore((state) => state.actions);
  const drawingState = useBuildingStore((state) => state.drawingState);
  const mapLocation = useBuildingStore((state) => state.mapLocation);
  const plots = useBuildingStore((state) => state.plots);
  const selectedPlot = useSelectedPlot();

  const [isMapReady, setIsMapReady] = useState(false);
  const [isSimulatorEnabled, setIsSimulatorEnabled] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("none");
  const [solarDate, setSolarDate] = useState<Date>(() => new Date());
  const [isStartingProject, setIsStartingProject] = useState(false);
  const [hasAttemptedProjectStart, setHasAttemptedProjectStart] =
    useState(false);
  const [isLocationManuallyEdited, setIsLocationManuallyEdited] =
    useState(false);

  const form = useForm<EvaluateLandForm>({
    resolver: zodResolver(evaluateLandFormSchema),
    defaultValues: createDefaultForm(),
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const { control, getValues, reset, setValue, trigger } = form;
  const watchedValues = form.watch();

  useEffect(() => {
    // Evaluate Land should always start from a clean workspace and a fresh form.
    useBuildingStore.getState().actions.resetWorkspace();
    reset(createDefaultForm());
    setHasAttemptedProjectStart(false);
    setIsLocationManuallyEdited(false);
  }, []);

  useEffect(() => {
    if (!mapLocation) return;
    if (isLocationManuallyEdited) return;
    if (getValues("location") === mapLocation) return;
    // Keep following map search updates until the user takes over the field manually.
    setValue("location", mapLocation, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: hasAttemptedProjectStart,
    });
  }, [
    getValues,
    hasAttemptedProjectStart,
    isLocationManuallyEdited,
    mapLocation,
    setValue,
  ]);

  useEffect(() => {
    if (plots.length === 0) return;
    const nextLandSize = Math.round(
      plots.reduce((total, plot) => total + plot.area, 0),
    ).toString();
    if (getValues("landSize") === nextLandSize) return;
    // Use the total captured plot area so the intake stays accurate even if multiple plots are drawn.
    setValue("landSize", nextLandSize, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: hasAttemptedProjectStart,
    });
  }, [getValues, hasAttemptedProjectStart, plots, setValue]);

  // Clears the current intake draft and resets the panel to its default state.
  const handleResetForm = () => {
    // Treat reset as a full pre-project reset so the inputs and temporary plot stay in sync.
    actions.resetWorkspace();
    const nextForm = createDefaultForm();
    reset(nextForm);
    setHasAttemptedProjectStart(false);
    setIsLocationManuallyEdited(false);
    toast({
      title: "Inputs reset",
      description: "The form and current plot selection have been cleared.",
    });
  };

  // Validates the intake form, creates a project, and hands the selected plot into the editor flow.
  const handleStartProject = async () => {
    setHasAttemptedProjectStart(true);

    const formValid = await trigger();

    if (!selectedPlot) {
      toast({
        variant: "destructive",
        title: "Plot required",
        description: "Draw or select a plot before starting a project.",
      });
      return;
    }

    if (!formValid) {
      toast({
        variant: "destructive",
        title: "Complete the form",
        description: "Fill all required inputs before starting a project.",
      });
      return;
    }

    setIsStartingProject(true);

    try {
      const values = getValues();
      const totalPlotArea = Number(values.landSize);
      const newProject = await actions.createProject(
        values.projectName.trim(),
        totalPlotArea,
        values.intendedUse,
        values.location.trim(),
        "",
        [],
        false,
      );

      if (!newProject) return;

      // Clone the temporary plots before handoff so the pre-project workspace stays disposable.
      const clonedPlots: Plot[] = plots.map((plot, index) => {
        const clonedPlot: Plot = JSON.parse(JSON.stringify(plot));
        clonedPlot.projectId = newProject.id;
        clonedPlot.name =
          clonedPlot.name ||
          (index === 0
            ? values.projectName.trim() || "Primary Plot"
            : `Plot ${index + 1}`);
        clonedPlot.location = values.location.trim();
        return clonedPlot;
      });

      const selectedClonedPlot =
        clonedPlots.find((plot) => plot.id === selectedPlot.id) || clonedPlots[0];

      const evaluateLandInput: EvaluateLandInput = {
        projectName: values.projectName.trim(),
        location: values.location.trim(),
        landSize: totalPlotArea,
        intendedUse: values.intendedUse,
        priceRange: values.priceRange.trim(),
        plotType: values.plotType,
        zoningPreference: values.zoningPreference,
        proximity: values.proximity,
      };

      actions.loadPlotsIntoWorkspace(
        clonedPlots,
        selectedClonedPlot?.id ?? null,
      );
      actions.updateProject(newProject.id, {
        evaluateLandInput,
        lastModified: new Date().toISOString(),
      });
      await actions.saveCurrentProject();

      toast({
        title: "Project started",
        description:
          "The selected land inputs and plot have been moved into the project editor.",
      });

      router.push(`/dashboard/project/${newProject.id}`);
    } finally {
      setIsStartingProject(false);
    }
  };

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
            <h1 className="text-sm font-semibold">Evaluate a Land</h1>
          </div>

          <div className="hidden md:block absolute left-1/2 -translate-x-1/2 w-full max-w-md">
            <MapSearch />
          </div>
        </div>

        <div className="pointer-events-auto absolute left-3 top-16 bottom-3 w-[360px]">
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
                  {plots.length > 0
                    ? `${Math.round(
                        plots.reduce((total, plot) => total + plot.area, 0),
                      ).toLocaleString()} sqm captured`
                    : "Draw or select a plot"}
                </p>
                {hasAttemptedProjectStart && !selectedPlot ? (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-destructive">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>Draw or select a plot on the map.</span>
                  </div>
                ) : null}
              </div>
            </CardHeader>

            <ScrollArea className="flex-1">
              <Form {...form}>
                <div className="space-y-5 p-4">
                  <FormField
                    control={control}
                    name="projectName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Project Name *</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={control}
                    name="location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Location *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Search on the map or type city, district, or locality"
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setIsLocationManuallyEdited(true);
                              field.onChange(nextValue);
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={control}
                      name="landSize"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Land Size *</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              inputMode="decimal"
                              placeholder="e.g. 4800 sqm"
                              onChange={(event) =>
                                field.onChange(
                                  normalizeNumericInput(event.target.value),
                                )
                              }
                            />
                          </FormControl>
                          {selectedPlot ? (
                            <FormDescription>
                              Auto-filled from the captured plot area.
                            </FormDescription>
                          ) : null}
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={control}
                      name="intendedUse"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Intended Use Case *</FormLabel>
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {INTENDED_USE_OPTIONS.map((intendedUse) => (
                                <SelectItem
                                  key={intendedUse}
                                  value={intendedUse}
                                >
                                  {intendedUse}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={control}
                    name="priceRange"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Price Range / Value *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="e.g. 6 Cr - 9 Cr or 18,000 per sqm"
                            onChange={(event) =>
                              field.onChange(
                                normalizePriceRangeInput(event.target.value),
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Separator />

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={control}
                      name="plotType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Plot Type *</FormLabel>
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {PLOT_TYPE_OPTIONS.map((plotType) => (
                                <SelectItem key={plotType} value={plotType}>
                                  {plotType === LandPlotType.Vacant
                                    ? "Vacant"
                                    : plotType === LandPlotType.Redevelopment
                                      ? "Redevelopment"
                                      : "Both"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={control}
                      name="zoningPreference"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Zoning Preference *</FormLabel>
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {ZONING_OPTIONS.map((zoningPreference) => (
                                <SelectItem
                                  key={zoningPreference}
                                  value={zoningPreference}
                                >
                                  {zoningPreference === LandZoningPreference.BuiltUp
                                    ? "Built-up"
                                    : zoningPreference === LandZoningPreference.Agricultural
                                      ? "Agricultural"
                                      : zoningPreference === LandZoningPreference.Waste
                                        ? "Waste Land"
                                        : zoningPreference === LandZoningPreference.MixedUse
                                          ? "Mixed-use"
                                          : "Industrial"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={control}
                    name="proximity"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between">
                          <FormLabel>Proximity</FormLabel>
                          <span className="text-xs text-muted-foreground">
                            Optional nearby infrastructure preferences
                          </span>
                        </div>
                        <div className="grid gap-2 rounded-lg border border-border/50 bg-muted/10 p-3">
                          {PROXIMITY_OPTIONS.map((proximity) => {
                            const isChecked = field.value.includes(proximity);
                            return (
                              <label
                                key={proximity}
                                className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/40"
                              >
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={() => {
                                    const nextValues = isChecked
                                      ? field.value.filter(
                                          (item) => item !== proximity,
                                        )
                                      : [...field.value, proximity];
                                    field.onChange(nextValues);
                                  }}
                                />
                                <span>
                                  {proximity === LandProximity.Metro
                                    ? "Metro / Rail Transit"
                                    : proximity === LandProximity.Highway
                                      ? "Highway / Arterial Road"
                                      : proximity === LandProximity.Airport
                                        ? "Airport / Logistics Hub"
                                        : proximity === LandProximity.Schools
                                          ? "Schools / Colleges"
                                          : proximity === LandProximity.Hospitals
                                            ? "Hospitals / Emergency Care"
                                            : proximity === LandProximity.Retail
                                              ? "Retail / High Street"
                                              : proximity === LandProximity.Employment
                                                ? "Employment / Business District"
                                                : "Utilities / Infrastructure Access"}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </Form>
            </ScrollArea>

            <CardContent className="border-t border-border/40 bg-background/70 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <Button variant="outline" onClick={handleResetForm}>
                  Reset
                </Button>
                <Button
                  onClick={handleStartProject}
                  disabled={isStartingProject}
                >
                  {isStartingProject ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Start Project
                </Button>
              </div>
            </CardContent>
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
