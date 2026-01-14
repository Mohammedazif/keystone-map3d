
'use client';
import React from 'react';
import {
    Building2,
    Trees,
    Car,
    ChevronDown,
    ChevronRight,
    LandPlot,
    Trash2,
    Zap,
    Fan,
    ArrowDownToLine,
    Layers
} from 'lucide-react';
import { useBuildingStore } from '@/hooks/use-building-store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ScrollArea } from './ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';


function PlotItem({ plot }: { plot: import('@/lib/types').Plot }) {
    const { actions, selectedObjectId } = useBuildingStore(s => ({
        actions: s.actions,
        selectedObjectId: s.selectedObjectId
    }));
    const [isOpen, setIsOpen] = React.useState(true);

    const isPlotSelected = selectedObjectId?.type === 'Plot' && selectedObjectId.id === plot.id;

    const renderObject = (obj: any, type: 'Building' | 'GreenArea' | 'ParkingArea' | 'BuildableArea' | 'UtilityArea') => {
        let Icon;
        switch (type) {
            case 'Building': Icon = Building2; break;
            case 'GreenArea': Icon = Trees; break;
            case 'ParkingArea': Icon = Car; break;
            case 'BuildableArea': Icon = LandPlot; break;
            case 'UtilityArea': Icon = Zap; break;
            default: Icon = Building2;
        }

        const isSelected = selectedObjectId?.id === obj.id && selectedObjectId?.type === type;
        const info = (type === 'ParkingArea' && obj.capacity) ? <span className="text-xs text-muted-foreground ml-2">({obj.capacity} spots)</span> : null;

        return (
            <div key={obj.id} className={cn("flex items-center justify-between p-2 rounded-md transition-colors", isSelected ? 'bg-primary/20' : 'hover:bg-muted')}>
                <button onClick={() => actions.selectObject(obj.id, type)} className="flex-1 text-left text-sm flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary" />
                    <span>{obj.name}</span>
                    {info}
                </button>
                <div className="flex items-center">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => actions.deleteObject(plot.id, obj.id, type)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                </div>
            </div>
        )
    };

    const buildableAreas = plot.buildableAreas || [];

    return (
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="bg-secondary/30 rounded-lg">
            <div className={cn("flex items-center justify-between p-2 rounded-t-lg transition-colors", isOpen && "border-b border-border/50", isPlotSelected ? 'bg-primary/20' : 'hover:bg-muted/50')}>
                <div className='flex-1 text-left flex items-center gap-2'>
                    <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                            {isOpen ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />}
                        </Button>
                    </CollapsibleTrigger>
                    <button onClick={() => actions.selectObject(plot.id, 'Plot')} className="flex-1 text-left">
                        <span className='font-medium text-sm'>{plot.name}</span>
                    </button>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => actions.deletePlot(plot.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
            </div>
            <CollapsibleContent>
                <div className='p-2 space-y-2'>
                    {buildableAreas.map(b => renderObject(b, 'BuildableArea'))}
                    {plot.buildings.map(b => (
                        <React.Fragment key={b.id}>
                            {renderObject(b, 'Building')}

                            {/* Render Attached Utilities & Parking */}
                            {(b.utilities?.includes('Electrical' as any) || b.floors.some(f => f.utilityType === 'HVAC' || f.type === 'Parking')) && (
                                <div className="pl-8 space-y-1 pb-2">
                                    {b.utilities?.includes('Electrical' as any) && (
                                        <div
                                            className="flex items-center text-xs text-muted-foreground hover:text-primary cursor-pointer transition-colors"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                actions.selectObject(`floor-${b.id}-electrical`, 'Utility' as any);
                                            }}
                                        >
                                            <Zap className="h-3 w-3 mr-2 text-amber-400" />
                                            <span>Electrical Room (Base)</span>
                                        </div>
                                    )}
                                    {b.floors.some(f => f.utilityType === 'HVAC') && (
                                        <div
                                            className="flex items-center text-xs text-muted-foreground hover:text-primary cursor-pointer transition-colors"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                actions.selectObject(`floor-${b.id}-hvac`, 'Utility' as any);
                                            }}
                                        >
                                            <Fan className="h-3 w-3 mr-2 text-blue-400" />
                                            <span>HVAC Plant (Roof)</span>
                                        </div>
                                    )}
                                    {b.floors.filter(f => f.type === 'Parking' && f.parkingType !== 'Stilt' && f.parkingType !== 'Podium').map(f => (
                                        <div
                                            key={f.id}
                                            className="flex items-center text-xs text-muted-foreground hover:text-primary cursor-pointer transition-colors"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                actions.selectObject(f.id, 'Parking' as any);
                                            }}
                                        >
                                            {f.parkingType === 'Basement' ?
                                                <ArrowDownToLine className="h-3 w-3 mr-2 text-slate-500" /> :
                                                (f.parkingType === 'Stilt' ? <Layers className="h-3 w-3 mr-2 text-slate-500" /> : <Car className="h-3 w-3 mr-2 text-slate-500" />)
                                            }
                                            <span>{f.parkingType || 'Basement'} Parking ({f.parkingCapacity || 0})</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </React.Fragment>
                    ))}
                    {plot.greenAreas.map(g => renderObject(g, 'GreenArea'))}
                    {plot.parkingAreas.map(p => renderObject(p, 'ParkingArea'))}
                    {plot.utilityAreas.map(u => renderObject(u, 'UtilityArea'))}

                    {plot.buildings.length === 0 && plot.greenAreas.length === 0 && plot.parkingAreas.length === 0 && buildableAreas.length === 0 && plot.utilityAreas.length === 0 && (
                        <p className='text-xs text-center text-muted-foreground p-2'>This plot is empty.</p>
                    )}
                </div>
            </CollapsibleContent>
        </Collapsible>
    )
}

export function ProjectExplorer({ className, embedded = false }: { className?: string; embedded?: boolean }) {
    const { plots } = useBuildingStore(s => ({
        plots: s.plots
    }));

    // Always render structure even if empty to keep layout stable, or return null if preferred.
    if (plots.length === 0) return null;

    const Container = embedded ? 'div' : Card;

    return (
        <div className={cn('w-full flex-1 min-h-0 flex flex-col', className)}>
            <Container className={cn("flex flex-col h-full", embedded ? "" : "bg-background/80 backdrop-blur-sm border-t-0 rounded-t-none rounded-b-xl shadow-none")}>
                {!embedded && (
                    <CardHeader className="py-2 px-4 border-b">
                        <CardTitle className="text-sm">Project Explorer</CardTitle>
                    </CardHeader>
                )}
                <div className={cn("flex-1 overflow-hidden", embedded ? "" : "p-0")}>
                    {/* If embedded, we might want ScrollArea or just simple div. 
                        Original used ScrollArea. Keep it. 
                        Original content had p-0 on CardContent. */}
                    <ScrollArea className="h-full">
                        <div className="space-y-2 p-3">
                            {plots.map(plot => <PlotItem key={plot.id} plot={plot} />)}
                        </div>
                    </ScrollArea>
                </div>
            </Container>
        </div>
    )
}
