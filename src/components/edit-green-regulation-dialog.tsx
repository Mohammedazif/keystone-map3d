'use client';

import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import type { GreenRegulationData } from '@/lib/types';
import { produce } from 'immer';

interface EditGreenRegulationDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    regulation: GreenRegulationData | null;
    onSave: (data: GreenRegulationData) => void;
}

export function EditGreenRegulationDialog({ isOpen, onOpenChange, regulation, onSave }: EditGreenRegulationDialogProps) {
    const [editedData, setEditedData] = useState<GreenRegulationData | null>(regulation);

    useEffect(() => {
        if (isOpen) {
            setEditedData(regulation);
        }
    }, [regulation, isOpen]);

    const handleUpdateThreshold = (
        category: 'sunHours' | 'daylightFactor' | 'windSpeed',
        field: 'min' | 'target',
        value: string
    ) => {
        if (!editedData) return;
        const numValue = value === '' ? undefined : parseFloat(value);

        setEditedData(produce(editedData, draft => {
            if (!draft.analysisThresholds) {
                draft.analysisThresholds = {};
            }
            if (!draft.analysisThresholds[category]) {
                draft.analysisThresholds[category] = { min: 0, target: 0 };
            }
            if (numValue !== undefined && !isNaN(numValue)) {
                draft.analysisThresholds[category]![field] = numValue;
            }
        }));
    };

    const handleUpdateConstraint = (field: keyof GreenRegulationData['constraints'], value: string) => {
        if (!editedData) return;
        const numValue = value === '' ? undefined : parseFloat(value);
        const finalValue = numValue !== undefined ? numValue / 100 : undefined;

        setEditedData(produce(editedData, draft => {
            if (finalValue !== undefined && !isNaN(finalValue)) {
                draft.constraints[field] = finalValue;
            } else {
                delete draft.constraints[field];
            }
        }));
    };

    const handleSave = () => {
        if (editedData) {
            onSave(editedData);
            onOpenChange(false);
        }
    };

    if (!editedData) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Edit Green Regulation</DialogTitle>
                    <DialogDescription>
                        Manually adjust analysis thresholds and constraints for {editedData.name}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                    {/* Analysis Thresholds */}
                    <div className="space-y-4">
                        <Label className="text-sm font-semibold">Analysis Thresholds</Label>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2 p-3 border rounded-md bg-secondary/20">
                                <Label htmlFor="sunHoursMin" className='text-xs font-semibold uppercase text-muted-foreground'>
                                    Min Sun Hours
                                </Label>
                                <Input
                                    id="sunHoursMin"
                                    type="number"
                                    step="0.5"
                                    placeholder="e.g. 2"
                                    value={editedData.analysisThresholds?.sunHours?.min ?? ''}
                                    onChange={(e) => handleUpdateThreshold('sunHours', 'min', e.target.value)}
                                />
                            </div>
                            <div className="space-y-2 p-3 border rounded-md bg-secondary/20">
                                <Label htmlFor="sunHoursTarget" className='text-xs font-semibold uppercase text-muted-foreground'>
                                    Target Sun Hours
                                </Label>
                                <Input
                                    id="sunHoursTarget"
                                    type="number"
                                    step="0.5"
                                    placeholder="e.g. 4"
                                    value={editedData.analysisThresholds?.sunHours?.target ?? ''}
                                    onChange={(e) => handleUpdateThreshold('sunHours', 'target', e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2 p-3 border rounded-md bg-secondary/20">
                                <Label htmlFor="daylightFactorMin" className='text-xs font-semibold uppercase text-muted-foreground'>
                                    Min Daylight Factor
                                </Label>
                                <Input
                                    id="daylightFactorMin"
                                    type="number"
                                    step="0.01"
                                    placeholder="e.g. 0.02"
                                    value={editedData.analysisThresholds?.daylightFactor?.min ?? ''}
                                    onChange={(e) => handleUpdateThreshold('daylightFactor', 'min', e.target.value)}
                                />
                            </div>
                            <div className="space-y-2 p-3 border rounded-md bg-secondary/20">
                                <Label htmlFor="daylightFactorTarget" className='text-xs font-semibold uppercase text-muted-foreground'>
                                    Target Daylight Factor
                                </Label>
                                <Input
                                    id="daylightFactorTarget"
                                    type="number"
                                    step="0.01"
                                    placeholder="e.g. 0.04"
                                    value={editedData.analysisThresholds?.daylightFactor?.target ?? ''}
                                    onChange={(e) => handleUpdateThreshold('daylightFactor', 'target', e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2 p-3 border rounded-md bg-secondary/20">
                                <Label htmlFor="windSpeedMin" className='text-xs font-semibold uppercase text-muted-foreground'>
                                    Min Wind Speed (m/s)
                                </Label>
                                <Input
                                    id="windSpeedMin"
                                    type="number"
                                    step="0.1"
                                    placeholder="e.g. 1"
                                    value={editedData.analysisThresholds?.windSpeed?.min ?? ''}
                                    onChange={(e) => handleUpdateThreshold('windSpeed', 'min', e.target.value)}
                                />
                            </div>
                            <div className="space-y-2 p-3 border rounded-md bg-secondary/20">
                                <Label htmlFor="windSpeedTarget" className='text-xs font-semibold uppercase text-muted-foreground'>
                                    Target Wind Speed (m/s)
                                </Label>
                                <Input
                                    id="windSpeedTarget"
                                    type="number"
                                    step="0.1"
                                    placeholder="e.g. 2"
                                    value={editedData.analysisThresholds?.windSpeed?.target ?? ''}
                                    onChange={(e) => handleUpdateThreshold('windSpeed', 'target', e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Site Constraints */}
                    <div className="space-y-4">
                        <Label className="text-sm font-semibold">Site Constraints</Label>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="space-y-2 p-3 border rounded-md bg-secondary/20">
                                <Label htmlFor="minOpenSpace" className='text-xs font-semibold uppercase text-muted-foreground'>
                                    Min Open Space (%)
                                </Label>
                                <Input
                                    id="minOpenSpace"
                                    type="number"
                                    placeholder="e.g. 30"
                                    value={editedData.constraints.minOpenSpace !== undefined && editedData.constraints.minOpenSpace !== null ? (editedData.constraints.minOpenSpace * 100).toFixed(0) : ''}
                                    onChange={(e) => handleUpdateConstraint('minOpenSpace', e.target.value)}
                                />
                            </div>
                            <div className="space-y-2 p-3 border rounded-md bg-secondary/20">
                                <Label htmlFor="maxGroundCoverage" className='text-xs font-semibold uppercase text-muted-foreground'>
                                    Max Coverage (%)
                                </Label>
                                <Input
                                    id="maxGroundCoverage"
                                    type="number"
                                    placeholder="e.g. 40"
                                    value={editedData.constraints.maxGroundCoverage !== undefined && editedData.constraints.maxGroundCoverage !== null ? (editedData.constraints.maxGroundCoverage * 100).toFixed(0) : ''}
                                    onChange={(e) => handleUpdateConstraint('maxGroundCoverage', e.target.value)}
                                />
                            </div>
                            <div className="space-y-2 p-3 border rounded-md bg-secondary/20">
                                <Label htmlFor="minGreenCover" className='text-xs font-semibold uppercase text-muted-foreground'>
                                    Min Green Cover (%)
                                </Label>
                                <Input
                                    id="minGreenCover"
                                    type="number"
                                    placeholder="e.g. 20"
                                    value={editedData.constraints.minGreenCover !== undefined && editedData.constraints.minGreenCover !== null ? (editedData.constraints.minGreenCover * 100).toFixed(0) : ''}
                                    onChange={(e) => handleUpdateConstraint('minGreenCover', e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-2 pt-4">
                        <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
                            Cancel
                        </Button>
                        <Button onClick={handleSave} className="flex-1">
                            Save Changes
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
