
'use client';
import { useEffect, useState, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, doc, getDocs, setDoc, writeBatch, deleteDoc, getDoc } from 'firebase/firestore';
import type { RegulationData } from '@/lib/types';
import { Button } from './ui/button';
import { toast } from '@/hooks/use-toast';
import { Loader2, Plus, Building, Scaling, Droplets, ShieldCheck, Banknote, Trash2, Upload } from 'lucide-react';
import { AdminDetailsSidebar } from './admin-details-sidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { cn } from '@/lib/utils';
import { NewRegulationDialog } from './new-regulation-dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Skeleton } from './ui/skeleton';
import { produce } from 'immer';
import { UploadRegulationDialog } from './upload-regulation-dialog';


const DEFAULT_REGULATION_DATA: Omit<RegulationData, 'location' | 'type'> = {
    geometry: {
        setback: { desc: "Setback from plot boundary", unit: "m", value: 5, min: 0, max: 20 },
        road_width: { desc: "Adjacent road width", unit: "m", value: 9, min: 6, max: 30 },
        max_ground_coverage: { desc: "Maximum ground coverage", unit: "%", value: 40, min: 10, max: 80 },
        floor_area_ratio: { desc: "Floor Area Ratio (FAR)", unit: "", value: 1.8, min: 0.5, max: 5 },
    },
    facilities: {
        parking: { desc: "Parking requirements per unit", unit: "spaces/unit", value: 1, min: 0.5, max: 3 },
        open_space: { desc: "Required open space per plot", unit: "%", value: 15, min: 5, max: 50 },
    },
    sustainability: {
        rainwater_harvesting: { desc: "Rainwater harvesting capacity", unit: "liters/sqm", value: 30, min: 10, max: 100 },
        solar_panels: { desc: "Solar panel area requirement", unit: "% of roof", value: 20, min: 0, max: 100 },
    },
    safety_and_services: {
        fire_safety: { desc: "Fire safety compliance level", unit: "", value: 1, min: 1, max: 3 },
    },
    administration: {
        fee_rate: { desc: "Processing fee rate", unit: "% of cost", value: 0.1, min: 0.05, max: 1 },
    }
};

