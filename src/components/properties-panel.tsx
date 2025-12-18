
'use client';
import React from 'react';
import { useBuildingStore, useSelectedBuilding, useSelectedPlot } from '@/hooks/use-building-store';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { BuildingIntendedUse, type Floor, type Plot, type BuildableArea } from '@/lib/types';
import { Button } from './ui/button';
import { Plus, Trash2, X, Info, WandSparkles, Loader2 } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { useProjectData } from '@/hooks/use-building-store';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from './ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';


function BuildingProperties() {
    const { actions } = useBuildingStore();
    const selectedBuilding = useSelectedBuilding();
    const selectedPlot = useSelectedPlot();
    const projectData = useProjectData();

    if (!selectedBuilding || !selectedPlot) return null;

    const regulation = selectedPlot.regulation;

    const handleFloorCountChange = (newCount: number | '') => {
        actions.updateBuilding(selectedBuilding.id, { numFloors: newCount === '' ? 1 : newCount });
    };

    const handleTypicalFloorHeightChange = (newHeight: number | '') => {
        actions.updateBuilding(selectedBuilding.id, { typicalFloorHeight: newHeight === '' ? 3 : newHeight });
    };

    const totalGFA = (projectData?.totalBuildableArea ?? 0);
    const consumedGFA = (projectData?.consumedBuildableArea ?? 0);
    const currentBuildingGFA = selectedBuilding.area * selectedBuilding.floors.length;
    const remainingGFA = totalGFA - (consumedGFA - currentBuildingGFA);

    const newBuildingGFA = selectedBuilding.area * (selectedBuilding.numFloors ?? selectedBuilding.floors.length);
    const isOverLimit = newBuildingGFA > remainingGFA;


    return (
        <div className='space-y-4'>
            <div className='p-3 bg-secondary rounded-md space-y-2 text-sm'>
                <div className='flex justify-between'>
                    <span className='text-muted-foreground'>Footprint Area:</span>
                    <span className='font-mono'>{selectedBuilding.area.toFixed(2)} m²</span>
                </div>
                 <div className={cn('flex justify-between', isOverLimit ? 'text-destructive' : 'text-muted-foreground')}>
                    <span className=''>Gross Floor Area (GFA):</span>
                    <span className='font-mono'>{newBuildingGFA.toFixed(2)} m²</span>
                </div>
                 <div className='flex justify-between text-xs'>
                    <span className='text-muted-foreground'>Remaining Project GFA:</span>
                    <span className='font-mono'>{(remainingGFA - newBuildingGFA).toFixed(2)} m²</span>
                </div>
                 {isOverLimit && (
                    <div className="flex items-center gap-2 text-xs text-destructive pt-2">
                        <AlertTriangle className="h-4 w-4 shrink-0"/>
                        <span>Exceeds project's remaining GFA.</span>
                    </div>
                )}
            </div>

            <div>
                <Label htmlFor="name" className="text-sm font-medium text-muted-foreground">Building Name</Label>
                <Input id="name" value={selectedBuilding.name} onChange={(e) => actions.updateBuilding(selectedBuilding.id, { name: e.target.value })}/>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
                 <div>
                    <Label htmlFor="num-floors" className="text-sm font-medium text-muted-foreground">Number of Floors</Label>
                    <Input 
                        id="num-floors" 
                        type="number" 
                        value={selectedBuilding.numFloors ?? ''}
                        onChange={(e) => handleFloorCountChange(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                        min="1"
                    />
                </div>
                 <div>
                    <Label htmlFor="floor-height" className="text-sm font-medium text-muted-foreground">Floor Height (m)</Label>
                    <Input
                        id="floor-height"
                        type="number"
                        value={selectedBuilding.typicalFloorHeight ?? ''}
                        onChange={(e) => handleTypicalFloorHeightChange(e.target.value === '' ? '' : parseFloat(e.target.value))}
                        step="0.5"
                         min="1"
                    />
                </div>
            </div>
             <p className='text-xs text-muted-foreground text-center'>
                Total Height: <span className='font-bold text-foreground'>{selectedBuilding.height.toFixed(2)}m</span>
            </p>
            
            <div>
                <Label htmlFor="opacity" className="text-sm font-medium text-muted-foreground">Opacity ({Math.round(selectedBuilding.opacity * 100)}%)</Label>
                <Slider
                    id="opacity"
                    min={0}
                    max={1}
                    step={0.1}
                    value={[selectedBuilding.opacity]}
                    onValueChange={(v) => actions.updateBuilding(selectedBuilding.id, { opacity: v[0] })}
                />
            </div>
            
            <div>
                <Label htmlFor="intendedUse" className="text-sm font-medium text-muted-foreground">Intended Use</Label>
                <Select
                    value={selectedBuilding.intendedUse}
                    onValueChange={(v) => actions.updateBuilding(selectedBuilding.id, { intendedUse: v as BuildingIntendedUse })}
                >
                    <SelectTrigger id="intendedUse">
                        <SelectValue placeholder="Select use..." />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="Residential">Residential</SelectItem>
                        <SelectItem value="Commercial">Commercial</SelectItem>
                        <SelectItem value="Mixed-Use">Mixed-Use</SelectItem>
                        <SelectItem value="Industrial">Industrial</SelectItem>
                        <SelectItem value="Public">Public</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>
    )
}

function PlotProperties() {
    const { actions } = useBuildingStore();
    const selectedPlot = useSelectedPlot();

    if (!selectedPlot) return null;

    const regulation = selectedPlot.regulation;
    const setbackRules = regulation?.geometry?.setback;

    return (
        <div className='space-y-4'>
            <div>
                <Label htmlFor="plot-name" className="text-sm font-medium text-muted-foreground">Plot Name</Label>
                <Input id="plot-name" value={selectedPlot.name} onChange={(e) => actions.updatePlot(selectedPlot.id, { name: e.target.value })}/>
            </div>
            {selectedPlot.location && (
                <div className='p-3 bg-secondary rounded-md text-sm text-center'>
                    <span className='text-muted-foreground'>Location: </span>
                    <span className='font-semibold'>{selectedPlot.location}</span>
                     {!regulation && (
                        <p className='text-xs text-amber-500 flex items-center justify-center gap-1 mt-1'>
                            <Info className='h-3 w-3'/> No local regulations found. Using defaults.
                        </p>
                    )}
                </div>
            )}
            <div>
                <Label htmlFor="plot-setback" className="text-sm font-medium text-muted-foreground">Setback ({selectedPlot.setback}m)</Label>
                <Slider
                    id="plot-setback"
                    min={setbackRules?.min ?? 0}
                    max={setbackRules?.max ?? 50}
                    step={1}
                    value={[selectedPlot.setback]}
                    onValueChange={(v) => actions.updatePlot(selectedPlot.id, { setback: v[0] })}
                />
            </div>
        </div>
    )
}

function ZoneProperties() {
    const { actions, selectedObjectId, plots } = useBuildingStore(s => ({
        actions: s.actions,
        selectedObjectId: s.selectedObjectId,
        plots: s.plots
    }));

    if (!selectedObjectId) return null;
    
    let object: BuildableArea | undefined;
    let objectName = '';
    
    for (const plot of plots) {
        const found = [
            ...plot.greenAreas,
            ...plot.parkingAreas,
            ...plot.buildableAreas
        ].find(obj => obj.id === selectedObjectId.id);
        if (found) {
            object = found as BuildableArea;
            objectName = found.name;
            break;
        }
    }
    
    if (!object) return null;

    const handleNameChange = (newName: string) => {
        actions.updateObject(selectedObjectId.id, selectedObjectId.type, { name: newName });
    }

    return (
        <div className="space-y-4 pt-4">
            <div>
                <Label htmlFor="zone-name" className="text-sm font-medium text-muted-foreground">Zone Name</Label>
                <Input id="zone-name" value={objectName} onChange={(e) => handleNameChange(e.target.value)} />
            </div>
            <p className='text-sm text-muted-foreground text-center p-4'>This is a 2D area. You can use the AI generator to populate it or draw buildings inside.</p>
        </div>
    );
}


function getSelectionDetails(selectedObjectId: {type: string, id: string} | null, plots: any[]) {
    if (!selectedObjectId) return {name: 'Properties', type: ''};

    const { type, id } = selectedObjectId;
    let name = '';
    
    if (type === 'Plot') {
        const plot = plots.find(p => p.id === id);
        name = plot?.name;
    } else {
        for (const plot of plots) {
            if (type === 'Building') {
                const building = plot.buildings.find((b: any) => b.id === id);
                if (building) { name = building.name; break; }
            } else if (type === 'GreenArea') {
                 const greenArea = plot.greenAreas.find((g: any) => g.id === id);
                if (greenArea) { name = greenArea.name; break; }
            } else if (type === 'ParkingArea') {
                const parkingArea = plot.parkingAreas.find((p: any) => p.id === id);
                if (parkingArea) { name = parkingArea.name; break; }
            } else if (type === 'BuildableArea') {
                const buildableArea = plot.buildableAreas.find((b: any) => b.id === id);
                if (buildableArea) { name = buildableArea.name; break; }
            }
        }
    }
    
    return { name, type };
}


export function PropertiesPanel() {
  const { selectedObjectId, actions, plots } = useBuildingStore();

  if (!selectedObjectId) return null;
  
  const {name, type} = getSelectionDetails(selectedObjectId, plots);

  return (
    <Card className="bg-background/80 backdrop-blur-sm">
        <CardHeader className='flex-row items-center justify-between'>
           <div>
            <CardTitle className='text-lg'>{name}</CardTitle>
            <CardDescription>{type} Properties</CardDescription>
           </div>
           <Button size="icon" variant="ghost" onClick={() => actions.selectObject(null, null)}>
              <X className='h-4 w-4'/>
           </Button>
        </CardHeader>
        <CardContent className="space-y-6">
            { selectedObjectId.type === 'Building' && <BuildingProperties/> }
            { selectedObjectId.type === 'Plot' && <PlotProperties /> }
            { (selectedObjectId.type === 'GreenArea' || selectedObjectId.type === 'ParkingArea' || selectedObjectId.type === 'BuildableArea') && <ZoneProperties />}
        </CardContent>
    </Card>
  );
}
