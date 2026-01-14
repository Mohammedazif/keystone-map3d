import React from 'react';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Sun } from 'lucide-react';

export type AnalysisMode = 'none' | 'sun-hours' | 'daylight' | 'wind';

interface SolarControlsProps {
    date: Date;
    setDate: (d: Date) => void;
    enabled: boolean;
    setEnabled: (b: boolean) => void;
    analysisMode: AnalysisMode;
    setAnalysisMode: (m: AnalysisMode) => void;
}

export function SolarControls({ date, setDate, enabled, setEnabled, analysisMode, setAnalysisMode }: SolarControlsProps) {
    const handleTimeChange = (val: number[]) => {
        const newDate = new Date(date);
        newDate.setHours(val[0]);
        // Preserve minutes? Simplify to just hours for now, or float logic
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

    // Convert time to float for slider
    const timeVal = date.getHours() + date.getMinutes() / 60;

    return (
        <Card className="absolute bottom-6 left-6 z-10 w-80 p-4 bg-background/95 backdrop-blur shadow-xl border-border/50">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Sun className="h-4 w-4 text-orange-500" />
                    <h3 className="font-semibold text-sm">Solar Simulation</h3>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            {enabled && (
                <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <Label>Time of Day</Label>
                            <span>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <Slider
                            min={6}
                            max={18}
                            step={0.25}
                            value={[timeVal]}
                            onValueChange={handleTimeChange}
                            className="cursor-pointer"
                        />
                        <div className="flex justify-between text-[10px] text-muted-foreground/70 px-1">
                            <span>6 AM</span>
                            <span>12 PM</span>
                            <span>6 PM</span>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <Label>Month</Label>
                            <span>{date.toLocaleDateString([], { month: 'long' })}</span>
                        </div>
                        <Slider
                            min={0}
                            max={11}
                            step={1}
                            value={[date.getMonth()]}
                            onValueChange={handleMonthChange}
                            className="cursor-pointer"
                        />
                        <div className="flex justify-between text-[10px] text-muted-foreground/70 px-1">
                            <span>Jan</span>
                            <span>Jun</span>
                            <span>Dec</span>
                        </div>
                    </div>

                    <div className="pt-2 border-t border-border/50 space-y-3">
                        <div className="space-y-2">
                            <Label className="text-xs">Advanced Analysis (Heatmap)</Label>
                            <div className="grid grid-cols-2 gap-2">
                                {['none', 'sun-hours', 'daylight', 'wind'].map((m) => (
                                    <button
                                        key={m}
                                        onClick={() => setAnalysisMode(m as any)}
                                        className={`text-[10px] px-2 py-1 rounded border capitalize transition-colors ${analysisMode === m
                                            ? 'bg-primary text-primary-foreground border-primary'
                                            : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted'
                                            }`}
                                    >
                                        {m.replace('-', ' ')}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {analysisMode !== 'none' && (
                            <div className="space-y-1">
                                <div className="flex justify-between text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                                    <span>Low</span>
                                    <span>High</span>
                                </div>
                                <div className="h-2 w-full rounded-full bg-gradient-to-r from-blue-600 via-green-500 to-red-500 shadow-inner" />
                                <div className="text-[10px] text-center text-muted-foreground italic">
                                    {analysisMode === 'sun-hours' ? 'Sun Exposure' :
                                        analysisMode === 'daylight' ? 'Sky Visibility' :
                                            'Wind Pressure'}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </Card>
    );
}
