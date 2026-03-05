
'use client';

import React, { useMemo, useState } from 'react';
import { useBuildingStore, useProjectData, useSelectedPlot } from '@/hooks/use-building-store';
import { useGreenRegulations } from '@/hooks/use-green-regulations';
import { useGreenStandardChecks } from '@/hooks/use-green-standard-checks';
import { Project } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { CheckCircle2, Circle, XCircle, AlertCircle, Leaf, Wind, Sun, MapPin, Loader2, MousePointerClick, Hand } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

const CREDIT_MATCH_RULES = [
    { keywords: ['ventilation', 'wind', 'air quality', 'natural ventilation', 'cross ventilation'], checkKey: 'ventilation' },
    { keywords: ['daylight', 'solar access', 'natural light'], checkKey: 'daylighting' },
    { keywords: ['landscape', 'green cover', 'vegetation', 'planting', 'tree', 'habitat', 'biodivers', 'topography'], checkKey: 'green_cover' },
    { keywords: ['open space', 'outdoor space'], checkKey: 'open_space' },
    { keywords: ['heat island', 'urban heat', 'uhie'], checkKey: 'heat_island' },
    { keywords: ['transit', 'transport', 'connectivity', 'bus', 'metro', 'bicycle', 'pedestrian', 'walkable'], checkKey: 'transit_access' },
    { keywords: ['amenity', 'proximity', 'community', 'basic service', 'social infrastructure'], checkKey: 'amenity_proximity' },
    { keywords: ['rainwater', 'rain water', 'water harvest', 'rwh', 'storm water'], checkKey: 'rainwater_harvesting' },
    { keywords: ['solar', 'photovoltaic', 'renewable energy', 'solar pv', 'green power'], checkKey: 'solar_energy' },
    { keywords: ['stp', 'wtp', 'sewage', 'water recycl', 'water treatment', 'effluent', 'waste water', 'wastewater'], checkKey: 'water_recycling' },
    { keywords: ['waste', 'owc', 'solid waste', 'organic waste', 'compost', 'recyclable waste'], checkKey: 'waste_management' },
    { keywords: ['ev ', 'electric vehicle', 'ev charging', 'e-vehicle', 'low-emitting vehicle'], checkKey: 'ev_charging' },
    { keywords: ['parking', 'vehicle parking'], checkKey: 'parking_compliance' },
    { keywords: ['far', 'floor area ratio', 'fsi', 'fsr', 'capacity assessment', 'compact'], checkKey: 'far_compliance' },
    { keywords: ['coverage', 'ground cover', 'plot coverage'], checkKey: 'ground_coverage' },
    { keywords: ['orientation', 'building orient', 'passive architecture'], checkKey: 'building_orientation' },
    { keywords: ['depth', 'floor plate'], checkKey: 'floor_plate_depth' },
    { keywords: ['fire', 'fire safety', 'firefighting'], checkKey: 'fire_safety' },
    { keywords: ['energy efficien', 'hvac', 'cooling', 'heating', 'mechanical', 'thermal load', 'energy optimization', 'energy performance'], checkKey: 'energy_efficiency' },
    { keywords: ['site', 'master plan', 'site plan', 'zoning', 'sustainable design'], checkKey: 'site_planning' },
    { keywords: ['land use', 'mixed use', 'land utiliz', 'equitable development'], checkKey: 'land_use_planning' },
    { keywords: ['water efficien', 'water conserv', 'water manage', 'water meter', 'plumbing fixture'], checkKey: 'water_recycling' },
    { keywords: ['construction', 'material', 'embodied energy', 'fly ash', 'aac', 'indoor', 'iaq', 'low voc', 'tobacco', 'innovation', 'bonus', 'exceptional', 'leed ap', 'igbc ap', 'housing', 'employment', 'social', 'cultural', 'tenant', 'commissioning', 'process', 'operation and maintenance', 'green education', 'no smoking', 'refrigerant', 'odp', 'gwp', 'ozone', 'light pollution', 'soil erosion', 'topsoil', 'site disturbance', 'green building', 'decarbonization', 'health', 'wellbeing', 'universal design', 'differently abled', 'measurement & verification', 'smart metering'], checkKey: 'manual_tracking' },
];

