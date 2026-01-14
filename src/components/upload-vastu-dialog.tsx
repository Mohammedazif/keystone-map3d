'use client';

import { useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Upload, FileText, Loader2, CheckCircle, Plus, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { VastuRegulationData, VastuRecommendation } from '@/lib/types';
import { Alert, AlertDescription } from './ui/alert';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { produce } from 'immer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface UploadVastuDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onExtracted: (data: VastuRegulationData) => void;
}

export function UploadVastuDialog({ isOpen, onOpenChange, onExtracted }: UploadVastuDialogProps) {
    const [isUploading, setIsUploading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [extractedData, setExtractedData] = useState<VastuRegulationData | null>(null);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            setExtractedData(null);
        }
    };

    const handleUpload = async () => {
        if (!selectedFile) return;

        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', selectedFile);

            const response = await fetch('/api/extract-vastu-logic', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to extract Vastu data');
            }

            setExtractedData(result.data);
            toast({
                title: 'Success',
                description: `Extracted ${result.data.recommendations?.length || 0} guidelines.`
            });
        } catch (error: any) {
            console.error('Upload error:', error);
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsUploading(false);
        }
    };

    const handleSave = () => {
        if (extractedData) {
            onExtracted(extractedData);
            onOpenChange(false);
            setSelectedFile(null);
            setExtractedData(null);
        }
    };

    const updateRecommendation = (index: number, field: keyof VastuRecommendation, value: any) => {
        if (!extractedData) return;
        setExtractedData(produce(extractedData, draft => {
            (draft.recommendations[index] as any)[field] = value;
        }));
    };

    const deleteRecommendation = (index: number) => {
        if (!extractedData) return;
        setExtractedData(produce(extractedData, draft => {
            draft.recommendations.splice(index, 1);
        }));
    };

    const addRecommendation = () => {
        if (!extractedData) return;
        setExtractedData(produce(extractedData, draft => {
            draft.recommendations.push({
                category: 'General',
                idealDirections: [],
                avoidDirections: [],
                description: 'New Guideline',
                weight: 5
            });
        }));
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Upload Vastu Guidelines</DialogTitle>
                    <DialogDescription>
                        Upload a PDF or document. AI will extract directional guidelines for key zones.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                    {!extractedData ? (
                        <div className="space-y-4">
                            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                                <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                                <input
                                    type="file"
                                    accept=".pdf,.docx,.txt"
                                    onChange={handleFileSelect}
                                    className="hidden"
                                    id="vastu-file"
                                />
                                <label htmlFor="vastu-file" className="cursor-pointer">
                                    <Button variant="outline" asChild>
                                        <span>
                                            <FileText className="mr-2 h-4 w-4" />
                                            {selectedFile ? 'Change File' : 'Select File'}
                                        </span>
                                    </Button>
                                </label>
                                {selectedFile && (
                                    <p className="mt-4 text-sm text-muted-foreground">
                                        Selected: {selectedFile.name}
                                    </p>
                                )}
                            </div>

                            <Button
                                onClick={handleUpload}
                                disabled={!selectedFile || isUploading}
                                className="w-full"
                            >
                                {isUploading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Extracting...
                                    </>
                                ) : (
                                    'Extract Vastu Logic'
                                )}
                            </Button>
                        </div>
                    ) : (
                        <div className='space-y-6'>
                            <Alert>
                                <CheckCircle className="h-4 w-4" />
                                <AlertDescription>
                                    Review the extracted Vastu principles before saving.
                                </AlertDescription>
                            </Alert>

                            <div className="flex gap-4 items-center">
                                <Label className="w-20">Name:</Label>
                                <Input
                                    value={extractedData.name}
                                    onChange={(e) => setExtractedData({ ...extractedData, name: e.target.value })}
                                />
                            </div>

                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-lg font-semibold">Recommendations</h3>
                                    <Button size="sm" variant="secondary" onClick={addRecommendation}>
                                        <Plus className="h-4 w-4 mr-2" /> Add Rule
                                    </Button>
                                </div>

                                {extractedData.recommendations.map((rec, idx) => (
                                    <div key={idx} className="bg-muted/30 p-4 rounded-lg border space-y-3">
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-2">
                                                <Badge variant="outline">{idx + 1}</Badge>
                                                <Select
                                                    value={rec.category}
                                                    onValueChange={(val) => updateRecommendation(idx, 'category', val)}
                                                >
                                                    <SelectTrigger className="w-[180px] h-8">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {['Entrance', 'Kitchen', 'MasterBedroom', 'Water', 'Living', 'General'].map(c => (
                                                            <SelectItem key={c} value={c}>{c}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => deleteRecommendation(idx)}>
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <Label className="text-xs text-muted-foreground">Ideal Directions</Label>
                                                <Input
                                                    value={rec.idealDirections.join(', ')}
                                                    onChange={(e) => updateRecommendation(idx, 'idealDirections', e.target.value.split(',').map(s => s.trim()))}
                                                    placeholder="e.g. NE, E"
                                                />
                                            </div>
                                            <div>
                                                <Label className="text-xs text-muted-foreground">Avoid Directions</Label>
                                                <Input
                                                    value={rec.avoidDirections.join(', ')}
                                                    onChange={(e) => updateRecommendation(idx, 'avoidDirections', e.target.value.split(',').map(s => s.trim()))}
                                                    placeholder="e.g. SW"
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <Label className="text-xs text-muted-foreground">Description</Label>
                                            <Input
                                                value={rec.description}
                                                onChange={(e) => updateRecommendation(idx, 'description', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex gap-2 pt-4">
                                <Button variant="outline" onClick={() => setExtractedData(null)} className="flex-1">
                                    Cancel
                                </Button>
                                <Button onClick={handleSave} className="flex-1">
                                    Save
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
