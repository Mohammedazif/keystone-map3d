
'use client';

import React, { useMemo } from 'react';
import { useBuildingStore, useProjectData } from '@/hooks/use-building-store';
import { useGreenRegulations } from '@/hooks/use-green-regulations';
import { useGreenStandardChecks } from '@/hooks/use-green-standard-checks';
import { Project } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, Circle, XCircle, AlertCircle, Leaf, Wind, Sun, MapPin, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

export function GreenScorecardPanel() {
    const activeProject = useProjectData();
    const { regulations, isLoading } = useGreenRegulations(activeProject as unknown as Project);

    // 2. Run Checks against current project state & simulation results
    // Now using REAL simulation results from the project
    const creditStatusMap = useGreenStandardChecks(activeProject, activeProject?.simulationResults);
    // For now, we'll mock it or derive it

    // Use the first regulation found for now, as we enforced single selection
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

                // --- 🌟 SIMULATOR AUTO-LINKING LOGIC 🌟 ---
                // Simple keyword matching for now
                const nameLower = credit.name.toLowerCase();

                // Wind / Ventilation
                if (nameLower.includes('ventilation') || nameLower.includes('wind')) {
                    if (creditStatusMap['ventilation']?.status === 'achieved') {
                        status = 'achieved';
                        score = maxPoints;
                    }
                }

                // Sun / Daylighting
                if (nameLower.includes('daylight') || nameLower.includes('solar')) {
                    if (creditStatusMap['daylighting']?.status === 'achieved') {
                        status = 'achieved';
                        score = maxPoints;
                    }
                }

                // Green Cover / Landscape
                if (nameLower.includes('landscape') || nameLower.includes('green cover') || nameLower.includes('vegetation')) {
                    if (creditStatusMap['green_cover']?.status === 'achieved') {
                        status = 'achieved';
                        score = maxPoints;
                    }
                }

                // Open Space
                if (nameLower.includes('open space')) {
                    if (creditStatusMap['open_space']?.status === 'achieved') {
                        status = 'achieved';
                        score = maxPoints;
                    }
                }

                // Heat Island proxy (Wind + Solar + Green)
                if (nameLower.includes('heat island')) {
                    if (creditStatusMap['ventilation']?.status === 'achieved' && creditStatusMap['green_cover']?.status === 'achieved') {
                        status = 'achieved';
                        score = maxPoints;
                    }
                }

                if (nameLower.includes('transit') || nameLower.includes('connectivity')) {
                    if (creditStatusMap['transit_access']?.status === 'achieved') {
                        status = 'achieved';
                        score = maxPoints;
                    }
                }

                if (nameLower.includes('amenit') || nameLower.includes('proximity')) {
                    if (creditStatusMap['amenity_proximity']?.status === 'achieved') {
                        status = 'achieved';
                        score = maxPoints;
                    }
                }

                totalPoints += maxPoints;
                achievedPoints += score;

                return { ...credit, status, score, maxPoints, isAuto: nameLower.includes('ventilation') || nameLower.includes('daylight') || nameLower.includes('transit') || nameLower.includes('amenit') };
            });

            return { ...cat, credits };
        });

        // Add Placeholder Proximity Category if not present
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
                    code: "LOC-1"
                },
                {
                    name: "Proximity to Amenities",
                    type: "credit",
                    status: amenityStatus ? 'achieved' : 'pending',
                    score: amenityStatus ? 2 : 0,
                    maxPoints: 2,
                    isAuto: true,
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
    }, [regulation, creditStatusMap]);

    if (!activeProject) return <div className="p-4 text-center text-muted-foreground">Select a project to view scorecard</div>;
    if (isLoading) return <div className="p-8 flex items-center justify-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading Green Regulations...</div>;
    if (!scorecardData) return <div className="p-4 text-center text-muted-foreground">No Green Regulation data found for this project.</div>;

    const percentage = scorecardData.totalPoints > 0 ? (scorecardData.achievedPoints / scorecardData.totalPoints) * 100 : 0;

    return (
        <div className="h-full flex flex-col bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            {/* Header */}
            <div className="p-4 border-b shrink-0">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Leaf className="h-5 w-5 text-green-500" />
                        Green Scorecard
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

                                                    {/* Auto-calc badge */}
                                                    {(credit.isAuto) && (
                                                        <div className="flex items-center gap-1 mt-1">
                                                            <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal gap-1">
                                                                <Sparkles4Icon className="h-2 w-2" /> Auto-Linked
                                                            </Badge>
                                                            {credit.name.includes('Ventilation') && <span className="text-[10px] text-muted-foreground">(Requires Wind Sim)</span>}
                                                            {credit.name.includes('Location') && <span className="text-[10px] text-muted-foreground">(Requires Map Analysis)</span>}
                                                        </div>
                                                    )}
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
