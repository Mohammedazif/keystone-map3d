'use client';
import React from 'react';
import { useBuildingStore, useSelectedBuilding, useSelectedPlot } from '@/hooks/use-building-store';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { BuildingIntendedUse, type Floor, type Plot, type BuildableArea, FeasibilityParams, UnitTypology, type UtilityArea, UtilityType, ParkingType } from '@/lib/types';
import { calculateDevelopmentStats, DEFAULT_FEASIBILITY_PARAMS } from '@/lib/development-calc';
import { calculateTotalParkingSpaces } from '@/lib/parking-calc';
import { produce } from 'immer';
import { Button } from './ui/button';
import { Plus, Trash2, X, Info, WandSparkles, Loader2, PieChart, BarChart3, Calculator, PenTool, Zap, AlertTriangle, Fan, Car, Layers, ArrowDownToLine } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { useProjectData } from '@/hooks/use-building-store';
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

    const parkingFloorsCount = selectedBuilding.floors.filter(f => f.type === 'Parking').length;
    const effectiveFloors = (selectedBuilding.numFloors ?? selectedBuilding.floors.length) - parkingFloorsCount;
    const newBuildingGFA = selectedBuilding.area * Math.max(0, effectiveFloors);
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
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>Exceeds project's remaining GFA.</span>
                    </div>
                )}
            </div>

            <div>
                <Label htmlFor="name" className="text-sm font-medium text-muted-foreground">Building Name</Label>
                <Input id="name" value={selectedBuilding.name} onChange={(e) => actions.updateBuilding(selectedBuilding.id, { name: e.target.value })} />
            </div>

            <div className="space-y-4">
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
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => actions.addParkingFloor(selectedBuilding.id, ParkingType.Basement)} className="flex-1">
                        <ArrowDownToLine className="h-4 w-4 mr-2" /> Add Basement
                    </Button>
                    {/* <Button variant="outline" size="sm" onClick={() => actions.addParkingFloor(selectedBuilding.id, ParkingType.Stilt)} className="flex-1">
                        <Layers className="h-4 w-4 mr-2" /> Add Stilt
                    </Button> */}
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

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

