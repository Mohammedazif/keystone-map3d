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
                {/* Note: CardContent has p-6 by default. If embedded, we probably want minimal padding or handle it in parent. 
                   I'll assume parent adds padding. But let's check content. 
                   Original CardContent had className="space-y-4". 
               */}
                <div className={cn("space-y-4", embedded ? "p-3" : "")}>
                    <div className="space-y-2">
                        <div className="flex justify-between items-center text-sm">
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <LandPlot className="h-4 w-4 text-primary" />
                                <span>Plot Area</span>
                            </div>
                            <div className="font-mono text-xs">
                                {consumedPlotArea.toFixed(2)}m²
                            </div>
                        </div>
                        <Progress value={plotUsagePercentage} />
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between items-center text-sm">
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Scale className="h-4 w-4 text-primary" />
                                <span>Gross Floor Area (FAR: {far.toFixed(2)})</span>
                            </div>
                            <div className="font-mono text-xs">
                                {consumedBuildableArea.toFixed(2)} / {totalBuildableArea.toFixed(2)} m²
                            </div>
                        </div>
                        <Progress value={gfaUsagePercentage} />
                    </div>
                </div>
            </div>
        </Container>
    );
}
