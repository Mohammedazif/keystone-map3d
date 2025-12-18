
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
    
    const renderObject = (obj: {id: string; name: string}, type: 'Building' | 'GreenArea' | 'ParkingArea' | 'BuildableArea') => {
        let Icon;
        switch(type) {
            case 'Building': Icon = Building2; break;
            case 'GreenArea': Icon = Trees; break;
            case 'ParkingArea': Icon = Car; break;
            case 'BuildableArea': Icon = LandPlot; break;
            default: Icon = Building2;
        }
        
        const isSelected = selectedObjectId?.id === obj.id && selectedObjectId?.type === type;
        return (
            <div key={obj.id} className={cn("flex items-center justify-between p-2 rounded-md transition-colors", isSelected ? 'bg-primary/20' : 'hover:bg-muted')}>
                <button onClick={() => actions.selectObject(obj.id, type)} className="flex-1 text-left text-sm flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary" />
                    {obj.name}
                </button>
                <div className="flex items-center">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => actions.deleteObject(plot.id, obj.id, type)}>
                        <Trash2 className="h-4 w-4 text-destructive"/>
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
                            {isOpen ? <ChevronDown className='h-4 w-4'/> : <ChevronRight className='h-4 w-4'/>}
                        </Button>
                    </CollapsibleTrigger>
                    <button onClick={() => actions.selectObject(plot.id, 'Plot')} className="flex-1 text-left">
                        <span className='font-medium text-sm'>{plot.name}</span>
                    </button>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => actions.deletePlot(plot.id)}>
                    <Trash2 className="h-4 w-4 text-destructive"/>
                </Button>
            </div>
            <CollapsibleContent>
                <div className='p-2 space-y-2'>
                    {buildableAreas.map(b => renderObject(b, 'BuildableArea'))}
                    {plot.buildings.map(b => renderObject(b, 'Building'))}
                    {plot.greenAreas.map(g => renderObject(g, 'GreenArea'))}
                    {plot.parkingAreas.map(p => renderObject(p, 'ParkingArea'))}

                    {plot.buildings.length === 0 && plot.greenAreas.length === 0 && plot.parkingAreas.length === 0 && buildableAreas.length === 0 &&(
                        <p className='text-xs text-center text-muted-foreground p-2'>This plot is empty.</p>
                    )}
                </div>
            </CollapsibleContent>
        </Collapsible>
    )
}

export function ProjectExplorer() {
    const { plots } = useBuildingStore(s => ({
        plots: s.plots
    }));
    
    if (plots.length === 0) return null;

    return (
       <div className='w-80'>
            <Card className="bg-background/80 backdrop-blur-sm">
                <CardHeader>
                    <CardTitle>Project Explorer</CardTitle>
                </CardHeader>
                <CardContent>
                     <ScrollArea className="h-96">
                        <div className="space-y-2 pr-2">
                            {plots.map(plot => <PlotItem key={plot.id} plot={plot}/>)}
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>
       </div>
    )
}
