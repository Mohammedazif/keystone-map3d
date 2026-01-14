
'use client';
import React, { useState, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { useSelectedBuilding, useProjectData, useBuildingStore } from '@/hooks/use-building-store';
import { AreaChart, Scale, Building, Car, CheckCircle, AlertTriangle, ShieldCheck, DollarSign, LocateFixed, ChevronUp, ChevronDown, Compass } from 'lucide-react';
import { useDevelopmentMetrics } from '@/hooks/use-development-metrics';
import { useRegulations } from '@/hooks/use-regulations';
import { useProjectEstimates } from '@/hooks/use-project-estimates';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { Switch } from './ui/switch';
import { Label } from './ui/label';

function MetricsTab() {
    const building = useSelectedBuilding();
    const activeProject = useProjectData();
    const metrics = useDevelopmentMetrics(activeProject || null);

    if (!activeProject || !metrics) return <div className="p-4 text-center text-muted-foreground">No metrics available</div>;

    const kpis = [
        { icon: AreaChart, label: "Plot Area", value: metrics.totalPlotArea.toLocaleString(), unit: "sqm" },
        { icon: AreaChart, label: "Built-up Area", value: metrics.totalBuiltUpArea.toLocaleString(), unit: "sqm" },
        { icon: Scale, label: "Achieved FAR", value: metrics.achievedFAR.toFixed(2) },
        { icon: Building, label: "Units", value: metrics.totalUnits.toString() },
        { icon: Car, label: "Parking", value: `${metrics.parking.provided} / ${metrics.parking.required}` },
        { icon: Scale, label: "Efficiency", value: (metrics.efficiency * 100).toFixed(0), unit: "%" },
    ];
    return (
        <div className="grid grid-cols-2 gap-4">
            {kpis.map(kpi => (
                <Card key={kpi.label} className="bg-secondary/50">
                    <CardHeader className="p-4">
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            <kpi.icon className="h-4 w-4 text-primary" /> {kpi.label}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <span className="text-2xl font-bold">{kpi.value}</span>
                        {kpi.unit && <span className="text-sm text-muted-foreground ml-1">{kpi.unit}</span>}
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}



function FeasibilityTab() {
    const activeProject = useProjectData();

    const metrics = useDevelopmentMetrics(activeProject);
    const { regulations, greenStandards, vastuRules } = useRegulations(activeProject);

    const uiState = useBuildingStore(state => state.uiState);
    const toggleVastuCompass = useBuildingStore(state => state.actions.toggleVastuCompass);

    const { estimates, isLoading: isLoadingEstimates } = useProjectEstimates(activeProject, metrics);



    if (!metrics) return <div className="p-4 text-center text-muted-foreground">Calculations pending...</div>;

    // Extract dynamic limits from regulations
    const maxFAR = regulations?.geometry?.floor_area_ratio?.value || activeProject?.feasibilityParams?.efficiencyTarget || 2.5;
    const minGreenCover = greenStandards?.constraints?.minGreenCover ? greenStandards.constraints.minGreenCover * 100 : 15;
    const minOpenSpace = greenStandards?.constraints?.minOpenSpace ? greenStandards.constraints.minOpenSpace * 100 : 30;
    const maxHeight = regulations?.geometry?.max_height?.value;
    const maxCoverage = regulations?.geometry?.max_ground_coverage?.value;

    const complianceCards = [
        {
            label: "Bylaw Compliance",
            score: metrics.compliance.bylaws,
            icon: ShieldCheck,
            items: [
                {
                    label: `FAR Check (≤${maxFAR})`,
                    status: metrics.achievedFAR <= maxFAR ? 'pass' : 'fail',
                    detail: `${metrics.achievedFAR.toFixed(2)} / ${maxFAR}`
                },
                {
                    label: maxHeight ? `Height Limit (≤${maxHeight}m)` : "Height Limit",
                    status: 'pass'
                },
                ...(maxCoverage ? [{
                    label: `Coverage (≤${maxCoverage}%)`,
                    status: 'pass'
                }] : [])
            ]
        },
        {
            label: activeProject?.greenCertification?.[0] ? `Green Building (${activeProject.greenCertification[0]})` : "Green Building",
            score: metrics.compliance.green,
            icon: CheckCircle,
            items: [
                {
                    label: `Green Cover (≥${minGreenCover.toFixed(0)}%)`,
                    status: metrics.greenArea.percentage >= minGreenCover ? 'pass' : 'fail',
                    detail: `${metrics.greenArea.percentage.toFixed(1)}%`
                },
                {
                    label: `Open Space (≥${minOpenSpace.toFixed(0)}%)`,
                    status: metrics.openSpace / metrics.totalPlotArea >= (minOpenSpace / 100) ? 'pass' : 'warn',
                    detail: `${((metrics.openSpace / metrics.totalPlotArea) * 100).toFixed(1)}%`
                },
            ]
        },
        ...(activeProject?.vastuCompliant ? [{
            label: "Vastu (Shakti Chakra)",
            score: metrics.compliance.vastu,
            icon: Compass,
            items: [
                { label: "Brahmasthan Open", status: 'pass' },
                { label: "Service Placement", status: metrics.compliance.vastu > 80 ? 'pass' : 'warn' },
            ],
            // Special Control for Vastu
            control: (
                <div className="flex items-center space-x-2 mt-2 pt-2 border-t border-border/50">
                    <Switch
                        id="vastu-compass"
                        checked={uiState.showVastuCompass}
                        onCheckedChange={toggleVastuCompass}
                    />
                    <Label htmlFor="vastu-compass" className="text-xs">Show Shakti Chakra Overlay</Label>
                </div>
            )
        }] : []),
        ...(metrics.greenAnalysis ? [{
            label: "Green Simulation (Beta)",
            score: metrics.greenAnalysis.overall,
            icon: CheckCircle, // Reusing icon for now
            items: metrics.greenAnalysis.breakdown.map(b => ({
                label: b.category,
                status: b.score > 70 ? 'pass' : b.score > 40 ? 'warn' : 'fail',
                detail: b.feedback
            }))
        }] : [])
    ];

    const getTrafficLight = (score: number) => {
        if (score >= 80) return "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)]";
        if (score >= 50) return "bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.6)]";
        return "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.6)]";
    };

    const getStatusIcon = (status: string) => {
        if (status === 'pass') return <CheckCircle className="h-3 w-3 text-green-500" />;
        if (status === 'fail') return <AlertTriangle className="h-3 w-3 text-red-500" />;
        return <AlertTriangle className="h-3 w-3 text-yellow-500" />;
    };

    return (
        <div className="space-y-4 pb-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-secondary/30 rounded border text-center">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">Green Cover</div>
                    <div className="font-bold text-xl text-green-600">{metrics.greenArea.percentage.toFixed(1)}%</div>
                </div>
                <div className="p-3 bg-secondary/30 rounded border text-center">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">Road Area</div>
                    <div className="font-bold text-xl text-slate-500">{(metrics.roadArea / Math.max(1, metrics.totalPlotArea) * 100).toFixed(1)}%</div>
                </div>
            </div>

            <div className="space-y-3">
                {complianceCards.map((card, idx) => (
                    <Card key={idx} className="bg-secondary/20 border-border/50">
                        <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-sm font-medium flex items-center gap-2">
                                <card.icon className="h-4 w-4" /> {card.label}
                            </CardTitle>
                            <div className={`h-3 w-3 rounded-full ${getTrafficLight(card.score)}`} />
                        </CardHeader>
                        <CardContent className="p-3 pt-0">
                            <div className="flex items-end gap-2 mb-2">
                                <span className="text-2xl font-bold">{card.score}</span>
                                <span className="text-xs text-muted-foreground mb-1">/ 100</span>
                            </div>
                            <div className="space-y-1">
                                {card.items.map((item, i) => (
                                    <div key={i} className="flex items-center justify-between text-xs">
                                        <span className="text-muted-foreground">{item.label}</span>
                                        {getStatusIcon(item.status)}
                                    </div>
                                ))}
                            </div>
                            {card.control}
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Project Estimates Section */}
            {estimates ? (
                <div className="space-y-3">
                    <div className="rounded-lg border p-3 bg-slate-50/5 border-slate-200/20">
                        <div className="flex items-center gap-2 mb-3">
                            <DollarSign className="h-4 w-4 text-emerald-400" />
                            <span className="text-sm font-semibold">Financial Estimates {estimates.isPotential && "(Potential)"}</span>
                            <Badge variant={(estimates.roi_percentage || 0) > 15 ? 'default' : 'secondary'} className="ml-auto text-xs">
                                ROI: {(estimates.roi_percentage || 0).toFixed(1)}%
                            </Badge>
                        </div>
                        {estimates.isPotential && (
                            <div className="text-[10px] text-amber-500 mb-2 flex items-center gap-1 justify-center bg-amber-500/10 p-1 rounded">
                                <AlertTriangle className="h-3 w-3" /> Based on Max Potential (No Design)
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-4 text-center">
                            <div>
                                <div className="text-[10px] text-muted-foreground uppercase">Construction Cost</div>
                                <div className="text-lg font-bold">
                                    {((estimates.total_construction_cost || 0) / 10000000).toFixed(2)} Cr
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                    {metrics?.totalBuiltUpArea ? `₹${(estimates.total_construction_cost / metrics.totalBuiltUpArea).toFixed(0)}/sqm` : 'N/A'}
                                </div>
                            </div>
                            <div>
                                <div className="text-[10px] text-muted-foreground uppercase">Potential Revenue</div>
                                <div className="text-lg font-bold text-emerald-500">
                                    {((estimates.total_revenue || 0) / 10000000).toFixed(2)} Cr
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                    Profit: ~{((estimates.potential_profit || 0) / 10000000).toFixed(2)} Cr
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-lg border p-3 bg-blue-50/5 border-blue-200/20">
                        <div className="flex items-center gap-2 mb-3">
                            <CheckCircle className="h-4 w-4 text-blue-400" />
                            <span className="text-sm font-semibold">Timeline & Efficiency</span>
                            <Badge variant="outline" className="ml-auto text-xs">
                                {(estimates.timeline?.total_months || 0).toFixed(1)} Months
                            </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Structure:</span>
                                <span>{(estimates.timeline?.phases?.structure || 0).toFixed(1)} mo</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Finishing:</span>
                                <span>{(estimates.timeline?.phases?.finishing || 0).toFixed(1)} mo</span>
                            </div>
                            <div className="pt-2 col-span-2 border-t border-border/10 flex justify-between items-center">
                                <span className="text-muted-foreground">Efficiency Target:</span>
                                <div>
                                    <span className={cn(
                                        "font-bold",
                                        estimates.efficiency_metrics.status === 'Optimal' ? "text-green-500" :
                                            estimates.efficiency_metrics.status === 'Inefficient' ? "text-red-500" : "text-yellow-500"
                                    )}>
                                        {((estimates.efficiency_metrics?.achieved || 0) * 100).toFixed(0)}%
                                    </span>
                                    <span className="text-muted-foreground ml-1">
                                        / {((estimates.efficiency_metrics?.target || 0) * 100).toFixed(0)}%
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="rounded-lg border p-4 bg-secondary/10 text-center text-xs text-muted-foreground">
                    {isLoadingEstimates ? "Calculating estimates..." : "Configure Admin Parameters to see estimates"}
                </div>
            )}
        </div>
    );
}



export function FeasibilityDashboard() {
    const selectedBuilding = useSelectedBuilding();
    // Also use selectedPlot or Project if no building selected?
    // The panel is "Feasibility Dashboard", normally Project Level.
    const activeProject = useBuildingStore(state => state.projects.find(p => p.id === state.activeProjectId));
    const uiState = useBuildingStore(state => state.uiState);
    const setOpen = useBuildingStore(state => state.actions.setFeasibilityPanelOpen);

    // Default to open if not set
    const isOpen = uiState.isFeasibilityPanelOpen ?? true;

    if (!activeProject) return null;

    const cardClasses = "bg-background/95 backdrop-blur-md border border-border shadow-2xl";

    return (
        <div className={cn(
            "absolute bottom-0 left-0 right-0 z-40 overflow-hidden transition-all duration-300 ease-in-out",
            isOpen ? "h-[45vh]" : "h-[50px] hover:h-[60px]"
        )}>
            <Card className={`${cardClasses} w-full h-full rounded-none border-x-0 border-b-0 flex flex-col`}>
                <CardHeader className="flex flex-row items-center justify-between p-3 pb-2 h-[50px] shrink-0 border-b border-border/10">
                    <div className="flex items-center gap-2">
                        <CardTitle className="text-sm font-bold">{activeProject.name} Feasibility</CardTitle>
                        <Badge variant="secondary" className="text-xs font-normal">KPIs & Regulations</Badge>
                    </div>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-muted" onClick={() => setOpen(!isOpen)}>
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                    </Button>
                </CardHeader>

                {/* Content Area - Only render/visible when open to save performance */}
                <div className={cn(
                    "flex-1 min-h-0 w-full transition-opacity duration-300",
                    isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                )}>
                    {isOpen && (
                        <CardContent className="p-0 h-full">
                            <Tabs defaultValue="feasibility" className="flex flex-col h-full w-full">
                                <div className="px-4 pt-2 shrink-0">
                                    <TabsList className="grid w-full grid-cols-2">
                                        <TabsTrigger value="feasibility">Dashboard</TabsTrigger>
                                        <TabsTrigger value="metrics">Detailed KPIs</TabsTrigger>
                                    </TabsList>
                                </div>

                                <div className="flex-1 min-h-0 overflow-hidden relative">
                                    <TabsContent value="metrics" className="h-full m-0 p-4 pt-2 overflow-y-auto">
                                        <MetricsTab />
                                    </TabsContent>
                                    <TabsContent value="feasibility" className="h-full m-0 p-4 pt-2 overflow-y-auto">
                                        <FeasibilityTab />
                                    </TabsContent>
                                </div>
                            </Tabs>
                        </CardContent>
                    )}
                </div>
            </Card>
        </div>
    );
}
