'use client';

import { useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Upload, FileText, Loader2, CheckCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { GreenRegulationData } from '@/lib/types';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { produce } from 'immer';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';

interface UploadGreenRegulationDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onExtracted: (data: GreenRegulationData) => void;
}

export function UploadGreenRegulationDialog({ isOpen, onOpenChange, onExtracted }: UploadGreenRegulationDialogProps) {
    const [isUploading, setIsUploading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [extractedData, setExtractedData] = useState<GreenRegulationData | null>(null);

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

            const response = await fetch('/api/extract-green-logic', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to extract green regulation data');
            }

            setExtractedData(result.data);
            toast({
                title: 'Success',
                description: `Extracted data for ${result.data.name}`
            });
        } catch (error: any) {
            console.error('Upload error:', error);
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsUploading(false);
        }
    };

    const handleUpdateConstraint = (field: keyof GreenRegulationData['constraints'], value: string) => {
        if (!extractedData) return;
        const numValue = value === '' ? undefined : parseFloat(value);

        // Handle percentage input (user types 30 for 30%, we store 0.30)
        const finalValue = numValue !== undefined ? numValue / 100 : undefined;

        setExtractedData(produce(extractedData, draft => {
            if (finalValue !== undefined && !isNaN(finalValue)) {
                draft.constraints[field] = finalValue;
            } else {
                delete draft.constraints[field];
            }
        }));
    };

    const handleUpdateName = (name: string) => {
        if (!extractedData) return;
        setExtractedData({ ...extractedData, name });
    }

    const handleUseExtracted = () => {
        if (extractedData) {
            onExtracted(extractedData);
            onOpenChange(false);
            setSelectedFile(null);
            setExtractedData(null);
        }
    };

    const handleCancel = () => {
        setSelectedFile(null);
        setExtractedData(null);
        onOpenChange(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Upload Green Building Regulation</DialogTitle>
                    <DialogDescription>
                        Upload a PDF to extract constraints. You can edit the values before saving.
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
                                    id="green-regulation-file"
                                />
                                <label htmlFor="green-regulation-file" className="cursor-pointer">
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
                                    'Extract Green Constraints'
                                )}
                            </Button>
                        </div>
                    ) : (
                        <div className='space-y-6'>
                            <Alert>
                                <CheckCircle className="h-4 w-4" />
                                <AlertDescription>
                                    Review and edit the extracted data below.
                                </AlertDescription>
                            </Alert>

                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="name" className="text-right text-muted-foreground">
                                        Name
                                    </Label>
                                    <Input
                                        id="name"
                                        value={extractedData.name}
                                        onChange={(e) => handleUpdateName(e.target.value)}
                                        className="col-span-3 font-semibold"
                                    />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right text-muted-foreground">Certification</Label>
                                    <div className="col-span-3">
                                        <Badge variant="default">{extractedData.certificationType}</Badge>
                                        <span className="ml-2 text-xs text-muted-foreground">{(extractedData.confidence || 0) * 100}% confidence</span>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2 p-3 border rounded-md bg-secondary/20">
                                    <Label htmlFor="minOpenSpace" className='text-xs font-semibold uppercase text-muted-foreground'>Min Open Space (%)</Label>
                                    <Input
                                        id="minOpenSpace"
                                        type="number"
                                        placeholder="e.g. 30"
                                        value={extractedData.constraints.minOpenSpace !== undefined && extractedData.constraints.minOpenSpace !== null ? (extractedData.constraints.minOpenSpace * 100).toFixed(0) : ''}
                                        onChange={(e) => handleUpdateConstraint('minOpenSpace', e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2 p-3 border rounded-md bg-secondary/20">
                                    <Label htmlFor="maxGroundCoverage" className='text-xs font-semibold uppercase text-muted-foreground'>Max Coverage (%)</Label>
                                    <Input
                                        id="maxGroundCoverage"
                                        type="number"
                                        placeholder="e.g. 40"
                                        value={extractedData.constraints.maxGroundCoverage !== undefined && extractedData.constraints.maxGroundCoverage !== null ? (extractedData.constraints.maxGroundCoverage * 100).toFixed(0) : ''}
                                        onChange={(e) => handleUpdateConstraint('maxGroundCoverage', e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2 p-3 border rounded-md bg-secondary/20">
                                    <Label htmlFor="minGreenCover" className='text-xs font-semibold uppercase text-muted-foreground'>Min Green Cover (%)</Label>
                                    <Input
                                        id="minGreenCover"
                                        type="number"
                                        placeholder="e.g. 20"
                                        value={extractedData.constraints.minGreenCover !== undefined && extractedData.constraints.minGreenCover !== null ? (extractedData.constraints.minGreenCover * 100).toFixed(0) : ''}
                                        onChange={(e) => handleUpdateConstraint('minGreenCover', e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* Detailed Certification Criteria */}
                            {extractedData.categories && extractedData.categories.length > 0 && (
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold">Detailed Certification Criteria</Label>
                                    <div className="border rounded-md overflow-hidden">
                                        <Accordion type="single" collapsible className="w-full">
                                            {extractedData.categories.map((category, index) => (
                                                <AccordionItem key={index} value={`item-${index}`}>
                                                    <AccordionTrigger className="px-4 py-2 hover:bg-muted/50">
                                                        <div className="flex items-center justify-between w-full mr-4">
                                                            <span>{category.name}</span>
                                                            <Badge variant="outline">{category.credits.length} Credits</Badge>
                                                        </div>
                                                    </AccordionTrigger>
                                                    <AccordionContent className="px-4 py-2 bg-muted/20">
                                                        <div className="space-y-3 pt-2">
                                                            {category.credits.map((credit, idx) => (
                                                                <div key={idx} className="bg-card p-3 rounded border text-sm">
                                                                    <div className="flex justify-between items-start mb-2">
                                                                        <div>
                                                                            <span className="font-semibold block">{credit.code} {credit.name}</span>
                                                                            {credit.type === 'mandatory' && (
                                                                                <Badge variant="destructive" className="mt-1 text-[10px] h-5">MANDATORY</Badge>
                                                                            )}
                                                                        </div>
                                                                        <div className="text-muted-foreground font-mono text-xs">
                                                                            {credit.points ? `${credit.points} Pts` : '-'}
                                                                        </div>
                                                                    </div>
                                                                    {credit.requirements && credit.requirements.length > 0 && (
                                                                        <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
                                                                            {credit.requirements.map((req, rIdx) => (
                                                                                <li key={rIdx}>{req}</li>
                                                                            ))}
                                                                        </ul>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </AccordionContent>
                                                </AccordionItem>
                                            ))}
                                        </Accordion>
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-2 pt-4">
                                <Button variant="outline" onClick={handleCancel} className="flex-1">
                                    Cancel
                                </Button>
                                <Button onClick={handleUseExtracted} className="flex-1">
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
