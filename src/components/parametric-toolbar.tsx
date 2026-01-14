'use client';

import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useBuildingStore, useSelectedPlot, useProjectData } from '@/hooks/use-building-store';
import { Sparkles, Info, Plus, Trash2, MousePointerClick } from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';


// Building typology icons (simple SVG representations)
// Building typology icons (simple SVG representations)
const typologyIcons = {
    point: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <rect x="15" y="10" width="10" height="20" className="fill-current stroke-current stroke-[1.5]" />
        </svg>
    ),
    slab: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <rect x="8" y="15" width="24" height="10" className="fill-current stroke-current stroke-[1.5]" />
        </svg>
    ),
    lshaped: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <path d="M 10 10 L 22 10 L 22 18 L 30 18 L 30 30 L 10 30 Z" className="fill-current stroke-current stroke-[1.5]" />
        </svg>
    ),
    ushaped: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <path d="M 10 10 L 15 10 L 15 25 L 25 25 L 25 10 L 30 10 L 30 30 L 10 30 Z" className="fill-current stroke-current stroke-[1.5]" />
        </svg>
    ),
    oshaped: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <rect x="10" y="10" width="20" height="20" className="fill-current stroke-current stroke-[1.5]" />
            <rect x="15" y="15" width="10" height="10" className="fill-background stroke-current stroke-[1.5]" />
        </svg>
    ),
    tshaped: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <path d="M 10 10 L 30 10 L 30 18 L 24 18 L 24 30 L 16 30 L 16 18 L 10 18 Z" className="fill-current stroke-current stroke-[1.5]" />
        </svg>
    ),
    hshaped: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <path d="M 10 10 L 15 10 L 15 18 L 25 18 L 25 10 L 30 10 L 30 30 L 25 30 L 25 22 L 15 22 L 15 30 L 10 30 Z" className="fill-current stroke-current stroke-[1.5]" />
        </svg>
    ),
};

const parkingIcons = {
    none: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <circle cx="20" cy="20" r="14" className="stroke-current stroke-[1.5] fill-none" />
            <line x1="10" y1="10" x2="30" y2="30" className="stroke-current stroke-[1.5]" />
        </svg>
    ),
    ug: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <path d="M 20 12 L 28 20 L 20 28 L 12 20 Z" className="fill-current stroke-current stroke-[1.5]" />
            <path d="M 20 22 L 20 30" className="stroke-current stroke-[2] fill-none" markerEnd="url(#arrow)" />
        </svg>
    ),
    pod: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <path d="M 20 12 L 28 20 L 20 28 L 12 20 Z" className="fill-current stroke-current stroke-[1.5]" />
            <path d="M 20 18 L 20 10" className="stroke-current stroke-[2] fill-none" markerEnd="url(#arrow-up)" />
        </svg>
    ),
    surface: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <path d="M 20 15 L 28 20 L 20 25 L 12 20 Z" className="fill-current stroke-current stroke-[1.5]" />
        </svg>
    ),
};

type BuildingTypology = 'point' | 'slab' | 'lshaped' | 'ushaped' | 'oshaped' | 'tshaped' | 'hshaped';
type ParkingTypology = 'none' | 'ug' | 'pod' | 'surface';
type LandUseType = 'residential' | 'commercial' | 'mixed' | 'institutional';

