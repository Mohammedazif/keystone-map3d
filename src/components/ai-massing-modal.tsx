
'use client';
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from './ui/dialog';
import { Button } from './ui/button';
import { useBuildingStore, useSelectedPlot } from '@/hooks/use-building-store';
import { Loader2, Cuboid } from 'lucide-react';

export function AiMassingModal() {
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const selectedPlot = useSelectedPlot();
    const { actions, isGeneratingAi } = useBuildingStore(s => ({ actions: s.actions, isGeneratingAi: s.isGeneratingAi }));

    const handleGenerate = async () => {
        if (!selectedPlot) return;
        setIsLoading(true);
        try {
            await actions.runAiMassingGenerator(selectedPlot.id);
            setIsOpen(false); 
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    const loading = isLoading || isGeneratingAi;

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button 
                    size="icon" 
                    variant='ghost'
                    disabled={!selectedPlot}
                >
                    <Cuboid className="h-5 w-5 text-cyan-400" />
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className='flex items-center gap-2'>
                        <Cuboid className='text-cyan-400'/>
                        AI 3D Massing Generator
                    </DialogTitle>
                    <DialogDescription>
                        Generate 3D building massing options for the plot '{selectedPlot?.name}'. The AI will use the plot's geometry and local regulations to create two distinct scenarios.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button onClick={handleGenerate} disabled={loading}>
                        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Cuboid className="mr-2 h-4 w-4" />}
                        Generate Massing Options
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
