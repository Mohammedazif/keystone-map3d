
'use client';
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { useBuildingStore } from '@/hooks/use-building-store';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { BuildingIntendedUse, UtilityType } from '@/lib/types';
import { LandPlot } from 'lucide-react';

type ZoneType = 'BuildableArea' | 'GreenArea' | 'ParkingArea' | 'UtilityArea';

export function DefineZoneModal() {
    const { zoneDefinition, actions } = useBuildingStore();
    const [zoneName, setZoneName] = useState('');
    const [zoneType, setZoneType] = useState<ZoneType>('BuildableArea');
    const [intendedUse, setIntendedUse] = useState<BuildingIntendedUse>(BuildingIntendedUse.Residential);
    const [utilityType, setUtilityType] = useState<UtilityType>(UtilityType.STP);

    useEffect(() => {
        if (zoneDefinition.isDefining) {
            // Reset state when modal opens
            setZoneName('');
            setZoneType('BuildableArea');
            setIntendedUse(BuildingIntendedUse.Residential);
            setUtilityType(UtilityType.STP);
        }
    }, [zoneDefinition.isDefining]);

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            actions.cancelDefineZone();
        }
    };

    const handleDefineZone = () => {
        if (!zoneName.trim()) return;
        const use = zoneType === 'BuildableArea' ? intendedUse : undefined;
        const uType = zoneType === 'UtilityArea' ? utilityType : undefined;
        actions.defineZone(zoneName, zoneType, use, uType);
    }

    const buildingUses = Object.values(BuildingIntendedUse);

    return (
        <Dialog open={zoneDefinition.isDefining} onOpenChange={handleOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <LandPlot className="text-primary" />
                        Define New Zone
                    </DialogTitle>
                    <DialogDescription>
                        Give this new zone a name and select its type. This will provide context for building and AI generation.
                    </DialogDescription>
                </DialogHeader>
                <div className='py-4 space-y-4'>
                    <div>
                        <Label htmlFor="zone-name">Zone Name</Label>
                        <Input
                            id="zone-name"
                            placeholder="e.g., 'Residential Block A', 'Main Park'"
                            value={zoneName}
                            onChange={(e) => setZoneName(e.target.value)}
                        />
                    </div>
                    <div>
                        <Label htmlFor="zone-type">Zone Type</Label>
                        <Select value={zoneType} onValueChange={(v) => setZoneType(v as ZoneType)}>
                            <SelectTrigger id="zone-type">
                                <SelectValue placeholder="Select zone type..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="BuildableArea">Buildable Area</SelectItem>
                                <SelectItem value="GreenArea">Green Area</SelectItem>
                                <SelectItem value="ParkingArea">Parking Area</SelectItem>
                                <SelectItem value="UtilityArea">Utility Area</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {zoneType === 'UtilityArea' && (
                        <div>
                            <Label htmlFor="utility-type">Utility Type</Label>
                            <Select value={utilityType} onValueChange={(v) => setUtilityType(v as UtilityType)}>
                                <SelectTrigger id="utility-type">
                                    <SelectValue placeholder="Select utility type..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.values(UtilityType).map(type => (
                                        <SelectItem key={type} value={type}>
                                            {type}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    {zoneType === 'BuildableArea' && (
                        <div>
                            <Label htmlFor="intended-use">Intended Use</Label>
                            <Select value={intendedUse} onValueChange={(v) => setIntendedUse(v as BuildingIntendedUse)}>
                                <SelectTrigger id="intended-use">
                                    <SelectValue placeholder="Select intended use..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {buildingUses.map(use => (
                                        <SelectItem key={use} value={use}>
                                            {use.replace(/([A-Z])/g, ' $1').trim()}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button onClick={handleDefineZone} disabled={!zoneName.trim()}>
                        Create Zone
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
