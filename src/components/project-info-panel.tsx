'use client';

import { useProjectData } from '@/hooks/use-building-store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Scale, LandPlot } from 'lucide-react';
import { Progress } from './ui/progress';
import { cn } from '@/lib/utils';

export function ProjectInfoPanel({ embedded = false }: { embedded?: boolean }) {
    const projectData = useProjectData();

    if (!projectData) {
        return null;
    }

    const {
        totalPlotArea = 0,
        consumedPlotArea = 0,
        far = 0,
        totalBuildableArea = 0,
        consumedBuildableArea = 0
    } = projectData;

    const plotUsagePercentage = totalPlotArea > 0 ? (consumedPlotArea / totalPlotArea) * 100 : 0;
    const gfaUsagePercentage = totalBuildableArea > 0 ? (consumedBuildableArea / totalBuildableArea) * 100 : 0;

    const isPlotExceeded = totalPlotArea > 0 && consumedPlotArea > totalPlotArea;
    const isGfaExceeded = totalBuildableArea > 0 && consumedBuildableArea > totalBuildableArea;

    const Container = embedded ? 'div' : Card;

    return (
        <Container className={cn("w-full", embedded ? "" : "bg-background/80 backdrop-blur-sm")}>
            {!embedded && (
                <CardHeader>
                    <CardTitle>Project Constraints</CardTitle>
                    <CardDescription>FAR & Area Utilization</CardDescription>
                </CardHeader>
            )}
            <div className={cn(embedded ? "" : "p-6 pt-0 space-y-4")}>
                <div className={cn("space-y-2.5", embedded ? "px-3 py-2" : "")}>
                    <div className="space-y-1">
                        <div className="flex justify-between items-center text-xs">
                            <div className={cn("flex items-center gap-1.5", isPlotExceeded ? "text-red-500 font-medium" : "text-muted-foreground")}>
                                <LandPlot className={cn("h-3.5 w-3.5", isPlotExceeded ? "text-red-500" : "text-primary")} />
                                <span>Plot Area</span>
                            </div>
                            <div className={cn("font-mono text-[10px]", isPlotExceeded && "text-red-500 font-bold")}>
                                {consumedPlotArea.toFixed(0)} / {totalPlotArea.toFixed(0)} m²
                            </div>
                        </div>
                        <Progress value={plotUsagePercentage} className="h-1.5" indicatorClassName={isPlotExceeded ? "bg-red-500" : undefined} />
                    </div>
                    <div className="space-y-1">
                        <div className="flex justify-between items-center text-xs">
                            <div className={cn("flex items-center gap-1.5", isGfaExceeded ? "text-red-500 font-medium" : "text-muted-foreground")}>
                                <Scale className={cn("h-3.5 w-3.5", isGfaExceeded ? "text-red-500" : "text-primary")} />
                                <span>GFA <span className="text-[10px]">(FAR {far.toFixed(2)})</span></span>
                            </div>
                            <div className={cn("font-mono text-[10px]", isGfaExceeded && "text-red-500 font-bold")}>
                                {consumedBuildableArea.toFixed(0)} / {totalBuildableArea.toFixed(0)} m²
                            </div>
                        </div>
                        <Progress value={gfaUsagePercentage} className="h-1.5" indicatorClassName={isGfaExceeded ? "bg-red-500" : undefined} />
                    </div>
                </div>
            </div>
        </Container>
    );
}