export function GreenScorecardPanel() {
    const activeProject = useProjectData();
    const { regulations, isLoading } = useGreenRegulations(activeProject as unknown as Project);

    const creditStatusMap = useGreenStandardChecks(activeProject, activeProject?.simulationResults);
    const [manualOverrides, setManualOverrides] = useState<Record<string, boolean>>({});

    const regulation = regulations && regulations.length > 0 ? regulations[0] : null;

    const scorecardData = useMemo(() => {
        if (!regulation?.categories) return null;

        let totalPoints = 0;
        let achievedPoints = 0;

        const categories = regulation.categories.map((cat: any) => {
            const credits = (cat.credits || []).map((credit: any) => {
                const maxPoints = credit.points || 0;
                let status: 'pending' | 'achieved' | 'failed' = 'pending';
                let score = 0;
                let isAuto = false;
                let isManualOnly = false;
                let dataKey = '';
                const overrideKey = credit.code || credit.name;

                const nameLower = credit.name.toLowerCase();
                
                // Find matching rule
                const matchedRule = CREDIT_MATCH_RULES.find(rule => 
                    rule.keywords.some(kw => nameLower.includes(kw))
                );

                if (matchedRule) {
                    if (matchedRule.checkKey === 'manual_tracking') {
                        isManualOnly = true;
                        // Use unique key for manual override state
                        if (manualOverrides[overrideKey]) {
                            status = 'achieved';
                            score = maxPoints;
                        }
                    } else if (matchedRule.checkKey === 'heat_island') {
                        // Special composite check
                        if (creditStatusMap['ventilation']?.status === 'achieved' && creditStatusMap['green_cover']?.status === 'achieved') {
                            status = 'achieved';
                            score = maxPoints;
                            isAuto = true;
                        }
                    } else {
                        // Standard check from engine
                        const engineStatus = creditStatusMap[matchedRule.checkKey];
                        if (engineStatus) {
                            status = engineStatus.status;
                            if (status === 'achieved') score = maxPoints;
                            isAuto = true;
                            dataKey = matchedRule.checkKey;
                        }
                    }
                }

                totalPoints += maxPoints;
                achievedPoints += score;

                return { 
                    ...credit, 
                    status, 
                    score, 
                    maxPoints, 
                    isAuto, 
                    isManualOnly, 
                    dataKey,
                    overrideKey
                };
            });

            return { ...cat, credits };
        });

        if (!categories.find((c: any) => c.name.includes('Location'))) {
            const transitStatus = creditStatusMap['transit_access']?.status === 'achieved';
            const amenityStatus = creditStatusMap['amenity_proximity']?.status === 'achieved';

            const proxCredits = [
                {
                    name: "Access to Public Transport",
                    type: "credit",
                    status: transitStatus ? 'achieved' : 'pending',
                    score: transitStatus ? 2 : 0,
                    maxPoints: 2,
                    isAuto: true,
                    dataKey: 'transit',
                    code: "LOC-1"
                },
                {
                    name: "Proximity to Amenities",
                    type: "credit",
                    status: amenityStatus ? 'achieved' : 'pending',
                    score: amenityStatus ? 2 : 0,
                    maxPoints: 2,
                    isAuto: true,
                    dataKey: 'amenity',
                    code: "LOC-2"
                }
            ];

            proxCredits.forEach(c => {
                totalPoints += c.maxPoints;
                achievedPoints += (c.score as number);
            });

            categories.push({
                name: "Location & Connectivity (Proximity)",
                credits: proxCredits
            } as any);
        }

        return { categories, totalPoints, achievedPoints };
    }, [regulation, creditStatusMap, manualOverrides]);

    const handleToggleManual = (overrideKey: string) => {
        setManualOverrides(prev => ({
            ...prev,
            [overrideKey]: !prev[overrideKey]
        }));
    };

    const plots = useBuildingStore(state => state.plots);
    const isPlotCreated = plots.length > 0;

    if (!activeProject) return <div className="p-4 text-center text-muted-foreground">Select a project to view scorecard</div>;

    if (!isPlotCreated) {
        return (
            <div className="flex flex-col h-full">
                <div className="p-4 border-b shrink-0">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Leaf className="h-5 w-5 text-green-500" />
                        Green Scorecard
                    </h2>
                </div>
                <div className="flex-1 flex items-center justify-center p-8 text-center bg-muted/5">
                    <div className="space-y-3 flex flex-col items-center">
                        <div className="h-12 w-12 rounded-full bg-muted/30 flex items-center justify-center">
                            <MousePointerClick className="h-6 w-6 text-muted-foreground/50" />
                        </div>
                        <p className="text-sm text-muted-foreground max-w-[200px]">
                            Create a plot on the map to start tracking your green score.
                        </p>
                    </div>
                </div>
            </div>
        );
    }


    if (isLoading && !scorecardData) return (
        <div className="p-8 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading Green Regulations...
        </div>
    );
    if (!scorecardData) return <div className="p-4 text-center text-muted-foreground">No Green Regulation data found for this project.</div>;

    const percentage = scorecardData.totalPoints > 0 ? (scorecardData.achievedPoints / scorecardData.totalPoints) * 100 : 0;

    return (
        <div className="h-full flex flex-col w-full max-h-[calc(100vh-200px)]">
            {/* Header */}
            <div className="p-4 border-b shrink-0">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Leaf className="h-5 w-5 text-green-500" />
                        Green Scorecard
                        {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                    </h2>
                    <Badge variant="outline">{activeProject.greenCertification?.[0] || 'Generic'}</Badge>
                </div>

                <div className="space-y-1">
                    <div className="flex justify-between text-sm font-medium">
                        <span>Score: {scorecardData.achievedPoints} / {scorecardData.totalPoints}</span>
                        <span>{percentage.toFixed(0)}%</span>
                    </div>
                    <Progress value={percentage} className="h-2" />
                </div>
            </div>

            {/* Scrollable List */}
            <ScrollArea className="flex-1">
                <div className="p-4">
                    <Accordion type="multiple" defaultValue={scorecardData.categories.map((c: any) => c.name)} className="space-y-4">
                        {scorecardData.categories.map((cat: any, idx: number) => (
                            <AccordionItem value={cat.name} key={idx} className="border rounded-lg px-3 bg-secondary/10">
                                <AccordionTrigger className="hover:no-underline py-3">
                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                        {cat.name.includes("Location") ? <MapPin className="h-4 w-4 text-orange-500" /> :
                                            cat.name.includes("Energy") ? <Sun className="h-4 w-4 text-yellow-500" /> :
                                                cat.name.includes("Water") ? <Wind className="h-4 w-4 text-blue-500" /> :
                                                    <Circle className="h-3 w-3 text-muted-foreground" />}
                                        {cat.name}
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="pb-3">
                                    <div className="space-y-1">
                                        {cat.credits.map((credit: any, cIdx: number) => (
                                            <div key={cIdx} className="flex items-start gap-3 p-2 rounded-md hover:bg-secondary/20 transition-colors group">
                                                <div className="mt-0.5 shrink-0">
                                                    {credit.status === 'achieved' ? <CheckCircle2 className="h-4 w-4 text-green-500" /> :
                                                        credit.status === 'failed' ? <XCircle className="h-4 w-4 text-red-500" /> :
                                                            <Circle className="h-4 w-4 text-muted-foreground/30" />}
                                                </div>
                                                <div className="flex-1 space-y-0.5">
                                                    <div className="flex items-center justify-between">
                                                        <span className={cn(
                                                            "text-sm font-medium leading-none",
                                                            credit.status === 'achieved' && "text-green-700 dark:text-green-400"
                                                        )}>
                                                            {credit.name}
                                                        </span>
                                                        <span className="text-xs font-mono text-muted-foreground shrink-0 ml-2">
                                                            {credit.score}/{credit.maxPoints} pts
                                                        </span>
                                                    </div>

                                                    <div className="flex items-center gap-2 mt-1">
                                                        {/* Auto-calc badge */}
                                                        {credit.isAuto && (
                                                            <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal gap-1">
                                                                <Sparkles4Icon className="h-2 w-2" /> Auto-Linked
                                                            </Badge>
                                                        )}
                                                        
                                                        {credit.isManualOnly && (
                                                            <div className="flex items-center gap-2 w-full justify-between">
                                                                <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal gap-1 border-dashed">
                                                                    <Hand className="h-2 w-2" /> Manual Tracking
                                                                </Badge>
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[10px] text-muted-foreground">Mark Achieved</span>
                                                                    <Switch 
                                                                        checked={!!manualOverrides[credit.overrideKey]}
                                                                        onCheckedChange={() => handleToggleManual(credit.overrideKey)}
                                                                        className="scale-75 origin-right"
                                                                    />
                                                                </div>
                                                            </div>
                                                        )}

                                                        {credit.dataKey === 'ventilation' && <span className="text-[10px] text-muted-foreground line-clamp-1">(Simulation)</span>}
                                                        {credit.dataKey === 'daylighting' && <span className="text-[10px] text-muted-foreground line-clamp-1">(Simulation)</span>}
                                                        {credit.dataKey === 'transit' && <span className="text-[10px] text-muted-foreground line-clamp-1">(Proximity)</span>}
                                                        {credit.dataKey === 'amenity' && <span className="text-[10px] text-muted-foreground line-clamp-1">(Proximity)</span>}
                                                        {['green_cover', 'open_space', 'site_planning', 'land_use_planning'].includes(credit.dataKey) && <span className="text-[10px] text-muted-foreground line-clamp-1">(Plot Data)</span>}
                                                        {['far_compliance', 'ground_coverage', 'parking_compliance'].includes(credit.dataKey) && <span className="text-[10px] text-muted-foreground line-clamp-1">(KPIs)</span>}
                                                        {['rainwater_harvesting', 'solar_energy', 'water_recycling', 'waste_management', 'ev_charging', 'fire_safety', 'energy_efficiency'].includes(credit.dataKey) && <span className="text-[10px] text-muted-foreground line-clamp-1">(Utilities)</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                </div>
            </ScrollArea>
        </div>
    );
}

function Sparkles4Icon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9-9-1.8-9-9 1.8-9 9-9" />
            <path d="M10 14l2-2 2 2" />
        </svg>
    )
}
