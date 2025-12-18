'use client';

import { useSelectedBuilding } from '@/hooks/use-building-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Thermometer, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SoilDataDisplay({ className }: { className?: string }) {
  const selectedBuilding = useSelectedBuilding();

  const renderValue = (value: number | null | undefined, unit: string) => {
    if (value === undefined) {
      return <Skeleton className="h-5 w-20 bg-muted" />;
    }
    if (value === null) {
      return <span className="text-muted-foreground">N/A</span>;
    }
    return (
      <span>
        {value.toFixed(2)} {unit}
      </span>
    );
  };
  
  if (!selectedBuilding) {
     return null
  }

  return (
    <Card className={cn("bg-secondary border-border", className)}>
      <CardHeader>
        <CardTitle className="text-lg">Soil Data (Centroid)</CardTitle>
        <p className="text-xs text-muted-foreground font-mono">
            {selectedBuilding.centroid?.geometry.coordinates[0].toFixed(4)}, {selectedBuilding.centroid?.geometry.coordinates[1].toFixed(4)}
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Thermometer className="h-4 w-4 text-primary" />
            <span>pH (0-5cm)</span>
          </div>
          <div className="font-semibold">
            {renderValue(selectedBuilding.soilData?.ph, '')}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Layers className="h-4 w-4 text-primary" />
            <span>Bulk Density</span>
          </div>
          <div className="font-semibold">
            {renderValue(selectedBuilding.soilData?.bd, 'kg/dm³')}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
