'use client';

import React, { useMemo } from 'react';
import { CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useBuildingStore, useSelectedPlot } from '@/hooks/use-building-store';
import { Loader2, Globe, Info, MousePointer2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BHUVAN_THEMES, getIndianStateCode } from '@/lib/bhuvan-utils';

interface BhuvanPanelProps {
  embedded?: boolean;
}

export function BhuvanPanel({ embedded = false }: BhuvanPanelProps) {
  const { activeBhuvanLayer, activeBhuvanOpacity, bhuvanData, isFetchingBhuvan, actions } = useBuildingStore(s => ({
    activeBhuvanLayer: s.activeBhuvanLayer,
    activeBhuvanOpacity: s.activeBhuvanOpacity,
    bhuvanData: s.bhuvanData,
    isFetchingBhuvan: s.isFetchingBhuvan,
    actions: s.actions
  }));

  const selectedPlot = useSelectedPlot();

  const stateCode = useMemo(() => {
    if (selectedPlot && selectedPlot.geometry) {
      try {
        const coords = selectedPlot.geometry.coordinates[0][0];
        return getIndianStateCode(coords[1], coords[0]);
      } catch (e) {
        return 'IN';
      }
    }
    return 'IN';
  }, [selectedPlot]);

  const activeTheme = BHUVAN_THEMES.find(t => t.id === activeBhuvanLayer);

  return (
    <div className={cn("flex flex-col h-full", embedded ? "" : "w-full max-h-[calc(100vh-200px)]")}>
      <div className="p-4 border-b shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Globe className="h-5 w-5 text-blue-500" />
            Thematic Services
          </h2>
          {stateCode !== 'IN' && (
            <Badge variant="secondary" className="text-[10px] font-mono">
              Region: {stateCode}
            </Badge>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-4">
          <div className="space-y-4">
            <Label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
              Select Thematic Layer
            </Label>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => actions.setActiveBhuvanLayer(null)}
                className={cn(
                  "text-xs px-3 py-2 rounded-md border transition-all text-left flex flex-col items-start justify-center col-span-2 group relative",
                  !activeBhuvanLayer
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-background hover:bg-muted text-muted-foreground border-border hover:border-primary/30"
                )}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="capitalize font-medium">None (Hide Overlays)</span>
                  {!activeBhuvanLayer && <div className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
                </div>
              </button>

              {/* Group themes by categoryId */}
              {Array.from(new Set(BHUVAN_THEMES.map(t => t.categoryId || t.id))).map(categoryId => {
                const categoryThemes = BHUVAN_THEMES.filter(t => (t.categoryId || t.id) === categoryId);
                const isCategoryActive = categoryThemes.some(t => t.id === activeBhuvanLayer);
                const primaryTheme = categoryThemes[0];
                const categoryName = primaryTheme.categoryName || primaryTheme.name;

                return (
                  <div key={categoryId} className="flex flex-col gap-2">
                    <button
                      title={primaryTheme.description}
                      onClick={() => !isCategoryActive && actions.setActiveBhuvanLayer(primaryTheme.id)}
                      className={cn(
                        "text-xs px-3 py-2 rounded-md border transition-all text-left flex flex-col items-start justify-center group relative h-16",
                        isCategoryActive
                          ? "bg-primary text-primary-foreground border-primary shadow-sm"
                          : "bg-background hover:bg-muted text-muted-foreground border-border hover:border-primary/30"
                      )}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="capitalize font-medium">{categoryName}</span>
                        {isCategoryActive && (
                          <div className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                        )}
                      </div>
                      <span className={cn(
                        "text-[9px] mt-0.5 opacity-80 line-clamp-2",
                        isCategoryActive ? "text-primary-foreground/80" : "text-muted-foreground"
                      )}>
                        {primaryTheme.description}
                      </span>
                    </button>

                    {isCategoryActive && categoryThemes.length > 1 && (
                      <div className="flex flex-col gap-1.5 pl-2 pb-2 border-l-2 border-primary/20 ml-2 animate-in slide-in-from-top-2">
                        <Label className="text-[9px] text-muted-foreground uppercase tracking-wider ml-1 mt-1">Select Year</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {categoryThemes.map(variant => (
                            <button
                              key={variant.id}
                              onClick={() => actions.setActiveBhuvanLayer(variant.id)}
                              className={cn(
                                "text-[10px] px-2.5 py-1 rounded-full border transition-colors",
                                activeBhuvanLayer === variant.id
                                  ? "bg-primary/20 border-primary text-foreground"
                                  : "bg-muted/50 border-transparent text-muted-foreground hover:bg-muted"
                              )}
                            >
                              {variant.name.replace(categoryName, '').replace(/[() ]/g, '') || 'Latest'}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {activeTheme && (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
              
              {/* Opacity Control */}
              <div className="space-y-3 bg-muted/10 p-3 rounded-md border border-border/50">
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Overlay Opacity
                  </Label>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {Math.round(activeBhuvanOpacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={activeBhuvanOpacity}
                  onChange={(e) => actions.setBhuvanOpacity(parseFloat(e.target.value))}
                  className="w-full accent-primary h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer"
                />
              </div>

              {/* Legend Section */}
              <div className="space-y-3 bg-muted/10 p-3 rounded-md border border-border/50">
                <div className="flex items-center gap-1.5 mb-1">
                  <Info className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {activeTheme.name} Legend
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px]">
                  {activeTheme.legend.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-sm shadow-sm shrink-0 border border-black/10" 
                        style={{ backgroundColor: item.color }} 
                      />
                      <span className="truncate text-muted-foreground">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Feature Info Section */}
              <div className="space-y-3 bg-muted/10 p-3 rounded-md border border-border/50">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <MousePointer2 className="h-3 w-3 text-primary" />
                    <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">
                      Selected Feature Info
                    </span>
                  </div>
                  {isFetchingBhuvan && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                </div>

                {bhuvanData ? (
                  <div className="text-[11px] leading-relaxed max-h-40 overflow-auto scrollbar-thin overflow-x-hidden w-full">
                    <div 
                      className="bhuvan-info-content prose prose-invert prose-xs [&_table]:w-full [&_table]:table-fixed [&_table]:text-[10px] [&_th]:whitespace-nowrap [&_th]:text-left [&_th]:p-1.5 [&_th]:!bg-secondary/50 [&_th]:border-b [&_td]:p-1.5 [&_td]:border-b [&_td]:border-border/30 [&_td]:break-all [&_td]:overflow-hidden [&_td]:max-w-0 [&_table]:!bg-transparent [&_tr]:!bg-transparent [&_td]:!bg-transparent [&_td]:!text-foreground [&_th]:!text-foreground"
                      dangerouslySetInnerHTML={{ __html: bhuvanData }} 
                    />
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground italic text-center py-2">
                    {isFetchingBhuvan ? "Requesting data from NRSC..." : "Click any plot area on the map to query specific classification data."}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
