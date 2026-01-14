'use client';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { DEFAULT_TIME_PARAMETERS } from '@/lib/default-data/time-parameters';
import type { TimeEstimationParameter } from '@/lib/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Slider } from './ui/slider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { toast } from '@/hooks/use-toast';
import { Loader2, Plus, Trash2, Clock, Calendar, RefreshCw } from 'lucide-react';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from './ui/alert-dialog';
import { Separator } from './ui/separator';

const BUILDING_TYPES: TimeEstimationParameter['building_type'][] = [
    'Residential', 'Commercial', 'Mixed Use', 'Industrial', 'Public'
];

const HEIGHT_CATEGORIES: TimeEstimationParameter['height_category'][] = [
    'Low-Rise (<15m)', 'Mid-Rise (15-45m)', 'High-Rise (>45m)'
];

export function TimeEstimationPanel() {
    const [params, setParams] = useState<TimeEstimationParameter[]>([]);
    const [selectedParam, setSelectedParam] = useState<TimeEstimationParameter | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

    // Form state
    const [formData, setFormData] = useState<Partial<TimeEstimationParameter>>({
        building_type: 'Residential',
        height_category: 'Mid-Rise (15-45m)',
        excavation_timeline_months: 3,
        foundation_timeline_months: 4,
        structure_per_floor_days: 12,
        finishing_per_floor_days: 15,
        services_overlap_factor: 0.5,
        contingency_buffer_months: 3
    });

    const paramsCollection = collection(db, 'time_parameters');

    const fetchParams = async () => {
        setIsLoading(true);
        try {
            const snapshot = await getDocs(paramsCollection);
            const data = snapshot.docs.map(doc => doc.data() as TimeEstimationParameter);
            setParams(data.sort((a, b) => a.building_type.localeCompare(b.building_type)));
        } catch (error) {
            console.error("Error fetching time parameters:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch time parameters.' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleLoadDefaults = async () => {
        setIsLoading(true);
        try {
            const batch = writeBatch(db);
            const now = new Date().toISOString();

            DEFAULT_TIME_PARAMETERS.forEach((param) => {
                const id = `${param.building_type}-${param.height_category.split(' ')[0]}`;
                const docRef = doc(paramsCollection, id);
                batch.set(docRef, {
                    ...param,
                    id,
                    last_updated: now,
                });
            });

            await batch.commit();
            toast({ title: 'Success', description: 'Default time parameters loaded.' });
            fetchParams();
        } catch (error) {
            console.error("Error loading defaults:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not load default time parameters.' });
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchParams();
    }, []);

    const handleSelectParam = (param: TimeEstimationParameter) => {
        setSelectedParam(param);
        setFormData(param);
        setIsEditing(false);
    };

    const handleNewParam = () => {
        setSelectedParam(null);
        setFormData({
            building_type: 'Residential',
            height_category: 'Mid-Rise (15-45m)',
            excavation_timeline_months: 3,
            foundation_timeline_months: 4,
            structure_per_floor_days: 12,
            finishing_per_floor_days: 15,
            services_overlap_factor: 0.5,
            contingency_buffer_months: 3
        });
        setIsEditing(true);
    };

    const handleSave = async () => {
        if (!formData.building_type || !formData.height_category) {
            toast({ variant: 'destructive', title: 'Validation Error', description: 'Building Type and Height Category are required.' });
            return;
        }

        setIsSaving(true);
        try {
            const id = selectedParam?.id || `${formData.building_type}-${formData.height_category.split(' ')[0]}-${Date.now()}`;
            const now = new Date().toISOString();

            const paramData: TimeEstimationParameter = {
                id,
                building_type: formData.building_type!,
                height_category: formData.height_category!,
                excavation_timeline_months: formData.excavation_timeline_months || 0,
                foundation_timeline_months: formData.foundation_timeline_months || 0,
                structure_per_floor_days: formData.structure_per_floor_days || 0,
                finishing_per_floor_days: formData.finishing_per_floor_days || 0,
                services_overlap_factor: formData.services_overlap_factor || 0,
                contingency_buffer_months: formData.contingency_buffer_months || 0,
                last_updated: now
            };

            await setDoc(doc(paramsCollection, id), paramData);

            setParams(prev => {
                const filtered = prev.filter(p => p.id !== id);
                return [...filtered, paramData].sort((a, b) => a.building_type.localeCompare(b.building_type));
            });

            setSelectedParam(paramData);
            setIsEditing(false);
            toast({ title: 'Success', description: 'Time parameters saved successfully.' });
        } catch (error) {
            console.error("Error saving parameters:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not save parameters.' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteDoc(doc(paramsCollection, id));
            setParams(prev => prev.filter(p => p.id !== id));
            if (selectedParam?.id === id) {
                setSelectedParam(null);
            }
            toast({ title: 'Deleted', description: 'Time parameters deleted successfully.' });
        } catch (error) {
            console.error("Error deleting parameters:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not delete parameters.' });
        }
    };

    // Calculate sample timeline for preview
    const sampleFloors = 20;
    const structureTime = (formData.structure_per_floor_days || 0) * sampleFloors / 30; // months
    const finishingTime = (formData.finishing_per_floor_days || 0) * sampleFloors / 30; // months
    const overlap = finishingTime * (formData.services_overlap_factor || 0); // months saved
    const estimatedTotal = (formData.excavation_timeline_months || 0) +
        (formData.foundation_timeline_months || 0) +
        structureTime +
        finishingTime - overlap +
        (formData.contingency_buffer_months || 0);

    const groupedParams = params.reduce((acc, param) => {
        const key = param.building_type;
        if (!acc[key]) acc[key] = [];
        acc[key].push(param);
        return acc;
    }, {} as Record<string, TimeEstimationParameter[]>);

    return (
        <div className="grid grid-cols-[300px_1fr] gap-6 h-full">
            {/* Left Sidebar */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Time Estimates</h3>
                    <Button size="sm" onClick={handleNewParam}>
                        <Plus className="h-4 w-4 mr-1" /> New
                    </Button>
                </div>

                <ScrollArea className="h-[calc(100vh-200px)]">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {Object.entries(groupedParams).map(([type, items]) => (
                                <div key={type}>
                                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                        {type}
                                    </div>
                                    <div className="space-y-1">
                                        {items.map(param => (
                                            <Card
                                                key={param.id}
                                                className={`cursor-pointer transition-all hover:shadow-md ${selectedParam?.id === param.id ? 'border-primary bg-primary/5' : ''}`}
                                                onClick={() => handleSelectParam(param)}
                                            >
                                                <CardHeader className="p-3">
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex-1">
                                                            <CardTitle className="text-sm">{param.height_category}</CardTitle>
                                                            <CardDescription className="text-xs mt-1">
                                                                {param.structure_per_floor_days} days/floor
                                                            </CardDescription>
                                                        </div>
                                                        <Clock className="h-4 w-4 text-muted-foreground" />
                                                    </div>
                                                </CardHeader>
                                            </Card>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>
            </div>

            {/* Right Panel */}
            <div>
                {selectedParam || isEditing ? (
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle>
                                        {isEditing ? (selectedParam ? 'Edit Timelines' : 'New Configuration') : `${formData.building_type} - ${formData.height_category}`}
                                    </CardTitle>
                                    <CardDescription>
                                        Configure construction phases and duration benchmarks
                                    </CardDescription>
                                </div>
                                <div className="flex gap-2">
                                    {!isEditing ? (
                                        <>
                                            <Button variant="outline" onClick={() => setIsEditing(true)}>Edit</Button>
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="destructive" size="icon">
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Delete Parameters?</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            This will permanently delete this time configuration.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => selectedParam && handleDelete(selectedParam.id)}>
                                                            Delete
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </>
                                    ) : (
                                        <>
                                            <Button variant="outline" onClick={() => {
                                                setIsEditing(false);
                                                if (selectedParam) setFormData(selectedParam);
                                            }}>
                                                Cancel
                                            </Button>
                                            <Button onClick={handleSave} disabled={isSaving}>
                                                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="type">Building Type</Label>
                                    <Select
                                        value={formData.building_type}
                                        onValueChange={(v: any) => setFormData({ ...formData, building_type: v })}
                                        disabled={!isEditing}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {BUILDING_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="height">Height Category</Label>
                                    <Select
                                        value={formData.height_category}
                                        onValueChange={(v: any) => setFormData({ ...formData, height_category: v })}
                                        disabled={!isEditing}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {HEIGHT_CATEGORIES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <Separator />

                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <h4 className="text-sm font-semibold flex items-center gap-2">
                                        <Calendar className="h-4 w-4" /> Phase 1: Substructure
                                    </h4>
                                    <div className="space-y-2">
                                        <Label>Excavation (Months)</Label>
                                        <Input
                                            type="number"
                                            value={formData.excavation_timeline_months}
                                            onChange={e => setFormData({ ...formData, excavation_timeline_months: parseFloat(e.target.value) })}
                                            disabled={!isEditing}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Foundation (Months)</Label>
                                        <Input
                                            type="number"
                                            value={formData.foundation_timeline_months}
                                            onChange={e => setFormData({ ...formData, foundation_timeline_months: parseFloat(e.target.value) })}
                                            disabled={!isEditing}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <h4 className="text-sm font-semibold flex items-center gap-2">
                                        <Clock className="h-4 w-4" /> Phase 2: Superstructure
                                    </h4>
                                    <div className="space-y-2">
                                        <Label>Structure Speed (Days/Floor)</Label>
                                        <Input
                                            type="number"
                                            value={formData.structure_per_floor_days}
                                            onChange={e => setFormData({ ...formData, structure_per_floor_days: parseFloat(e.target.value) })}
                                            disabled={!isEditing}
                                        />
                                        <p className="text-xs text-muted-foreground">Time to cast one complete slab</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Finishing Speed (Days/Floor)</Label>
                                        <Input
                                            type="number"
                                            value={formData.finishing_per_floor_days}
                                            onChange={e => setFormData({ ...formData, finishing_per_floor_days: parseFloat(e.target.value) })}
                                            disabled={!isEditing}
                                        />
                                    </div>
                                </div>
                            </div>

                            <Separator />

                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold">Phase 3: Overlap & Buffers</h4>
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <div className="flex justify-between">
                                            <Label>Services Overlap Factor ({((formData.services_overlap_factor || 0) * 100).toFixed(0)}%)</Label>
                                        </div>
                                        <Slider
                                            value={[formData.services_overlap_factor || 0]}
                                            min={0}
                                            max={1}
                                            step={0.1}
                                            onValueChange={([v]) => setFormData({ ...formData, services_overlap_factor: v })}
                                            disabled={!isEditing}
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            0% = Sequential (Finishing starts after structure), 100% = Fully Parallel
                                        </p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Contingency Buffer (Months)</Label>
                                        <Input
                                            type="number"
                                            value={formData.contingency_buffer_months}
                                            onChange={e => setFormData({ ...formData, contingency_buffer_months: parseFloat(e.target.value) })}
                                            disabled={!isEditing}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Preview Calculation */}
                            <div className="bg-secondary/30 p-4 rounded-lg mt-4">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-semibold">Sample Timeline (20 Floors)</span>
                                    <Badge variant="secondary">{estimatedTotal.toFixed(1)} Months</Badge>
                                </div>
                                <div className="text-xs text-muted-foreground space-y-1">
                                    <div className="flex justify-between">
                                        <span>Substructure:</span>
                                        <span>{((formData.excavation_timeline_months || 0) + (formData.foundation_timeline_months || 0))} months</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Superstructure:</span>
                                        <span>{structureTime.toFixed(1)} months</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Finishing (Buffered):</span>
                                        <span>{(finishingTime - overlap).toFixed(1)} months</span>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                        <div className="text-center">
                            <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p className="mb-4">Select or configure time parameters</p>
                            {params.length === 0 && (
                                <Button variant="outline" onClick={handleLoadDefaults} disabled={isLoading}>
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Load Default Timelines
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