export function ParametricToolbar({ embedded = false }: { embedded?: boolean }) {
    const { actions, plots, generationParams, designOptions, selectedObjectId } = useBuildingStore(state => ({
        actions: state.actions,
        plots: state.plots,
        generationParams: state.generationParams,
        designOptions: state.designOptions,
        selectedObjectId: state.selectedObjectId
    }));

    const [selectedTypologies, setSelectedTypologies] = useState<BuildingTypology[]>(['point']);
    const [selectedParking, setSelectedParking] = useState<ParkingTypology>('ug');
    // ...
    // ... in return JSX ...
    const projectData = useProjectData();
    const isVastuEnabled = projectData?.vastuCompliant;

    const [targetGFA, setTargetGFA] = useState(5000);
    const [targetFAR, setTargetFAR] = useState(3.0);
    const [floorRange, setFloorRange] = useState([5, 12]);
    const [heightRange, setHeightRange] = useState([16.8, 39.2]);
    const [footprintRange, setFootprintRange] = useState([400, 1000]);
    const [scrRange, setScrRange] = useState([0.25, 0.60]);
    const [parkingRatio, setParkingRatio] = useState(0.30);
    const [gridOrientation, setGridOrientation] = useState(0);
    const [avgUnitSize, setAvgUnitSize] = useState(85);
    const [commercialPercent, setCommercialPercent] = useState(0);

    // Generation Mode: Parametric Only
    // const [generationMode, setGenerationMode] = useState<'ai' | 'algo'>('algo');

    // New Generative Params
    const [floorHeight, setFloorHeight] = useState(3.5);
    const [landUse, setLandUse] = useState<LandUseType>('residential');
    const [programMix, setProgramMix] = useState({
        residential: 100,
        commercial: 0,
        institutional: 0,
        openSpace: 0
    });

    const [selectedUtilities, setSelectedUtilities] = useState<string[]>(['STP', 'WTP', 'Electrical', 'HVAC', 'Water']);

    // Constraints
    const [maxAllowedFloors, setMaxAllowedFloors] = useState(60);
    const [maxAllowedHeight, setMaxAllowedHeight] = useState(100);
    const [maxAllowedFAR, setMaxAllowedFAR] = useState(4.0);

    // Scenario Management State


    // Update mix when land use changes
    useEffect(() => {
        if (landUse === 'residential') setProgramMix({ residential: 100, commercial: 0, institutional: 0, openSpace: 0 });
        else if (landUse === 'commercial') setProgramMix({ residential: 0, commercial: 100, institutional: 0, openSpace: 0 });
        else if (landUse === 'institutional') setProgramMix({ residential: 0, commercial: 0, institutional: 100, openSpace: 0 });
        // Mixed use keeps current or defaults to 50/50? Let's leave it manual or default
        else if (landUse === 'mixed') setProgramMix({ residential: 40, commercial: 40, institutional: 10, openSpace: 10 });
    }, [landUse]);

    // Derive the truly selected plot based on user selection
    const selectedPlot = selectedObjectId?.type === 'Plot'
        ? plots.find(p => p.id === selectedObjectId.id)
        : selectedObjectId
            ? plots.find(p => p.buildings.some(b => b.id === selectedObjectId.id) || p.greenAreas.some(g => g.id === selectedObjectId.id) || p.parkingAreas.some(pk => pk.id === selectedObjectId.id))
            : undefined;

    // Apply regulations when plot changes
    useEffect(() => {
        if (selectedPlot?.regulation?.geometry) {
            const geomRegs = selectedPlot.regulation.geometry;

            // FAR
            // Try common keys for FAR
            const farValue = geomRegs['floor_area_ratio']?.value || geomRegs['far']?.value || geomRegs['max_far']?.value;
            if (farValue) {
                const far = Number(farValue);
                if (!isNaN(far)) {
                    setTargetFAR(far);
                    setMaxAllowedFAR(far);
                    // GFA is now calculated automatically from FAR * Plot Area
                }
            }

            // Height
            const maxHeightValue = geomRegs['max_height']?.value || geomRegs['building_height']?.value;
            if (maxHeightValue) {
                const maxHeight = Number(maxHeightValue);
                if (!isNaN(maxHeight)) {
                    setMaxAllowedHeight(maxHeight);
                    // Clamp height range
                    setHeightRange(prev => [prev[0], Math.min(prev[1], maxHeight)]);

                    // Approximate floors (assuming ~3.5m regular floor)
                    const maxFloors = Math.floor(maxHeight / 3.5);
                    setMaxAllowedFloors(maxFloors);
                    setFloorRange(prev => [prev[0], Math.min(prev[1], maxFloors)]);
                }
            }
        }
    }, [selectedPlot?.id, selectedPlot?.regulation]); // Re-run if plot or regulations change

    // Auto-detect land use from regulation type
    useEffect(() => {
        if (selectedPlot?.selectedRegulationType) {
            const regType = selectedPlot.selectedRegulationType.toLowerCase();

            // Check in order of specificity
            if (regType.includes('mixed')) {
                setLandUse('mixed');
            } else if (regType.includes('commercial') || regType.includes('shopping') || regType.includes('retail') || regType.includes('office')) {
                setLandUse('commercial');
            } else if (regType.includes('industrial') || regType.includes('warehouse') || regType.includes('storage') || regType.includes('manufacturing')) {
                setLandUse('commercial'); // Industrial uses commercial typology in the current system
            } else if (regType.includes('institutional') || regType.includes('public') || regType.includes('civic') || regType.includes('government')) {
                setLandUse('institutional');
            } else if (regType.includes('residential') || regType.includes('housing') || regType.includes('plotted')) {
                setLandUse('residential');
            }
            // If no match, keep current landUse
        }
    }, [selectedPlot?.selectedRegulationType]);

    const handleGenerate = () => {
        if (!selectedPlot) {
            return;
        }

        // Calculate GFA from FAR
        const calculatedGFA = selectedPlot.area ? Math.round(selectedPlot.area * targetFAR) : 0;

        // Store current parameters and trigger generation
        const params: any = {
            typologies: selectedTypologies,
            targetGFA: calculatedGFA,
            targetFAR,
            minFloors: floorRange[0],
            maxFloors: floorRange[1],
            minHeight: heightRange[0],
            maxHeight: heightRange[1],
            parkingType: selectedParking,
            parkingRatio,
            minFootprint: footprintRange[0],
            maxFootprint: footprintRange[1],
            minSCR: scrRange[0],
            maxSCR: scrRange[1],
            gridOrientation,
            avgUnitSize,
            commercialPercent,
            // New Params
            floorHeight,
            landUse,
            programMix,
            selectedUtilities
        };

        // Trigger scenario generation (this will open the modal)
        actions.generateScenarios(selectedPlot.id, params);
    };

    const Container = embedded ? 'div' : Card;

    return (
        <Container className={cn("flex flex-col font-sans h-full", embedded ? "" : "w-full shadow-xl bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 max-h-[calc(100vh-200px)]")}>
            {!embedded && (
                <CardHeader className="py-2 px-3 flex-shrink-0 border-b">
                    <CardTitle className="text-sm flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        Generate Design
                    </CardTitle>
                </CardHeader>
            )}

            <div className={cn("flex-1 overflow-y-auto min-h-0", embedded ? "p-3 scrollbar-thin scrollbar-thumb-muted-foreground/20" : "p-3 space-y-4 scrollbar-thin scrollbar-thumb-muted-foreground/20")}>
                {selectedPlot ? (
                    <div className="space-y-4">
                        {/* Generation Mode: Parametric Only */}


                        {/* Regulation / Zone Selector */}
                        {selectedPlot.availableRegulations && selectedPlot.availableRegulations.length > 0 && (
                            <div className="space-y-1.5">
                                <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Regulation / Zone</Label>
                                <select
                                    className="w-full text-xs h-8 rounded-md border border-input bg-background px-3 py-1 ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                    value={selectedPlot.selectedRegulationType || ''}
                                    onChange={(e) => {
                                        if (selectedPlot) {
                                            actions.setPlotRegulation(selectedPlot.id, e.target.value);
                                        }
                                    }}
                                >
                                    {selectedPlot.availableRegulations.map(reg => (
                                        <option key={reg.type} value={reg.type}>
                                            {reg.type}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Building Typologies */}
                        <div className="space-y-1.5">
                            <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Typology</Label>
                            <div className="grid grid-cols-4 gap-2">
                                {(['point', 'slab', 'lshaped', 'ushaped', 'tshaped', 'hshaped'] as BuildingTypology[]).map(type => (
                                    <button
                                        key={type}
                                        onClick={() => {
                                            setSelectedTypologies(prev => {
                                                if (prev.includes(type)) {
                                                    // Don't allow deselecting if it's the only one
                                                    if (prev.length === 1) return prev;
                                                    return prev.filter(t => t !== type);
                                                }
                                                return [...prev, type];
                                            });
                                        }}
                                        className={cn(
                                            'flex-shrink-0 w-14 h-14 rounded-md border p-1 transition-all hover:bg-accent/50 flex flex-col items-center justify-center gap-0.5',
                                            selectedTypologies.includes(type) ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border bg-background'
                                        )}
                                    >
                                        <div className="h-5 w-5 text-foreground/80">{typologyIcons[type]}</div>
                                        <span className="text-[9px] font-medium capitalize truncate w-full text-center">{type === 'lshaped' ? 'L-Shape' : type === 'ushaped' ? 'U-Shape' : type === 'oshaped' ? 'O-Shape' : type}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Land Use */}
                        {/* <div className="space-y-1.5">
                            <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Land Use</Label>
                            <div className="flex bg-muted/30 p-0.5 rounded-lg border">
                                {(['residential', 'commercial', 'mixed', 'institutional'] as LandUseType[]).map(type => (
                                    <button
                                        key={type}
                                        onClick={() => setLandUse(type)}
                                        className={cn(
                                            'flex-1 h-7 text-[10px] font-medium rounded-md transition-all capitalize',
                                            landUse === type ? 'bg-background shadow-sm text-foreground ring-1 ring-border' : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
                                        )}
                                    >
                                        {type}
                                    </button>
                                ))}
                            </div>
                        </div> */}

                        {/* Parking Typology */}
                        <div className="space-y-1.5">
                            <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Parking</Label>
                            <div className="space-y-2">
                                <div className="grid grid-cols-4 gap-2">
                                    {(['none', 'ug'] as ParkingTypology[]).map(type => (
                                        <button
                                            key={type}
                                            onClick={() => setSelectedParking(type)}
                                            className={cn(
                                                'flex-shrink-0 h-10 rounded-md border p-1 transition-all hover:bg-accent/50 flex items-center justify-center gap-2',
                                                selectedParking === type ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border bg-background'
                                            )}
                                            title={type === 'ug' ? 'Basement' : type === 'pod' ? 'Podium (Disabled)' /* /Stilt */ : type === 'none' ? 'No Parking' : 'Surface'}
                                        >
                                            <div className="flex flex-col items-center gap-1">
                                                <div className="h-4 w-4 text-foreground/80">{parkingIcons[type]}</div>
                                                <span className="text-[9px] font-medium capitalize">{type === 'ug' ? 'Bsmt' : type === 'pod' ? 'Podium' /* (Disabled) */ : type === 'none' ? 'None' : 'Surf'}</span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[10px]">
                                        <span className="text-muted-foreground">Ratio</span>
                                        <span>{parkingRatio.toFixed(2)}</span>
                                    </div>
                                    <Slider
                                        value={[parkingRatio]}
                                        min={0.1}
                                        max={1.0}
                                        step={0.05}
                                        onValueChange={(val) => setParkingRatio(val[0])}
                                        className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/20 [&_span]:h-3 [&_span]:w-3"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Program Allocations (Hidden for single use unless mixed) */}
                        {landUse !== 'residential' && landUse !== 'commercial' && landUse !== 'institutional' && (
                            <div className="p-3 bg-muted/20 border rounded-lg space-y-3">
                                <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Allocation (Total: {
                                    programMix.residential + programMix.commercial + programMix.institutional + programMix.openSpace
                                }%)</Label>

                                <div className="space-y-2">
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-[10px]">
                                            <span>Residential</span>
                                            <span>{programMix.residential}%</span>
                                        </div>
                                        <Slider value={[programMix.residential]} max={100} step={5} onValueChange={([v]) => setProgramMix(prev => ({ ...prev, residential: v }))} className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/20 [&_span]:h-3 [&_span]:w-3" />
                                    </div>
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-[10px]">
                                            <span>Commercial</span>
                                            <span>{programMix.commercial}%</span>
                                        </div>
                                        <Slider value={[programMix.commercial]} max={100} step={5} onValueChange={([v]) => setProgramMix(prev => ({ ...prev, commercial: v }))} className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/20 [&_span]:h-3 [&_span]:w-3" />
                                    </div>
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-[10px]">
                                            <span>Institutional</span>
                                            <span>{programMix.institutional}%</span>
                                        </div>
                                        <Slider value={[programMix.institutional]} max={100} step={5} onValueChange={([v]) => setProgramMix(prev => ({ ...prev, institutional: v }))} className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/20 [&_span]:h-3 [&_span]:w-3" />
                                    </div>
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-[10px]">
                                            <span>Open Space</span>
                                            <span>{programMix.openSpace}%</span>
                                        </div>
                                        <Slider value={[programMix.openSpace]} max={100} step={5} onValueChange={([v]) => setProgramMix(prev => ({ ...prev, openSpace: v }))} className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/20 [&_span]:h-3 [&_span]:w-3" />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Utilities Selection */}
                        {(isVastuEnabled || selectedUtilities.length > 0) && (
                            <div className="space-y-1.5">
                                <div className="flex justify-between items-center">
                                    <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Utility Infrastructure</Label>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-4 p-0 text-[10px] text-primary"
                                        onClick={() => setSelectedUtilities(['STP', 'WTP', 'Electrical', 'HVAC', 'Water'])}
                                    >
                                        Select All
                                    </Button>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    {['STP', 'WTP', 'Electrical', 'HVAC', 'Water', 'Roads'].map(type => (
                                        <button
                                            key={type}
                                            onClick={() => {
                                                setSelectedUtilities(prev =>
                                                    prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                                                )
                                            }}
                                            className={cn(
                                                'text-[10px] px-2 py-1.5 rounded-md border transition-all truncate',
                                                selectedUtilities.includes(type)
                                                    ? 'bg-primary/10 border-primary/50 text-foreground font-medium'
                                                    : 'bg-muted/10 border-border text-muted-foreground hover:bg-muted/30'
                                            )}
                                        >
                                            {type}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="space-y-3 pt-2">
                            <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Targets</Label>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <div className="flex justify-between text-[10px]">
                                        <span className="font-medium text-foreground/80">GFA</span>
                                        <span className="text-muted-foreground">m²</span>
                                    </div>
                                    <div className="relative">
                                        <Input
                                            type="number"
                                            value={targetGFA}
                                            onChange={(e) => setTargetGFA(Number(e.target.value))}
                                            className="h-8 text-xs bg-muted/20 border-border"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <div className="flex justify-between text-[10px]">
                                        <span className="font-medium text-foreground/80">FAR</span>
                                        <span className={cn("text-muted-foreground", targetFAR > maxAllowedFAR && "text-red-500 font-bold")}>Max: {maxAllowedFAR}</span>
                                    </div>
                                    <div className="relative">
                                        <Input
                                            type="number"
                                            step="0.1"
                                            value={targetFAR}
                                            onChange={(e) => setTargetFAR(Number(e.target.value))}
                                            className={cn("h-8 text-xs bg-muted/20 border-border", targetFAR > maxAllowedFAR && "border-red-500 text-red-500")}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Constraints */}
                            <div className="space-y-3 pt-1">
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <Label className="text-[10px] font-medium text-foreground/80">Floor Ht</Label>
                                        <span className="text-[10px] text-muted-foreground">{floorHeight}m</span>
                                    </div>
                                    <Slider
                                        value={[floorHeight]}
                                        min={3.0}
                                        max={6.0}
                                        step={0.1}
                                        onValueChange={([v]) => setFloorHeight(v)}
                                        className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/20 [&_span]:h-3.5 [&_span]:w-3.5"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <Label className="text-[10px] font-medium text-foreground/80">Floors</Label>
                                        <span className="text-[10px] text-muted-foreground">{floorRange[0]} - {floorRange[1]} fl (Max: {maxAllowedFloors})</span>
                                    </div>
                                    <Slider
                                        value={floorRange}
                                        min={1}
                                        max={maxAllowedFloors}
                                        step={1}
                                        minStepsBetweenThumbs={1}
                                        onValueChange={setFloorRange}
                                        className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/20 [&_span]:h-3.5 [&_span]:w-3.5"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="p-3 pb-4">
                            <Button onClick={handleGenerate} className="w-full h-9 shadow-sm">
                                <Sparkles className="mr-2 h-3 w-3" />
                                Generate Options
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex h-full items-center justify-center p-4 text-center">
                        <div className="space-y-2 flex flex-col items-center">
                            <div className="h-12 w-12 rounded-full bg-muted/30 flex items-center justify-center">
                                <MousePointerClick className="h-6 w-6 text-muted-foreground/50" />
                            </div>
                            <p className="text-sm text-muted-foreground max-w-[180px]">Select a plot on the map to view and generate design scenarios.</p>
                        </div>
                    </div>
                )}
            </div>


        </Container >
    );
}