function FeasibilitySection({ stats, parkingCount }: { stats: any, parkingCount: number }) {
    if (!stats) return null;

    return (
        <div className="space-y-4 border rounded-md p-3 bg-card">
            <h4 className="font-semibold text-sm flex items-center gap-2">
                <Calculator className="h-4 w-4" /> Feasibility Report
            </h4>

            <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="p-2 bg-secondary rounded flex flex-col">
                    <span className="text-muted-foreground text-xs">Total Units</span>
                    <span className="font-bold text-lg">{stats.units.total}</span>
                </div>
                <div className="p-2 bg-secondary rounded flex flex-col">
                    <span className="text-muted-foreground text-xs">Total Parking</span>
                    <span className="font-bold text-lg">{parkingCount}</span>
                </div>
                <div className="p-2 bg-secondary rounded flex flex-col col-span-2">
                    <span className="text-muted-foreground text-xs">Efficiency</span>
                    <span className="font-bold text-lg">{(stats.efficiency * 100).toFixed(0)}%</span>
                </div>
            </div>

            <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Area Breakdown (sqm)</div>
                <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                        <span>Saleable</span>
                        <span className="font-mono">{stats.areas.saleable}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Core</span>
                        <span className="font-mono">{stats.areas.core}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Circulation</span>
                        <span className="font-mono">{stats.areas.circulation}</span>
                    </div>
                    <Separator className="my-1" />
                    <div className="flex justify-between font-semibold">
                        <span>Total Built-up</span>
                        <span className="font-mono">{stats.totalBuiltUpArea}</span>
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Unit Mix Yield</div>
                <div className="grid grid-cols-2 gap-2">
                    {Object.entries(stats.units.breakdown).map(([type, count]: [string, any]) => (
                        <div key={type} className="flex justify-between items-center text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                            <span>{type}</span>
                            <span className="font-bold">{count}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className='text-[10px] text-muted-foreground text-center pt-2 border-t mt-2'>
                Based on current Plot Area & FAR {stats.achievedFAR}
            </div>
        </div>
    );
}

function UnitMixConfig({ params, onChange }: { params: FeasibilityParams, onChange: (p: FeasibilityParams) => void }) {

    const updateFactor = (key: keyof FeasibilityParams, value: number) => {
        onChange({ ...params, [key]: value });
    };

    const updateUnitMix = (index: number, field: keyof UnitTypology, value: any) => {
        const newMix = produce(params.unitMix, draft => {
            if (field === 'mixRatio') {
                // Determine other items to balance? For now, just set it. 
                // Advanced: Auto-balance other ratios.
                // Simple: Allow user to set, normalize later or assume they sum to 1.
                draft[index].mixRatio = value;
            } else if (field === 'area') {
                draft[index].area = value;
            }
        });
        onChange({ ...params, unitMix: newMix });
    };

    return (
        <div className="space-y-4 pt-2">
            <h4 className="font-semibold text-sm flex items-center gap-2">
                <PenTool className="h-4 w-4" /> Configuration
            </h4>

            <div className="space-y-3">
                <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                        <Label>Core Area Factor</Label>
                        <span className="text-muted-foreground">{(params.coreFactor * 100).toFixed(0)}%</span>
                    </div>
                    <Slider
                        min={0.05} max={0.40} step={0.01}
                        value={[params.coreFactor]}
                        onValueChange={([v]) => updateFactor('coreFactor', v)}
                    />
                </div>
                <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                        <Label>Circulation Factor</Label>
                        <span className="text-muted-foreground">{(params.circulationFactor * 100).toFixed(0)}%</span>
                    </div>
                    <Slider
                        min={0.05} max={0.30} step={0.01}
                        value={[params.circulationFactor]}
                        onValueChange={([v]) => updateFactor('circulationFactor', v)}
                    />
                </div>
            </div>

            <Separator />

            <div className="space-y-2">
                <Label className="text-xs">Unit Typologies Mix</Label>
                {params.unitMix.map((unit, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                        <div className="w-12 text-xs font-bold">{unit.name}</div>
                        <Input
                            type="number"
                            className="h-7 w-16 text-xs p-1"
                            value={unit.area}
                            onChange={(e) => updateUnitMix(idx, 'area', parseFloat(e.target.value))}
                        />
                        <span className="text-[10px] text-muted-foreground">sqm</span>
                        <div className='flex-1'>
                            <Slider
                                min={0} max={1} step={0.1}
                                value={[unit.mixRatio]}
                                onValueChange={([v]) => updateUnitMix(idx, 'mixRatio', v)}
                            />
                        </div>
                        <span className="text-xs w-8 text-right">{(unit.mixRatio * 100).toFixed(0)}%</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

function PlotProperties() {
    const { actions, activeProjectId, projects } = useBuildingStore();
    const selectedPlot = useSelectedPlot();

    const activeProject = projects.find(p => p.id === activeProjectId);

    // Memoize params to avoid recalculation loops, defaulting to constants
    const feasibilityParams = React.useMemo(() => {
        return activeProject?.feasibilityParams || DEFAULT_FEASIBILITY_PARAMS;
    }, [activeProject?.feasibilityParams]);

    const stats = React.useMemo(() => {
        if (!selectedPlot) return null;
        return calculateDevelopmentStats(selectedPlot, feasibilityParams);
    }, [selectedPlot, feasibilityParams]);

    const parkingCount = React.useMemo(() => {
        if (!selectedPlot) return 0;
        return calculateTotalParkingSpaces([selectedPlot]).total;
    }, [selectedPlot]);


    if (!selectedPlot) return null;

    const regulation = selectedPlot.regulation;
    const setbackRules = regulation?.geometry?.setback;

    const handleParamsChange = (newParams: FeasibilityParams) => {
        if (activeProjectId) {
            actions.updateProject(activeProjectId, { feasibilityParams: newParams });
        }
    };

    return (
        <ScrollArea className="h-[calc(100vh-200px)] -mx-6 px-6">
            <div className='space-y-6 pb-10'>
                <div className='space-y-4'>
                    <div>
                        <Label htmlFor="plot-name" className="text-sm font-medium text-muted-foreground">Plot Name</Label>
                        <Input id="plot-name" value={selectedPlot.name} onChange={(e) => actions.updatePlot(selectedPlot.id, { name: e.target.value })} />
                    </div>
                    {selectedPlot.location && (
                        <div className='p-3 bg-secondary rounded-md text-sm text-center'>
                            <span className='text-muted-foreground'>Location: </span>
                            <span className='font-semibold'>{selectedPlot.location}</span>
                            {!regulation && (
                                <p className='text-xs text-amber-500 flex items-center justify-center gap-1 mt-1'>
                                    <Info className='h-3 w-3' /> No local regulations found. Using defaults.
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

                <Separator />

                <FeasibilitySection stats={stats} parkingCount={parkingCount} />
                <UnitMixConfig params={feasibilityParams} onChange={handleParamsChange} />

            </div>
        </ScrollArea>
    )
}

function ZoneProperties() {
    const { actions, selectedObjectId, plots } = useBuildingStore(s => ({
        actions: s.actions,
        selectedObjectId: s.selectedObjectId,
        plots: s.plots
    }));

    if (!selectedObjectId) return null;

    let object: BuildableArea | UtilityArea | undefined;
    let objectName = '';

    // Helper to find object
    const findObj = () => {
        for (const plot of plots) {
            const found = [
                ...plot.greenAreas,
                ...plot.parkingAreas,
                ...plot.buildableAreas,
                ...plot.utilityAreas
            ].find(obj => obj.id === selectedObjectId.id);
            if (found) return found;
        }
        return null;
    }

    const foundObject = findObj();
    if (foundObject) {
        object = foundObject as any; // Cast for simplified access
        objectName = foundObject.name;
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

            {selectedObjectId.type === 'UtilityArea' && (
                <div>
                    <Label htmlFor="utility-type" className="text-sm font-medium text-muted-foreground">Utility Type</Label>
                    <Select
                        value={(object as UtilityArea).type}
                        onValueChange={(v) => actions.updateObject(selectedObjectId.id, 'UtilityArea', { type: v as UtilityType })}
                    >
                        <SelectTrigger id="utility-type">
                            <SelectValue placeholder="Select type..." />
                        </SelectTrigger>
                        <SelectContent>
                            {Object.values(UtilityType).map(t => (
                                <SelectItem key={t} value={t}>{t}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            {selectedObjectId.type === 'ParkingArea' && (
                <div className="space-y-4 border-t pt-4">
                    <div>
                        <Label className="text-sm font-medium text-muted-foreground">Parking Type</Label>
                        <Select
                            value={(object as any).type || ParkingType.Surface}
                            onValueChange={(v) => actions.updateObject(selectedObjectId.id, 'ParkingArea', { type: v })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select type..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ParkingType.Surface}>Surface</SelectItem>
                                <SelectItem value={ParkingType.Basement}>Basement (Standalone)</SelectItem>
                                {/* <SelectItem value={ParkingType.Podium}>Podium (Standalone)</SelectItem> */}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <Label className="text-xs text-muted-foreground">Efficiency</Label>
                            <div className="flex items-center gap-2">
                                <Slider
                                    min={0.5} max={1.0} step={0.05}
                                    value={[(object as any).efficiency || 0.75]}
                                    onValueChange={([v]) => actions.updateObject(selectedObjectId.id, 'ParkingArea', { efficiency: v })}
                                />
                                <span className="text-xs w-8">{((object as any).efficiency || 0.75) * 100}%</span>
                            </div>
                        </div>
                        <div>
                            <Label className="text-xs text-muted-foreground">Capacity</Label>
                            <div className="text-lg font-bold font-mono">{(object as any).capacity || 0} <span className="text-xs font-normal text-muted-foreground">cars</span></div>
                        </div>
                    </div>
                </div>
            )}

            <p className='text-sm text-muted-foreground text-center p-4'>This is a 2D area. You can use the AI generator to populate it or draw buildings inside.</p>
        </div>
    );
}

function InternalUtilityProperties() {
    const { selectedObjectId, plots } = useBuildingStore();
    if (!selectedObjectId || !selectedObjectId.id.startsWith('floor-')) return null;

    // Find floor
    let floor: any = null;
    let building: any = null;

    for (const p of plots) {
        for (const b of p.buildings) {
            const f = b.floors?.find((x: any) => x.id === selectedObjectId.id);
            if (f) {
                floor = f;
                building = b;
                break;
            }
        }
        if (floor) break;
    }

    if (!floor) return <div className="p-4 text-sm text-center text-muted-foreground">Utility details not found.</div>;

    const isElectrical = floor.utilityType === 'Electrical' || selectedObjectId.id.includes('electrical');
    const name = isElectrical ? 'Electrical Room' : 'HVAC Plant';
    const Icon = isElectrical ? Zap : Fan;

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-secondary/50 rounded-md">
                <Icon className={cn("h-5 w-5", isElectrical ? "text-amber-400" : "text-blue-400")} />
                <div>
                    <h4 className="font-semibold text-sm">{name}</h4>
                    <p className="text-xs text-muted-foreground">Attached to {building.name}</p>
                </div>
            </div>

            <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Location</span>
                    <span className="font-mono">{isElectrical ? "Base (Ground)" : "Roof Top"}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Structure Height</span>
                    <span className="font-mono">{isElectrical ? "3.0m" : "2.0m"}</span>
                </div>
                <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded text-xs text-muted-foreground mt-2">
                    This is an automatically generated MEP component based on building typology.
                </div>
            </div>
        </div>
    )
}

function ParkingFloorProperties() {
    const { selectedObjectId, plots } = useBuildingStore();
    if (!selectedObjectId) return null;

    // Find floor
    let floor: any = null;
    let building: any = null;

    for (const p of plots) {
        for (const b of p.buildings) {
            const f = b.floors?.find((x: any) => x.id === selectedObjectId.id);
            if (f) {
                floor = f;
                building = b;
                break;
            }
        }
        if (floor) break;
    }

    if (!floor) return null;

    const type = floor.parkingType || ParkingType.Basement;
    const Icon = type === ParkingType.Basement ? ArrowDownToLine : (type === ParkingType.Stilt ? Layers : Car);

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-secondary/50 rounded-md">
                <Icon className="h-5 w-5 text-slate-500" />
                <div>
                    <h4 className="font-semibold text-sm">{type} Parking</h4>
                    <p className="text-xs text-muted-foreground">Building: {building.name}</p>
                </div>
            </div>

            <div className="space-y-4 text-sm pt-2">
                <div className="grid grid-cols-2 gap-4">
                    <div className="p-2 bg-secondary rounded flex flex-col">
                        <span className="text-muted-foreground text-xs">Level</span>
                        <span className="font-bold">{floor.level !== undefined ? (floor.level < 0 ? `B${Math.abs(floor.level)}` : `L${floor.level}`) : '-'}</span>
                    </div>
                    <div className="p-2 bg-secondary rounded flex flex-col">
                        <span className="text-muted-foreground text-xs">Capacity</span>
                        <span className="font-bold text-lg">{floor.parkingCapacity || 0}</span>
                    </div>
                </div>

                <div className="flex justify-between pt-2 border-t">
                    <span className="text-muted-foreground">Floor Height</span>
                    <span className="font-mono">{floor.height}m</span>
                </div>
            </div>
        </div>
    )
}


function getSelectionDetails(selectedObjectId: { type: string, id: string } | null, plots: any[]) {
    if (!selectedObjectId) return { name: 'Properties', type: '' };

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
            } else if (type === 'UtilityArea') {
                const utilityArea = plot.utilityAreas.find((u: any) => u.id === id);
                if (utilityArea) { name = utilityArea.name; break; }
            } else if ((type as string) === 'Utility' || (type as string) === 'Parking') {
                // Search in building floors
                for (const b of plot.buildings) {
                    const f = b.floors?.find((f: any) => f.id === id);
                    if (f) {
                        if ((type as string) === 'Utility') {
                            const isElec = f.utilityType === 'Electrical' || id.includes('electrical');
                            name = isElec ? 'Electrical Room' : 'HVAC Plant';
                        } else {
                            // Parking
                            name = `${f.parkingType || 'Basement'} Parking`;
                        }
                        break;
                    }
                }
                if (name) break;
            }
        }
    }

    return { name, type };
}


export function PropertiesPanel() {
    const { selectedObjectId, actions, plots } = useBuildingStore();

    if (!selectedObjectId) return null;

    const { name, type } = getSelectionDetails(selectedObjectId, plots);

    return (
        <Card className="bg-background/80 backdrop-blur-sm">
            <CardHeader className='flex-row items-center justify-between'>
                <div>
                    <CardTitle className='text-lg'>{name}</CardTitle>
                    <CardDescription>{type} Properties</CardDescription>
                </div>
                <Button size="icon" variant="ghost" onClick={() => actions.selectObject(null, null)}>
                    <X className='h-4 w-4' />
                </Button>
            </CardHeader>
            <CardContent className="space-y-6">
                {selectedObjectId.type === 'Building' && <BuildingProperties />}
                {selectedObjectId.type === 'Plot' && <PlotProperties />}
                {(selectedObjectId.type === 'GreenArea' || selectedObjectId.type === 'ParkingArea' || selectedObjectId.type === 'BuildableArea' || selectedObjectId.type === 'UtilityArea') && <ZoneProperties />}
                {(selectedObjectId.type as string) === 'Utility' && <InternalUtilityProperties />}
                {(selectedObjectId.type as string) === 'Parking' && <ParkingFloorProperties />}
            </CardContent>
        </Card>
    );
}
