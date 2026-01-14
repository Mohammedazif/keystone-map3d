'use client';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { DEFAULT_UNIT_TEMPLATES } from '@/lib/default-data/unit-templates';
import type { UnitTemplate } from '@/lib/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { toast } from '@/hooks/use-toast';
import { Loader2, Plus, Trash2, Home, RefreshCw } from 'lucide-react';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from './ui/alert-dialog';

const INDIAN_LOCATIONS = [
    "All Locations (Generic)",
    "Delhi", "Mumbai", "Bangalore", "Pune", "Hyderabad", "Chennai",
    "Kolkata", "Ahmedabad", "Jaipur", "Lucknow", "Chandigarh"
];

export function UnitTemplatesPanel() {
    const [templates, setTemplates] = useState<UnitTemplate[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState<UnitTemplate | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

    // Form state
    const [formData, setFormData] = useState<Partial<UnitTemplate>>({
        name: '',
        bhk_type: '2BHK',
        location: undefined,
        carpet_area_sqm: 0,
        builtup_area_sqm: 0,
        balcony_area_sqm: 0,
        efficiency_ratio: 0.75,
        min_width_m: 0,
        min_depth_m: 0,
        description: ''
    });

    const templatesCollection = collection(db, 'unit_templates');

    const fetchTemplates = async () => {
        setIsLoading(true);
        try {
            const snapshot = await getDocs(templatesCollection);
            const data = snapshot.docs.map(doc => doc.data() as UnitTemplate);
            setTemplates(data.sort((a, b) => a.bhk_type.localeCompare(b.bhk_type)));
        } catch (error) {
            console.error("Error fetching unit templates:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch unit templates.' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleLoadDefaults = async () => {
        setIsLoading(true);
        try {
            const batch = writeBatch(db);
            const now = new Date().toISOString();

            DEFAULT_UNIT_TEMPLATES.forEach((template, index) => {
                const id = `ut_default_${index}`;
                const docRef = doc(templatesCollection, id);
                batch.set(docRef, {
                    ...template,
                    id,
                    created_at: now,
                    updated_at: now
                });
            });

            await batch.commit();
            toast({ title: 'Success', description: 'Default unit templates loaded.' });
            fetchTemplates();
        } catch (error) {
            console.error("Error loading defaults:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not load default templates.' });
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchTemplates();
    }, []);

    const handleSelectTemplate = (template: UnitTemplate) => {
        setSelectedTemplate(template);
        setFormData(template);
        setIsEditing(false);
    };

    const handleNewTemplate = () => {
        setSelectedTemplate(null);
        setFormData({
            name: '',
            bhk_type: '2BHK',
            location: undefined,
            carpet_area_sqm: 0,
            builtup_area_sqm: 0,
            balcony_area_sqm: 0,
            efficiency_ratio: 0.75,
            min_width_m: 0,
            min_depth_m: 0,
            description: ''
        });
        setIsEditing(true);
    };

    const handleSave = async () => {
        if (!formData.name || !formData.bhk_type) {
            toast({ variant: 'destructive', title: 'Validation Error', description: 'Name and BHK Type are required.' });
            return;
        }

        setIsSaving(true);
        try {
            const now = new Date().toISOString();
            const templateId = selectedTemplate?.id || `ut_${Date.now()}`;

            const templateData: UnitTemplate = {
                id: templateId,
                name: formData.name!,
                bhk_type: formData.bhk_type!,
                location: formData.location === "All Locations (Generic)" ? undefined : formData.location,
                carpet_area_sqm: formData.carpet_area_sqm || 0,
                builtup_area_sqm: formData.builtup_area_sqm || 0,
                balcony_area_sqm: formData.balcony_area_sqm || 0,
                efficiency_ratio: formData.efficiency_ratio || 0.75,
                min_width_m: formData.min_width_m || 0,
                min_depth_m: formData.min_depth_m || 0,
                description: formData.description,
                created_at: selectedTemplate?.created_at || now,
                updated_at: now
            };

            await setDoc(doc(templatesCollection, templateId), templateData);

            setTemplates(prev => {
                const filtered = prev.filter(t => t.id !== templateId);
                return [...filtered, templateData].sort((a, b) => a.bhk_type.localeCompare(b.bhk_type));
            });

            setSelectedTemplate(templateData);
            setIsEditing(false);
            toast({ title: 'Success', description: 'Unit template saved successfully.' });
        } catch (error) {
            console.error("Error saving template:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not save template.' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (templateId: string) => {
        try {
            await deleteDoc(doc(templatesCollection, templateId));
            setTemplates(prev => prev.filter(t => t.id !== templateId));
            if (selectedTemplate?.id === templateId) {
                setSelectedTemplate(null);
            }
            toast({ title: 'Deleted', description: 'Unit template deleted successfully.' });
        } catch (error) {
            console.error("Error deleting template:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not delete template.' });
        }
    };

    const groupedTemplates = templates.reduce((acc, template) => {
        const key = template.bhk_type;
        if (!acc[key]) acc[key] = [];
        acc[key].push(template);
        return acc;
    }, {} as Record<string, UnitTemplate[]>);

    return (
        <div className="grid grid-cols-[300px_1fr] gap-6 h-full">
            {/* Left Sidebar - Template List */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Unit Templates</h3>
                    <Button size="sm" onClick={handleNewTemplate}>
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
                            {Object.entries(groupedTemplates).map(([bhkType, temps]) => (
                                <div key={bhkType}>
                                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                        {bhkType}
                                    </div>
                                    <div className="space-y-1">
                                        {temps.map(template => (
                                            <Card
                                                key={template.id}
                                                className={`cursor-pointer transition-all hover:shadow-md ${selectedTemplate?.id === template.id ? 'border-primary bg-primary/5' : ''
                                                    }`}
                                                onClick={() => handleSelectTemplate(template)}
                                            >
                                                <CardHeader className="p-3">
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex-1">
                                                            <CardTitle className="text-sm">{template.name}</CardTitle>
                                                            <CardDescription className="text-xs mt-1">
                                                                {template.carpet_area_sqm} sqm carpet
                                                            </CardDescription>
                                                        </div>
                                                        <Home className="h-4 w-4 text-muted-foreground" />
                                                    </div>
                                                    {template.location && (
                                                        <Badge variant="outline" className="text-xs mt-2 w-fit">
                                                            {template.location}
                                                        </Badge>
                                                    )}
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

            {/* Right Panel - Template Editor */}
            <div>
                {selectedTemplate || isEditing ? (
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle>{isEditing ? (selectedTemplate ? 'Edit Template' : 'New Template') : formData.name}</CardTitle>
                                    <CardDescription>
                                        {isEditing ? 'Configure unit type details' : `${formData.bhk_type} • ${formData.carpet_area_sqm} sqm`}
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
                                                        <AlertDialogTitle>Delete Template?</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            This will permanently delete "{formData.name}". This action cannot be undone.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => selectedTemplate && handleDelete(selectedTemplate.id)}>
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
                                                if (selectedTemplate) setFormData(selectedTemplate);
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
                                    <Label htmlFor="name">Template Name *</Label>
                                    <Input
                                        id="name"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        disabled={!isEditing}
                                        placeholder="e.g., Standard 3BHK"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="bhk_type">BHK Type *</Label>
                                    <Select
                                        value={formData.bhk_type}
                                        onValueChange={(value: any) => setFormData({ ...formData, bhk_type: value })}
                                        disabled={!isEditing}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {['1BHK', '2BHK', '3BHK', '4BHK', '5BHK'].map(type => (
                                                <SelectItem key={type} value={type}>{type}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="location">Location (Optional)</Label>
                                <Select
                                    value={formData.location || "All Locations (Generic)"}
                                    onValueChange={(value) => setFormData({ ...formData, location: value === "All Locations (Generic)" ? undefined : value })}
                                    disabled={!isEditing}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {INDIAN_LOCATIONS.map(loc => (
                                            <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Leave as "All Locations" for generic templates, or select a city for location-specific sizes
                                </p>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="carpet_area">Carpet Area (sqm)</Label>
                                    <Input
                                        id="carpet_area"
                                        type="number"
                                        value={formData.carpet_area_sqm}
                                        onChange={(e) => setFormData({ ...formData, carpet_area_sqm: parseFloat(e.target.value) })}
                                        disabled={!isEditing}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="builtup_area">Built-up Area (sqm)</Label>
                                    <Input
                                        id="builtup_area"
                                        type="number"
                                        value={formData.builtup_area_sqm}
                                        onChange={(e) => setFormData({ ...formData, builtup_area_sqm: parseFloat(e.target.value) })}
                                        disabled={!isEditing}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="balcony_area">Balcony Area (sqm)</Label>
                                    <Input
                                        id="balcony_area"
                                        type="number"
                                        value={formData.balcony_area_sqm}
                                        onChange={(e) => setFormData({ ...formData, balcony_area_sqm: parseFloat(e.target.value) })}
                                        disabled={!isEditing}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="efficiency">Efficiency Ratio</Label>
                                    <Input
                                        id="efficiency"
                                        type="number"
                                        step="0.01"
                                        min="0.60"
                                        max="0.85"
                                        value={formData.efficiency_ratio}
                                        onChange={(e) => setFormData({ ...formData, efficiency_ratio: parseFloat(e.target.value) })}
                                        disabled={!isEditing}
                                    />
                                    <p className="text-xs text-muted-foreground">Carpet / Built-up (0.60 - 0.85)</p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="min_width">Min Width (m)</Label>
                                    <Input
                                        id="min_width"
                                        type="number"
                                        value={formData.min_width_m}
                                        onChange={(e) => setFormData({ ...formData, min_width_m: parseFloat(e.target.value) })}
                                        disabled={!isEditing}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="min_depth">Min Depth (m)</Label>
                                    <Input
                                        id="min_depth"
                                        type="number"
                                        value={formData.min_depth_m}
                                        onChange={(e) => setFormData({ ...formData, min_depth_m: parseFloat(e.target.value) })}
                                        disabled={!isEditing}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="description">Description</Label>
                                <Textarea
                                    id="description"
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    disabled={!isEditing}
                                    rows={3}
                                    placeholder="Optional description or notes about this template"
                                />
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                        <div className="text-center">
                            <Home className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p className="mb-4">Select a template or create a new one</p>
                            {templates.length === 0 && (
                                <Button variant="outline" onClick={handleLoadDefaults} disabled={isLoading}>
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Load Default Templates
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
