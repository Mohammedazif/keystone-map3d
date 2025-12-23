'use client';

import { useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Upload, FileText, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { RegulationData } from '@/lib/types';
import { Alert, AlertDescription } from './ui/alert';

interface UploadRegulationDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onExtracted: (data: Partial<RegulationData>) => void;
}

export function UploadRegulationDialog({ isOpen, onOpenChange, onExtracted }: UploadRegulationDialogProps) {
    const [isUploading, setIsUploading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [extractedData, setExtractedData] = useState<any>(null);
    const [confidence, setConfidence] = useState<number>(0);

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

            const response = await fetch('/api/extract-regulation', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to extract regulation data');
            }

            setExtractedData(result.data);
            setConfidence(result.data.confidence || 0);
            toast({ title: 'Success', description: 'Regulation data extracted successfully!' });
        } catch (error: any) {
            console.error('Upload error:', error);
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsUploading(false);
        }
    };

    const handleUseExtracted = () => {
        if (extractedData) {
            console.log('Sending extracted data to admin panel:', extractedData);
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
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Upload Regulation Document</DialogTitle>
                    <DialogDescription>
                        Upload a PDF, DOCX, or TXT file containing regulation data. AI will automatically extract structured information.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {!extractedData ? (
                        <>
                            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                                <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                                <input
                                    type="file"
                                    accept=".pdf,.docx,.txt"
                                    onChange={handleFileSelect}
                                    className="hidden"
                                    id="regulation-file"
                                />
                                <label htmlFor="regulation-file" className="cursor-pointer">
                                    <Button variant="outline" asChild>
                                        <span>
                                            <FileText className="mr-2 h-4 w-4" />
                                            Select File
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
                                    'Extract Regulation Data'
                                )}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Alert variant={confidence > 0.7 ? 'default' : 'destructive'}>
                                {confidence > 0.7 ? (
                                    <CheckCircle className="h-4 w-4" />
                                ) : (
                                    <AlertCircle className="h-4 w-4" />
                                )}
                                <AlertDescription>
                                    Extraction confidence: {(confidence * 100).toFixed(0)}%
                                    {confidence <= 0.7 && ' - Please review carefully'}
                                </AlertDescription>
                            </Alert>

                            <div className="bg-secondary p-4 rounded-lg space-y-2 max-h-96 overflow-y-auto">
                                <h4 className="font-semibold">Extracted Data:</h4>
                                <p><strong>Location:</strong> {extractedData.location}</p>
                                <p><strong>Type:</strong> {extractedData.type}</p>
                                <details className="mt-4">
                                    <summary className="cursor-pointer text-sm font-medium">View Full JSON</summary>
                                    <pre className="mt-2 text-xs bg-background p-2 rounded overflow-x-auto">
                                        {JSON.stringify(extractedData, null, 2)}
                                    </pre>
                                </details>
                                <p className="text-sm text-muted-foreground mt-2">
                                    Full regulation details will be available for editing after import.
                                </p>
                            </div>

                            <div className="flex gap-2">
                                <Button variant="outline" onClick={handleCancel} className="flex-1">
                                    Cancel
                                </Button>
                                <Button onClick={handleUseExtracted} className="flex-1">
                                    Use This Data
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
