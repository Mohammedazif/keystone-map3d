
'use client';
import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { useSelectedBuilding, useProjectData } from '@/hooks/use-building-store';
import { AreaChart, Scale, Building, Car, CheckCircle, AlertTriangle, ShieldCheck, DollarSign, LocateFixed, ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

function MetricsTab() {
    const building = useSelectedBuilding();
    const projectData = useProjectData();
    if (!building) return null;

    const kpis = [
        { icon: AreaChart, label: "Buildable Area", value: "TBD", unit: "sqm" },
        { icon: Scale, label: "Floor Area Ratio", value: projectData.far.toFixed(2) },
        { icon: Building, label: "Max Units", value: "TBD" },
        { icon: Car, label: "Parking Spaces", value: "TBD" },
        { icon: Scale, label: "Efficiency", value: "TBD", unit: "%" },
    ];
    return (
        <div className="grid grid-cols-2 gap-4">
            {kpis.map(kpi => (
                 <Card key={kpi.label} className="bg-secondary/50">
                    <CardHeader className="p-4">
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                           <kpi.icon className="h-4 w-4 text-primary"/> {kpi.label}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <span className="text-2xl font-bold">{kpi.value}</span>
                        {kpi.unit && <span className="text-sm text-muted-foreground ml-1">{kpi.unit}</span>}
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}

function MassingOptionsTab() {
    return (
         <div className="text-center text-muted-foreground p-8">
            <p>3D Massing Options will be generated here.</p>
        </div>
    );
}

function FeasibilityTab() {
     const metrics = [
        { icon: ShieldCheck, label: "Compliance", value: "High", color: "bg-green-500" },
        { icon: CheckCircle, label: "Sustainability", value: "Medium", color: "bg-yellow-500" },
        { icon: AlertTriangle, label: "Vastu", value: "Low", color: "bg-red-500" },
        { icon: DollarSign, label: "Financial", value: "High", color: "bg-green-500" },
        { icon: LocateFixed, label: "Locational", value: "Medium", color: "bg-yellow-500" },
    ];
     return (
        <div className="space-y-4">
            {metrics.map(metric => (
                <div key={metric.label} className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                    <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center ${metric.color}`}>
                           <metric.icon className="h-5 w-5 text-white" />
                        </div>
                        <span className="font-medium">{metric.label}</span>
                    </div>
                    <Badge variant="outline">{metric.value}</Badge>
                </div>
            ))}
        </div>
    );
}


export function FeasibilityDashboard() {
  const selectedBuilding = useSelectedBuilding();
  const [isOpen, setIsOpen] = useState(true);

  if (!selectedBuilding) return null;
  
  const cardClasses = "bg-background/80 backdrop-blur-sm border-0 md:border md:bg-secondary/80 md:border-border";

  return (
    <div className={cn(
        "absolute bottom-0 left-0 right-0 z-10 bg-background/80 backdrop-blur-sm border-t border-border overflow-hidden md:relative md:h-auto md:bg-transparent md:border-none transition-all duration-300",
        isOpen ? "h-[40dvh]" : "h-[65px] md:h-auto"
        )}>
        <Card className={`${cardClasses} h-full`}>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>{selectedBuilding.name} Feasibility</CardTitle>
                    <CardDescription>Analysis based on current parameters</CardDescription>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setIsOpen(!isOpen)}>
                    {isOpen ? <ChevronDown /> : <ChevronUp />}
                </Button>
            </CardHeader>
            {isOpen && (
                <CardContent>
                    <Tabs defaultValue="metrics" className="h-full">
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="metrics">KPIs</TabsTrigger>
                            <TabsTrigger value="massing">Massing Options</TabsTrigger>
                            <TabsTrigger value="feasibility">Dashboard</TabsTrigger>
                        </TabsList>
                        <ScrollArea className="h-[25dvh] md:h-[calc(100%-4rem)]">
                            <TabsContent value="metrics" className="pt-4">
                                <MetricsTab />
                            </TabsContent>
                            <TabsContent value="massing" className="pt-4">
                            <MassingOptionsTab />
                            </TabsContent>
                            <TabsContent value="feasibility" className="pt-4">
                            <FeasibilityTab />
                            </TabsContent>
                        </ScrollArea>
                    </Tabs>
                </CardContent>
            )}
        </Card>
    </div>
  );
}