export function AdminPanel() {
    const [regulations, setRegulations] = useState<RegulationData[]>([]);
    const [selectedRegulation, setSelectedRegulation] = useState<RegulationData | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isNewRegDialogOpen, setIsNewRegDialogOpen] = useState(false);
    const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const regulationsCollection = collection(db, 'regulations');

    const fetchRegulations = async () => {
        setIsLoading(true);
        try {
            const snapshot = await getDocs(regulationsCollection);
            const data = snapshot.docs.map(doc => doc.data() as RegulationData);
            setRegulations(data);
        } catch (error) {
            console.error("Error fetching regulations:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch regulations.' });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchRegulations();
    }, []);

    useEffect(() => {
        setSelectedCategory(null);
    }, [selectedRegulation]);

    const categoryDetails = useMemo(() => {
        if (!selectedRegulation || !selectedCategory) return null;

        const categoryKey = selectedCategory as keyof Omit<RegulationData, 'location' | 'type'>;
        const categoryData = selectedRegulation[categoryKey];
        const defaultCategoryData = DEFAULT_REGULATION_DATA[categoryKey];

        return {
            title: selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1).replace(/_/g, ' '),
            data: categoryData || defaultCategoryData,
            path: selectedCategory,
        }
    }, [selectedRegulation, selectedCategory]);

    const handleUpdate = (path: string, value: any) => {
        setSelectedRegulation(produce(draft => {
            if (!draft) return;
            const keys = path.split('.');
            let current: any = draft;
            for (let i = 0; i < keys.length - 1; i++) {
                const key = keys[i];
                if (!current[key]) {
                    current[key] = {};
                }
                current = current[key];
            }
            current[keys[keys.length - 1]] = value;
        }));
    };

    const handleFullUpdate = (updatedData: any) => {
        if (!selectedRegulation || !selectedCategory) return;
        setSelectedRegulation(produce(draft => {
            if (draft) {
                (draft as any)[selectedCategory!] = updatedData;
            }
        }));
    }

    const handleSaveChanges = async () => {
        if (!selectedRegulation) return;
        setIsSaving(true);
        try {
            const docRef = doc(regulationsCollection, `${selectedRegulation.location}-${selectedRegulation.type}`);
            await setDoc(docRef, selectedRegulation, { merge: true });

            setRegulations(prevRegs => prevRegs.map(reg =>
                (reg.location === selectedRegulation.location && reg.type === selectedRegulation.type)
                    ? selectedRegulation
                    : reg
            ));

            toast({ title: 'Success', description: 'Changes saved successfully.' });
        } catch (error) {
            console.error("Error saving changes:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not save changes.' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleCreateRegulation = async (location: string, type: string) => {
        setIsSaving(true);
        const docId = `${location}-${type}`;
        if (regulations.some(reg => `${reg.location}-${reg.type}` === docId)) {
            toast({ variant: 'destructive', title: 'Error', description: 'This regulation already exists.' });
            setIsSaving(false);
            return;
        }

        const newRegulation: RegulationData = {
            ...JSON.parse(JSON.stringify(DEFAULT_REGULATION_DATA)),
            location,
            type,
        };

        try {
            const docRef = doc(regulationsCollection, docId);
            await setDoc(docRef, newRegulation);
            setRegulations(prev => [...prev, newRegulation]);
            setSelectedRegulation(newRegulation);
            toast({ title: 'Success!', description: `${location} - ${type} has been created.` });
        } catch (error) {
            console.error("Error creating regulation:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not create new regulation.' });
        } finally {
            setIsSaving(false);
            setIsNewRegDialogOpen(false);
        }
    };

    const handleDeleteRegulation = async (location: string, type: string) => {
        const docId = `${location}-${type}`;
        setDeletingId(docId);
        try {
            await deleteDoc(doc(regulationsCollection, docId));
            setRegulations(prev => prev.filter(reg => `${reg.location}-${reg.type}` !== docId));
            if (selectedRegulation?.location === location && selectedRegulation?.type === type) {
                setSelectedRegulation(null);
            }
            toast({ title: 'Success', description: 'Regulation deleted successfully.' });
        } catch (error) {
            console.error("Error deleting regulation:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not delete regulation.' });
        } finally {
            setDeletingId(null);
        }
    }

    const handleExtractedRegulation = async (extractedData: Partial<RegulationData>) => {
        console.log('Received extracted data in admin panel:', extractedData);

        if (!extractedData.location || !extractedData.type) {
            console.error('Missing location or type:', { location: extractedData.location, type: extractedData.type });
            toast({ variant: 'destructive', title: 'Error', description: 'Location and type are required.' });
            return;
        }

        const newRegulation: RegulationData = {
            ...JSON.parse(JSON.stringify(DEFAULT_REGULATION_DATA)),
            ...extractedData,
            location: extractedData.location,
            type: extractedData.type,
        };

        console.log('Created new regulation:', newRegulation);

        setSelectedRegulation(newRegulation);
        toast({ title: 'Data Loaded', description: 'Review and save the extracted regulation data.' });
    };


    const handleBackToList = () => {
        setSelectedRegulation(null);
        setSelectedCategory(null);
    };

    const categories: { key: keyof Omit<RegulationData, 'location' | 'type'>, icon: React.ElementType }[] = [
        { key: 'geometry', icon: Scaling },
        { key: 'facilities', icon: Building },
        { key: 'sustainability', icon: Droplets },
        { key: 'safety_and_services', icon: ShieldCheck },
        { key: 'administration', icon: Banknote },
    ];


    if (isLoading) {
        return (
            <div className="min-h-screen bg-background text-foreground flex">
                <div className="flex-1">
                    <header className="p-4 border-b border-border sticky top-0 bg-background/80 backdrop-blur-sm z-10">
                        <div className="container mx-auto flex items-center justify-between">
                            <h1 className="text-2xl font-headline font-bold">Regulations Admin</h1>
                            <Skeleton className="h-10 w-40" />
                        </div>
                    </header>
                    <main className="container mx-auto py-8">
                        <h2 className="text-xl font-semibold mb-6">Existing Regulations</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {[...Array(8)].map((_, i) => (
                                <Card key={i}>
                                    <CardHeader>
                                        <Skeleton className="h-6 w-3/4" />
                                        <Skeleton className="h-4 w-1/2" />
                                    </CardHeader>
                                </Card>
                            ))}
                        </div>
                    </main>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground flex">
            <div className="flex-1 transition-all duration-300">
                <header className="p-4 border-b border-border sticky top-0 bg-background/80 backdrop-blur-sm z-10">
                    <div className="container mx-auto flex items-center justify-between">
                        <h1 className="text-2xl font-headline font-bold">Regulations Admin</h1>
                        <div className="flex items-center gap-4">
                            {selectedRegulation && (
                                <>
                                    <Button variant="outline" onClick={handleBackToList}>Back to List</Button>
                                    <Button onClick={handleSaveChanges} disabled={isSaving}>
                                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                        Save Changes
                                    </Button>
                                </>
                            )}
                            {!selectedRegulation && (
                                <div className="flex gap-2">
                                    <Button onClick={() => setIsNewRegDialogOpen(true)}>
                                        <Plus className="mr-2 h-4 w-4" /> New Regulation
                                    </Button>
                                    <Button variant="outline" onClick={() => setIsUploadDialogOpen(true)}>
                                        <Upload className="mr-2 h-4 w-4" /> Upload Document
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                </header>
                <main className="container mx-auto py-8">
                    {!selectedRegulation ? (
                        <>
                            <h2 className="text-xl font-semibold mb-6">Existing Regulations</h2>
                            {regulations.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                    {regulations.map(reg => {
                                        const docId = `${reg.location}-${reg.type}`;
                                        const isDeleting = deletingId === docId;
                                        return (
                                            <Card
                                                key={docId}
                                                className="cursor-pointer hover:bg-secondary/50 transition-colors hover:shadow-lg relative group"
                                                onClick={() => setSelectedRegulation(reg)}
                                            >
                                                <CardHeader>
                                                    <CardTitle>{reg.location}</CardTitle>
                                                    <CardDescription>{reg.type}</CardDescription>
                                                </CardHeader>
                                                <div className="absolute top-2 right-2">
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="text-destructive/50 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()} disabled={isDeleting}>
                                                                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    This action cannot be undone. This will permanently delete the regulation for {reg.location} - {reg.type}.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction onClick={(e) => { e.stopPropagation(); handleDeleteRegulation(reg.location, reg.type); }}>
                                                                    Delete
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </div>
                                            </Card>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="text-center py-16 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center">
                                    <p className="text-muted-foreground mb-4">No regulations found.</p>
                                    <Button onClick={() => setIsNewRegDialogOpen(true)}>
                                        <Plus className="mr-2 h-4 w-4" />
                                        Create Your First Regulation
                                    </Button>
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="mb-8">
                                <h2 className="text-2xl font-bold">{selectedRegulation.location} - {selectedRegulation.type}</h2>
                                <p className="text-muted-foreground">Select a category to edit its parameters.</p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                {categories.map(({ key, icon: Icon }) => (
                                    <Card
                                        key={key}
                                        className={cn("cursor-pointer hover:bg-secondary/50 transition-colors", selectedCategory === key && "ring-2 ring-primary")}
                                        onClick={() => setSelectedCategory(key)}
                                    >
                                        <div className="p-6 flex flex-col items-center justify-center text-center gap-4">
                                            <Icon className="h-10 w-10 text-primary" />
                                            <h3 className="text-lg font-semibold capitalize">{key.replace(/_/g, ' ')}</h3>
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        </>
                    )}
                </main>
            </div>
            {categoryDetails && selectedRegulation && (
                <AdminDetailsSidebar
                    title={categoryDetails.title}
                    data={categoryDetails.data as any}
                    path={categoryDetails.path}
                    onUpdate={handleUpdate}
                    onFullUpdate={handleFullUpdate}
                    onClose={() => setSelectedCategory(null)}
                />
            )}
            <NewRegulationDialog
                isOpen={isNewRegDialogOpen}
                onOpenChange={setIsNewRegDialogOpen}
                onCreate={handleCreateRegulation}
                isSaving={isSaving}
            />
            <UploadRegulationDialog
                isOpen={isUploadDialogOpen}
                onOpenChange={setIsUploadDialogOpen}
                onExtracted={handleExtractedRegulation}
            />
        </div>
    );
}
