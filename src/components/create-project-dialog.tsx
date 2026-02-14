'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { RegulationData } from '@/lib/types';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';
import { useBuildingStore } from '@/hooks/use-building-store';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

interface CreateProjectDialogProps {
    children?: React.ReactNode;
}

export function CreateProjectDialog({ children }: CreateProjectDialogProps) {
    const { actions } = useBuildingStore();
    const router = useRouter();

    const [open, setOpen] = useState(false);

    // Wizard State
    const [step, setStep] = useState(1);
    const [newProjectName, setNewProjectName] = useState('');
    const [totalPlotArea, setTotalPlotArea] = useState<number | ''>('');
    const [location, setLocation] = useState('Delhi');
    const [intendedUse, setIntendedUse] = useState<'Residential' | 'Commercial' | 'Mixed Use' | 'Public' | 'Industrial'>('Residential');
    const [greenCertification, setGreenCertification] = useState<('IGBC' | 'GRIHA' | 'LEED' | 'Green Building')[]>([]);
    const [vastuCompliant, setVastuCompliant] = useState(false);
    const [isCreating, setIsCreating] = useState(false);

    // Regulation Selection
    const [availableRegulations, setAvailableRegulations] = useState<RegulationData[]>([]);
    const [selectedRegulationId, setSelectedRegulationId] = useState<string>('');

    // Green Regulations
    const [greenRegulationsList, setGreenRegulationsList] = useState<any[]>([]);
    const [isLoadingGreenRegs, setIsLoadingGreenRegs] = useState(false);

    useEffect(() => {
        const fetchGreenRegs = async () => {
            setIsLoadingGreenRegs(true);
            try {
                const { collection, getDocs } = await import('firebase/firestore'); // Dynamic import
                const snap = await getDocs(collection(db, 'greenRegulations'));
                const regs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setGreenRegulationsList(regs);
            } catch (err) {
                console.error("Failed to load green regulations", err);
            } finally {
                setIsLoadingGreenRegs(false);
            }
        };
        if (open && step === 3) { // Only fetch when needed
            fetchGreenRegs();
        }
    }, [open, step]);

    const groupedGreenRegs = greenRegulationsList.reduce((acc, reg) => {
        const type = reg.certificationType || 'Other';
        if (!acc[type]) acc[type] = [];
        acc[type].push(reg);
        return acc;
    }, {} as Record<string, any[]>);

    // Helper to find the "best" (latest) regulation for a group
    const getBestRegIdForType = (type: string) => {
        const regs = groupedGreenRegs[type] || [];
        if (regs.length === 0) return null;
        // Sort by name descending (assuming Version 6.0 > v.2019 > v2015)
        // This is a simple heuristic; ideally we'd have a 'version' or 'date' field
        const sorted = [...regs].sort((a, b) => b.name.localeCompare(a.name));
        return sorted[0].id;
    };

    // Fetch regulations when location changes
    useEffect(() => {
        const fetchRegulations = async () => {
            if (!location) {
                setAvailableRegulations([]);
                return;
            }
            try {
                const q = query(collection(db, 'regulations'), where('location', '==', location));
                const snap = await getDocs(q);
                if (!snap.empty) {
                    const regs = snap.docs.map(d => ({ id: d.id, ...d.data() } as RegulationData));
                    setAvailableRegulations(regs);
                } else {
                    setAvailableRegulations([]);
                }
            } catch (error) {
                console.error("Error fetching regulations for dialog:", error);
            }
        };
        fetchRegulations();
    }, [location]);

    // Reset selected regulation when Intended Use changes
    useEffect(() => {
        setSelectedRegulationId('');
    }, [intendedUse]);

    const resetForm = () => {
        setStep(1);
        setNewProjectName('');
        setTotalPlotArea('');
        setLocation('Delhi');
        setIntendedUse('Residential');
        setGreenCertification([]);
        setVastuCompliant(false);
    };

    const handleCreateProject = async () => {
        if (!newProjectName.trim()) return;
        setIsCreating(true);

        console.log('[CreateProjectDialog] Creating project with:');
        console.log('  name:', newProjectName);
        console.log('  totalPlotArea:', totalPlotArea);
        console.log('  intendedUse:', intendedUse);
        console.log('  location:', location);
        console.log('  regulationId:', selectedRegulationId);
        console.log('  greenCertification:', greenCertification);
        console.log('  vastuCompliant:', vastuCompliant);

        const newProject = await actions.createProject(
            newProjectName,
            typeof totalPlotArea === 'number' ? totalPlotArea : undefined,
            intendedUse,
            location,
            (selectedRegulationId && selectedRegulationId !== 'generic') ? selectedRegulationId : undefined, // Check for generic or empty
            greenCertification,
            vastuCompliant
        );
        setIsCreating(false);

        if (newProject) {
            setOpen(false);
            resetForm();
            router.push(`/dashboard/project/${newProject.id}`);
        }
    };

    const handleOpenChange = (newOpen: boolean) => {
        setOpen(newOpen);
        if (!newOpen) {
            resetForm(); // Reset on close
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                {children}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>Create New Project</DialogTitle>
                    <DialogDescription>
                        Step {step} of 3: {step === 1 ? 'Project Details' : step === 2 ? 'Intended Use' : 'Compliance & Sustainability'}
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    {step === 1 && (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="project-name">Project Name</Label>
                                <Input
                                    id="project-name"
                                    placeholder="e.g. Skyline Towers"
                                    value={newProjectName}
                                    onChange={(e) => setNewProjectName(e.target.value)}
                                    autoFocus
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="total-plot-area">Total Plot Area (m²)</Label>
                                <Input
                                    id="total-plot-area"
                                    type="number"
                                    placeholder="e.g. 5000"
                                    value={totalPlotArea}
                                    onChange={(e) => setTotalPlotArea(e.target.value === '' ? '' : parseFloat(e.target.value))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="location">Project Location</Label>
                                <Select value={location} onValueChange={setLocation}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select State/UT" />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-[200px]">
                                        {[
                                            "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
                                            "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa",
                                            "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka",
                                            "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
                                            "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
                                            "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"
                                        ].map(state => (
                                            <SelectItem key={state} value={state}>{state}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-4">
                            <Label>What is the primary intended use?</Label>
                            <div className="grid grid-cols-2 gap-3">
                                {['Residential', 'Commercial', 'Mixed Use', 'Public', 'Industrial'].map((use) => (
                                    <div
                                        key={use}
                                        className={cn(
                                            "cursor-pointer rounded-lg border-2 p-4 hover:border-primary/50 transition-all",
                                            intendedUse === use ? "border-primary bg-primary/5" : "border-muted"
                                        )}
                                        onClick={() => setIntendedUse(use as any)}
                                    >
                                        <div className="font-semibold">{use}</div>
                                        <div className="text-xs text-muted-foreground mt-1">
                                            {use === 'Residential' && 'Housing complexes, apartments, villas.'}
                                            {use === 'Commercial' && 'Offices, retail, shopping malls.'}
                                            {use === 'Mixed Use' && 'Combination of residential and commercial.'}
                                            {use === 'Public' && 'Schools, hospitals, government buildings.'}
                                            {use === 'Industrial' && 'Factories, warehouses, logistics.'}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Regulation Selection */}
                            <div className="pt-2 space-y-2">
                                <Label>Applicable Regulation Standard</Label>
                                <Select value={selectedRegulationId} onValueChange={setSelectedRegulationId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select specific regulation (Optional)" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="generic">Use Default / Generic</SelectItem>
                                        {availableRegulations
                                            .filter(r => r.type && (
                                                r.type === intendedUse ||
                                                r.type.toLowerCase().includes(intendedUse.toLowerCase())
                                            ))
                                            .map(r => (
                                                <SelectItem key={r.id} value={r.id || 'unknown'}>{r.type}</SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                                {availableRegulations.filter(r => r.type && r.type.toLowerCase().includes(intendedUse.toLowerCase())).length === 0 && (
                                    <p className="text-xs text-muted-foreground">No specific regulations found for {intendedUse}. Generic defaults will be applied.</p>
                                )}
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-6">
                            <div className="space-y-3">
                                <Label>Green Building Certification Goals</Label>
                                <div className="grid grid-cols-2 gap-3">
                                    {isLoadingGreenRegs ? (
                                        <div className="text-sm text-muted-foreground">Loading regulations...</div>
                                    ) : (
                                        <div className="grid grid-cols-1 gap-3 w-full">
                                            {(Object.entries(groupedGreenRegs) as [string, any[]][]).map(([type, regs]) => {
                                                const bestId = getBestRegIdForType(type);
                                                const isSelected = greenCertification.includes(bestId as any);

                                                return (
                                                    <div
                                                        key={type}
                                                        className={cn(
                                                            "flex items-center justify-between rounded-lg border p-4 cursor-pointer hover:bg-accent transition-colors",
                                                            isSelected ? "border-primary bg-primary/5" : "border-border"
                                                        )}
                                                        onClick={() => {
                                                            // Single Selection across types
                                                            if (isSelected) {
                                                                setGreenCertification([]);
                                                            } else if (bestId) {
                                                                setGreenCertification([bestId as any]);
                                                            }
                                                        }}
                                                    >
                                                        <div className="flex items-center space-x-4">
                                                            <div className={cn(
                                                                "h-10 w-10 rounded-full flex items-center justify-center font-bold text-xs",
                                                                isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                                                            )}>
                                                                {type.substring(0, 4).toUpperCase()}
                                                            </div>
                                                            <div className="flex flex-col">
                                                                <span className="text-sm font-semibold">{type} Certification</span>
                                                                <span className="text-xs text-muted-foreground">
                                                                    {regs.length} standard{regs.length > 1 ? 's' : ''} found • Using latest version
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className={cn(
                                                            "h-6 w-6 rounded-full border-2 flex items-center justify-center",
                                                            isSelected ? "border-primary" : "border-muted"
                                                        )}>
                                                            {isSelected && <div className="h-3 w-3 bg-primary rounded-full" />}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {greenRegulationsList.length === 0 && !isLoadingGreenRegs && (
                                        <div className="text-sm text-muted-foreground italic">No green regulations found. Please upload them in Admin Panel.</div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center justify-between rounded-lg border p-4 space-x-4">
                                <div className="space-y-0.5">
                                    <Label className="text-base">Vastu Compliance</Label>
                                    <p className="text-sm text-muted-foreground">
                                        Optimize layout for Vastu Shastra principles?
                                    </p>
                                </div>
                                <div
                                    className={cn(
                                        "w-11 h-6 bg-muted rounded-full relative cursor-pointer transition-colors",
                                        vastuCompliant ? "bg-primary" : "bg-input"
                                    )}
                                    onClick={() => setVastuCompliant(!vastuCompliant)}
                                >
                                    <div className={cn(
                                        "absolute top-0.5 left-0.5 h-5 w-5 bg-background rounded-full shadow-sm transition-transform",
                                        vastuCompliant ? "translate-x-5" : "translate-x-0"
                                    )} />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter className="flex justify-between sm:justify-between">
                    {step > 1 ? (
                        <Button variant="outline" onClick={() => setStep(step - 1)}>
                            Back
                        </Button>
                    ) : (
                        <div /> // Spacer
                    )}
                    {step < 3 ? (
                        <Button onClick={() => setStep(step + 1)} disabled={step === 1 && !newProjectName.trim()}>
                            Next Step
                        </Button>
                    ) : (
                        <Button onClick={handleCreateProject} disabled={isCreating}>
                            {isCreating ? 'Creating...' : 'Create Project'}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
