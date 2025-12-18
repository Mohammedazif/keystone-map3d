'use client';
import React from 'react';
import { useBuildingStore } from '@/hooks/use-building-store';
import { Button } from '@/components/ui/button';
import { Building, X } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';

export function DrawingStatus() {
    const { drawingState, drawingPoints, actions } = useBuildingStore(s => ({
        drawingState: s.drawingState,
        drawingPoints: s.drawingPoints,
        actions: s.actions,
    }));

    if (!drawingState.isDrawing) {
        return null;
    }

    const canFinish = drawingPoints.length > 2;

    return (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20">
            <Card className="bg-background/80 backdrop-blur-sm">
                <CardHeader>
                    <CardTitle className='text-base font-medium flex items-center gap-3'>
                        <span>Drawing a new {drawingState.objectType}</span>
                        <Button variant="ghost" size="icon" className='h-6 w-6' onClick={actions.resetDrawing}>
                            <X className='h-4 w-4'/>
                        </Button>
                    </CardTitle>
                </CardHeader>
                <CardContent className='flex items-center gap-4'>
                    <p className="text-sm text-muted-foreground text-center">
                        Click on the map to add points.
                        {drawingPoints.length > 0 && drawingPoints.length < 3 && ` (Need ${3 - drawingPoints.length} more)`}
                        {canFinish && ' Click the first point to finish.'}
                    </p>
                    {canFinish && (
                         <Button size="sm" onClick={() => window.dispatchEvent(new CustomEvent('closePolygon'))}>
                            <Building className="mr-2 h-4 w-4"/> Create {drawingState.objectType}
                        </Button>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
