'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useBuildingStore } from '@/hooks/use-building-store';
import { ScenarioThumbnail } from './scenario-thumbnail';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ScenarioSelectorModal() {
    const {
        tempScenarios,
        isGeneratingScenarios,
        designOptions,
        actions
    } = useBuildingStore(state => ({
        tempScenarios: state.tempScenarios,
        isGeneratingScenarios: state.isGeneratingScenarios,
        designOptions: state.designOptions,
        actions: state.actions,
    }));

    const isOpen = tempScenarios !== null;

    const handleSelect = (scenarioIndex: number) => {
        if (!tempScenarios) return;
        actions.applyScenario(scenarioIndex);

        // Auto-save the selected scenario with sequential naming
        const nextOptionNumber = designOptions.length + 1;
        const name = `Option ${nextOptionNumber}`;
        const description = "Auto-saved generated scenario";

        actions.saveDesignOption(name, description);

        actions.clearTempScenarios();
    };

    const handleClose = () => {
        actions.clearTempScenarios();
    };

    if (!tempScenarios) return null;

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-xl">Select a Design Scenario</DialogTitle>
                    <DialogDescription>
                        Choose one of the generated design options to apply to your plot
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 py-4">
                    {/* Always render 3 slots */}
                    {[0, 1, 2].map((index) => {
                        const scenario = tempScenarios[index];

                        if (!scenario) {
                            // Skeleton Loader
                            return (
                                <Card key={index} className="group relative overflow-hidden border border-border/40 shadow-sm bg-muted/5">
                                    <div className="w-full h-40 bg-muted/10 animate-pulse flex items-center justify-center">
                                        <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                                    </div>
                                    <div className="p-4 space-y-3">
                                        <div className="h-5 w-1/3 bg-muted/20 rounded animate-pulse" />
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <div className="h-3 w-8 bg-muted/20 rounded animate-pulse" />
                                                <div className="h-4 w-16 bg-muted/20 rounded animate-pulse" />
                                            </div>
                                            <div className="space-y-1">
                                                <div className="h-3 w-8 bg-muted/20 rounded animate-pulse" />
                                                <div className="h-4 w-16 bg-muted/20 rounded animate-pulse" />
                                            </div>
                                            <div className="space-y-1">
                                                <div className="h-3 w-8 bg-muted/20 rounded animate-pulse" />
                                                <div className="h-4 w-16 bg-muted/20 rounded animate-pulse" />
                                            </div>
                                            <div className="space-y-1">
                                                <div className="h-3 w-8 bg-muted/20 rounded animate-pulse" />
                                                <div className="h-4 w-16 bg-muted/20 rounded animate-pulse" />
                                            </div>
                                        </div>
                                        <div className="h-9 w-full bg-muted/10 rounded animate-pulse mt-2" />
                                    </div>
                                </Card>
                            );
                        }

                        // Calculate stats
                        let totalGFA = 0;
                        let totalUnits = 0;

                        scenario.plots.forEach(plot => {
                            plot.buildings.forEach((b: any) => {
                                if (b.visible) {
                                    totalGFA += b.area * (b.numFloors || 1);
                                }
                            });
                        });

                        totalUnits = Math.floor((totalGFA * 0.85) / 70);

                        return (
                            <Card
                                key={index}
                                className="group relative overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-primary/50 hover:shadow-lg"
                                onClick={() => handleSelect(index)}
                            >
                                {/* Thumbnail */}
                                <div className="w-full h-40 bg-muted/20 border-b">
                                    <ScenarioThumbnail
                                        features={scenario.plots.flatMap((p: any) =>
                                            p.buildings.map((b: any) => b.geometry)
                                        )}
                                        roadFeatures={scenario.plots.flatMap((p: any) =>
                                            (p.utilityAreas || []).filter((u: any) => u.type === 'Roads' || u.name.toLowerCase().includes('road')).map((u: any) => u.geometry)
                                        )}
                                        parkingFeatures={scenario.plots.flatMap((p: any) =>
                                            (p.parkingAreas || []).map((pa: any) => pa.geometry)
                                        )}
                                        utilityFeatures={scenario.plots.flatMap((p: any) =>
                                            (p.utilityAreas || []).filter((u: any) => u.type !== 'Roads' && !u.name.toLowerCase().includes('road')).map((u: any) => u.geometry)
                                        )}
                                        greenFeatures={scenario.plots.flatMap((p: any) =>
                                            (p.greenAreas || []).map((ga: any) => ga.geometry)
                                        )}
                                        plotGeometry={scenario.plots[0]?.geometry}
                                        setback={scenario.plots[0]?.setback || 0}
                                        className="w-full h-full !bg-transparent !p-2"
                                    />
                                </div>

                                {/* Info */}
                                <div className="p-4 space-y-3">
                                    <h4 className="font-semibold text-base">Scenario {index + 1}</h4>

                                    {/* KPIs */}
                                    <div className="grid grid-cols-2 gap-3 text-sm">
                                        <div>
                                            <div className="text-xs text-muted-foreground uppercase font-bold">GFA</div>
                                            <div className="font-mono">{Math.round(totalGFA).toLocaleString()} m²</div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-muted-foreground uppercase font-bold">Units</div>
                                            <div className="font-mono">{totalUnits}</div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-muted-foreground uppercase font-bold">Buildings</div>
                                            <div className="font-mono">
                                                {scenario.plots.reduce((sum: number, p: any) => sum + p.buildings.length, 0)}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-muted-foreground uppercase font-bold">Avg. Floors</div>
                                            <div className="font-mono">
                                                {Math.round(
                                                    scenario.plots.reduce((sum: number, p: any) =>
                                                        sum + p.buildings.reduce((s: number, b: any) => s + (b.numFloors || 1), 0), 0
                                                    ) / Math.max(1, scenario.plots.reduce((sum: number, p: any) => sum + p.buildings.length, 0))
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Select Button */}
                                    <Button
                                        variant="default"
                                        size="sm"
                                        className="w-full mt-2"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleSelect(index);
                                        }}
                                    >
                                        <Check className="mr-2 h-4 w-4" />
                                        Select This Option
                                    </Button>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            </DialogContent>
        </Dialog>
    );
}
