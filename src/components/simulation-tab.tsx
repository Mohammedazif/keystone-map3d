import React from 'react';
import { CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Sun } from 'lucide-react';
import { AnalysisMode } from './solar-controls';
import { cn } from '@/lib/utils';
import type { GreenRegulationData } from '@/lib/types';
import { parseThresholdsFromRegulation } from '@/lib/engines/visual-analysis-engine';

interface SimulationTabProps {
    date: Date;
    setDate: (d: Date) => void;
    enabled: boolean;
    setEnabled: (b: boolean) => void;
    analysisMode: AnalysisMode;
    setAnalysisMode: (m: AnalysisMode) => void;
    activeGreenRegulations?: GreenRegulationData[];
}

export function SimulationTab({
    date,
    setDate,
    enabled,
    setEnabled,
    analysisMode,
    setAnalysisMode,
    activeGreenRegulations = []
}: SimulationTabProps) {
    const handleTimeChange = (val: number[]) => {
        const newDate = new Date(date);
        newDate.setHours(val[0]);
        const hours = Math.floor(val[0]);
        const minutes = Math.floor((val[0] - hours) * 60);
        newDate.setHours(hours);
        newDate.setMinutes(minutes);
        setDate(newDate);
    };

    const handleMonthChange = (val: number[]) => {
        const newDate = new Date(date);
        newDate.setMonth(val[0]);
        setDate(newDate);
    };

    const timeVal = date.getHours() + date.getMinutes() / 60;

    return (
        <div className="flex flex-col h-full">
            <CardHeader className="py-2 px-3 flex-shrink-0 border-b">
                <CardTitle className="text-sm flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Sun className="h-4 w-4 text-orange-500" />
                        <span>Scenario Simulation</span>
                    </div>
                </CardTitle>
            </CardHeader>

            <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-muted-foreground/20">
                {/* Master Toggle */}
                <div className="flex items-center justify-between bg-muted/20 p-3 rounded-lg border">
                    <Label className="font-medium text-sm">Enable Simulator</Label>
                    <Switch checked={enabled} onCheckedChange={setEnabled} />
                </div>

                {enabled ? (
                    <div className="space-y-6 animate-in fade-in duration-300">
                        {/* Conditional Controls - Hide if mode is 'none' */}
                        {analysisMode !== 'none' ? (
                            <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-500">
                                {/* Time of Day - Hide for Sun Hours */}
                                {analysisMode !== 'sun-hours' && (
                                    <div className="space-y-3">
                                        <div className="flex justify-between text-xs">
                                            <Label className="text-muted-foreground font-medium uppercase tracking-wider">Time of Day</Label>
                                            <span className="font-mono text-foreground">{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                        <Slider
                                            min={6}
                                            max={18}
                                            step={0.25}
                                            value={[timeVal]}
                                            onValueChange={handleTimeChange}
                                            className="cursor-pointer [&_.relative]:h-2 [&_.absolute]:bg-orange-500/20 [&_span]:border-orange-500/50"
                                        />
                                        <div className="flex justify-between text-[10px] text-muted-foreground/50 uppercase font-medium">
                                            <span>Sunrise</span>
                                            <span>Noon</span>
                                            <span>Sunset</span>
                                        </div>
                                    </div>
                                )}

                                {/* Month Slider */}
                                <div className="space-y-3">
                                    <div className="flex justify-between text-xs">
                                        <Label className="text-muted-foreground font-medium uppercase tracking-wider">Month</Label>
                                        <span className="font-mono text-foreground">{date.toLocaleDateString([], { month: 'long' })}</span>
                                    </div>
                                    <Slider
                                        min={0}
                                        max={11}
                                        step={1}
                                        value={[date.getMonth()]}
                                        onValueChange={handleMonthChange}
                                        className="cursor-pointer [&_.relative]:h-2 [&_.absolute]:bg-blue-500/20 [&_span]:border-blue-500/50"
                                    />
                                    <div className="flex justify-between text-[10px] text-muted-foreground/50 uppercase font-medium">
                                        <span>Jan</span>
                                        <span>Jun</span>
                                        <span>Dec</span>
                                    </div>
                                </div>
                                {/* Divider */}
                                <div className="my-2 border-t border-border/50" />
                            </div>
                        ) : (
                            <div className="py-4 text-center text-[10px] text-muted-foreground italic bg-muted/5 rounded-md border border-dashed">
                                Select an analysis layer below to adjust parameters
                            </div>
                        )}

                        {/* Analysis Mode Toggle Grid */}
                        <div className="space-y-4">
                            <Label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Analysis Layer</Label>

                            <div className="grid grid-cols-2 gap-2">
                                {['none', 'sun-hours', 'daylight', 'wind'].map((m) => (
                                    <button
                                        key={m}
                                        onClick={() => setAnalysisMode(m as any)}
                                        className={cn(
                                            "text-xs px-3 py-2 rounded-md border transition-all text-left flex items-center justify-between group",
                                            analysisMode === m
                                                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                                : "bg-background hover:bg-muted text-muted-foreground border-border hover:border-primary/30"
                                        )}
                                    >
                                        <span className="capitalize">{m.replace('-', ' ')}</span>
                                        {analysisMode === m && <div className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
                                    </button>
                                ))}
                            </div>

                            {/* Legend Section */}
                            {analysisMode !== 'none' && (
                                <div className="space-y-3 bg-muted/10 p-3 rounded-md border border-border/50 animate-in zoom-in-95 duration-300">
                                    {activeGreenRegulations && activeGreenRegulations.length > 0 ? (
                                        <>
                                            <div className="flex items-center justify-between">
                                                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Compliance Check</h4>
                                                <div className="flex gap-1">
                                                    {activeGreenRegulations.map((r, i) => (
                                                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                                                            {r.certificationType}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Dynamic Compliance Legend */}
                                            {(() => {
                                                const thresholds = activeGreenRegulations.map(parseThresholdsFromRegulation)
                                                    .reduce((max, curr) => ({
                                                        sunHoursMin: Math.max(max.sunHoursMin || 0, curr.sunHoursMin || 0),
                                                        sunHoursTarget: Math.max(max.sunHoursTarget || 0, curr.sunHoursTarget || 0),
                                                        daylightFactorMin: Math.max(max.daylightFactorMin || 0, curr.daylightFactorMin || 0),
                                                        daylightFactorTarget: Math.max(max.daylightFactorTarget || 0, curr.daylightFactorTarget || 0),
                                                        windSpeedMin: Math.max(max.windSpeedMin || 0, curr.windSpeedMin || 0),
                                                        windSpeedTarget: Math.max(max.windSpeedTarget || 0, curr.windSpeedTarget || 0),
                                                    }), {} as any);

                                                return (
                                                    <div className="space-y-2 text-[10px]">
                                                        {analysisMode === 'sun-hours' && (
                                                            <>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-3 h-3 rounded-sm bg-[#00cc00] shadow-sm" />
                                                                    <span>Exceeds Target ({(thresholds.sunHoursTarget || 4).toFixed(1)}+ hrs)</span>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-3 h-3 rounded-sm bg-[#ffcc00] shadow-sm" />
                                                                    <span>Meets Min ({(thresholds.sunHoursMin || 2).toFixed(1)}-{(thresholds.sunHoursTarget || 4).toFixed(1)} hrs)</span>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-3 h-3 rounded-sm bg-[#ff0000] shadow-sm" />
                                                                    <span>Below Min (&lt; {(thresholds.sunHoursMin || 2).toFixed(1)} hrs)</span>
                                                                </div>
                                                            </>
                                                        )}
                                                        {analysisMode === 'daylight' && (
                                                            <>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-3 h-3 rounded-sm bg-[#00cc00] shadow-sm" />
                                                                    <span>Target Reach ({(thresholds.daylightFactorTarget || 0.04) * 100}%+ DF)</span>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-3 h-3 rounded-sm bg-[#ffcc00] shadow-sm" />
                                                                    <span>Meets Minimum ({(thresholds.daylightFactorMin || 0.02) * 100}%-{(thresholds.daylightFactorTarget || 0.04) * 100}% DF)</span>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-3 h-3 rounded-sm bg-[#ff0000] shadow-sm" />
                                                                    <span>Poor Lighting (&lt; {(thresholds.daylightFactorMin || 0.02) * 100}% DF)</span>
                                                                </div>
                                                            </>
                                                        )}
                                                        {analysisMode === 'wind' && (
                                                            <>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-3 h-3 rounded-sm bg-[#00cc00] shadow-sm" />
                                                                    <span>Good Ventilation ({(thresholds.windSpeedTarget || 1.2).toFixed(1)}+ m/s)</span>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-3 h-3 rounded-sm bg-[#ffcc00] shadow-sm" />
                                                                    <span>Fair/Meets ({(thresholds.windSpeedMin || 0.6).toFixed(1)}-{(thresholds.windSpeedTarget || 1.2).toFixed(1)} m/s)</span>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-3 h-3 rounded-sm bg-[#ff0000] shadow-sm" />
                                                                    <span>Stagnant (&lt; {(thresholds.windSpeedMin || 0.6).toFixed(1)} m/s)</span>
                                                                </div>
                                                            </>
                                                        )}
                                                        {!['sun-hours', 'daylight', 'wind'].includes(analysisMode) && (
                                                            <p className="text-muted-foreground italic">Compliance check not supported for this mode.</p>
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                        </>
                                    ) : (
                                        <>
                                            <div className="flex justify-between text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                                                <span>Low Impact</span>
                                                <span>High Impact</span>
                                            </div>
                                            <div className="h-2.5 w-full rounded-full bg-gradient-to-r from-blue-600 via-green-500 to-red-500 shadow-inner" />
                                            <p className="text-[10px] text-center text-muted-foreground pt-1 italic">
                                                {analysisMode === 'sun-hours' && "Cumulative sun exposure over the day"}
                                                {analysisMode === 'daylight' && "Visibility of the sky from surface"}
                                                {analysisMode === 'wind' && "Wind pressure from prevailing direction"}
                                            </p>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-40 text-center space-y-2 text-muted-foreground">
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                            <Sun className="h-5 w-5 opacity-50" />
                        </div>
                        <p className="text-xs max-w-[200px]">
                            Enable simulation to visualize environmental impact on your design.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
