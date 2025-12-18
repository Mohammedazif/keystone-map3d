
'use client';
import { Button } from '@/components/ui/button';
import { useBuildingStore, type DrawingObjectType } from '@/hooks/use-building-store';
import { useToast } from '@/hooks/use-toast';
import { Building2, LandPlot, Map, WandSparkles, Cuboid } from 'lucide-react';
import React from 'react';
import { AiGeneratorModal } from './ai-generator-modal';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { AiMassingModal } from './ai-massing-modal';

export function DrawingToolbar() {
    const { actions, drawingState, plots, selectedObjectId } = useBuildingStore(s => ({
        actions: s.actions,
        drawingState: s.drawingState,
        plots: s.plots,
        selectedObjectId: s.selectedObjectId
    }));
    const { toast } = useToast();

    const handleToolClick = (tool: DrawingObjectType) => {
        if (tool !== 'Plot' && plots.length === 0) {
            toast({
                variant: 'destructive',
                title: 'No Plot Available',
                description: 'Please create a plot before adding other objects.',
            });
            return;
        }

        const activePlotId = plots.length > 0 ? plots.sort((a, b) => new Date(b.id.split('-')[1]).getTime() - new Date(a.id.split('-')[1]).getTime())[0].id : null;
        actions.startDrawing(tool, activePlotId);
    }

    const tools: { name: DrawingObjectType, icon: React.ElementType, tooltip: string }[] = [
        { name: 'Plot', icon: Map, tooltip: 'Draw Plot Boundary' },
        { name: 'Zone', icon: LandPlot, tooltip: 'Draw Custom Zone' },
        { name: 'Building', icon: Building2, tooltip: 'Draw Building' },
    ];

    const isPlotSelected = selectedObjectId?.type === 'Plot';

    return (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
            <div className="flex gap-2 bg-background/80 backdrop-blur-sm p-2 rounded-lg border border-border shadow-md">
                <TooltipProvider>
                    {tools.map(tool => (
                        <Tooltip key={tool.name}>
                            <TooltipTrigger asChild>
                                <Button
                                    size="icon"
                                    variant={drawingState.objectType === tool.name ? 'default' : 'ghost'}
                                    onClick={() => handleToolClick(tool.name)}
                                    disabled={drawingState.isDrawing && drawingState.objectType !== tool.name}
                                >
                                    <tool.icon className="h-5 w-5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                                <p>{tool.tooltip}</p>
                            </TooltipContent>
                        </Tooltip>
                    ))}
                    <div className="h-10 border-l border-border mx-2"></div>
                     <Tooltip>
                        <TooltipTrigger asChild>
                           <div><AiGeneratorModal /></div>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            <p>AI Site Layout Generator (2D)</p>
                        </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div><AiMassingModal /></div>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            <p>AI Massing Generator (3D)</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
        </div>
    )
}
