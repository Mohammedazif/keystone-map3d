
'use client';
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from './ui/dialog';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { useBuildingStore, useSelectedPlot } from '@/hooks/use-building-store';
import { Loader2, WandSparkles } from 'lucide-react';
import { Label } from './ui/label';

export function AiGeneratorModal() {
    const [prompt, setPrompt] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const selectedPlot = useSelectedPlot();
    const { actions } = useBuildingStore();

    const handleGenerate = async () => {
        if (!selectedPlot || !prompt.trim()) return;

        setIsLoading(true);
        try {
            await actions.runAiLayoutGenerator(selectedPlot.id, prompt);
            setIsOpen(false); // Close prompt modal on success, scenario viewer will open
            setPrompt('');
        } catch (error) {
            // Toast is handled in the store action, but we catch here to stop loading
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button 
                    size="icon" 
                    variant='ghost'
                    disabled={!selectedPlot}
                >
                    <WandSparkles className="h-5 w-5 text-purple-400" />
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className='flex items-center gap-2'>
                        <WandSparkles className='text-purple-400'/>
                        AI Site Layout Generator
                    </DialogTitle>
                    <DialogDescription>
                        Describe the layout you want to generate for '{selectedPlot?.name}'. 
                        Mention buildings, parks, parking, and how many of each. The AI will create zones first if they don't exist.
                    </DialogDescription>
                </DialogHeader>
                <div className='py-4 space-y-4'>
                    <div>
                        <Label htmlFor="ai-prompt">Your Requirements</Label>
                        <Textarea
                            id="ai-prompt"
                            placeholder="e.g., 'Three buildable zones for residential towers, a large park in the center, and two parking areas on the east side.'"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            className="min-h-[120px]"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleGenerate} disabled={isLoading || !prompt.trim()}>
                        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <WandSparkles className="mr-2 h-4 w-4" />}
                        Generate Scenarios
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
