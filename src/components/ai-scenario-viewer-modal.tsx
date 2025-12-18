
'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { useBuildingStore, useSelectedPlot } from '@/hooks/use-building-store';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Building2, Trees, Car, Check } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { AiScenario } from '@/lib/types';
import { Badge } from './ui/badge';

export function AiScenarioViewerModal() {
  const { aiScenarios, actions } = useBuildingStore();
  const selectedPlot = useSelectedPlot();

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      actions.clearAiScenarios();
    }
  };

  const handleApplyScenario = (scenario: AiScenario) => {
    if (selectedPlot) {
      actions.applyAiLayout(selectedPlot.id, scenario);
    }
  };

  if (!aiScenarios || aiScenarios.length === 0) {
    return null;
  }

  const iconMap = {
    Building: Building2,
    GreenArea: Trees,
    ParkingArea: Car,
  };

  return (
    <Dialog open={true} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Generated Scenarios</DialogTitle>
          <DialogDescription>
            The AI has generated the following layout scenarios for your plot. Review them and apply the one you prefer.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          <Tabs defaultValue={aiScenarios[0].name} className="h-full flex flex-col">
            <TabsList className="grid w-full grid-cols-2">
              {aiScenarios.map((scenario) => (
                <TabsTrigger key={scenario.name} value={scenario.name}>
                  {scenario.name}
                </TabsTrigger>
              ))}
            </TabsList>
            {aiScenarios.map((scenario) => (
              <TabsContent key={scenario.name} value={scenario.name} className="flex-1 overflow-hidden">
                <Card className="h-full flex flex-col border-0 shadow-none">
                  <CardHeader>
                    <CardTitle>{scenario.name}</CardTitle>
                    <CardDescription>{scenario.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-auto">
                    <ScrollArea className="h-full pr-4">
                      <div className="space-y-4">
                        {scenario.objects.map((obj, index) => {
                          const Icon = iconMap[obj.type] || Building2;
                          return (
                            <div key={index} className="flex items-start gap-4 p-3 bg-secondary rounded-lg">
                              <Icon className="h-5 w-5 mt-1 text-primary" />
                              <div className="flex-1">
                                <p className="font-semibold">{obj.name}</p>
                                <div className="text-sm text-muted-foreground flex items-center gap-4">
                                  <Badge variant="outline">{obj.type}</Badge>
                                  {obj.numFloors && <p>Floors: {obj.numFloors}</p>}
                                  {obj.intendedUse && <p>Use: {obj.intendedUse}</p>}
                                </div>
                                <p className='text-xs mt-1 text-muted-foreground/80'>Placement: in "{obj.placement}" zone</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </CardContent>
                  <DialogFooter className="pt-4 mt-auto border-t">
                    <Button onClick={() => handleApplyScenario(scenario)}>
                        <Check className="mr-2 h-4 w-4" />
                        Apply Scenario
                    </Button>
                  </DialogFooter>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
