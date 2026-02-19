'use client';

import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Upload, FileText, Loader2, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { Input } from './ui/input';

interface UploadNationalCodeDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onIndexed: (stats: IndexStats) => void;
}

interface IndexStats {
    documentName: string;
    textLength: number;
    chunksIndexed: number;
    baselineEntriesSaved: number;
}

type UploadPhase = 'idle' | 'uploading' | 'chunking' | 'extracting' | 'saving' | 'done' | 'error';

export function UploadNationalCodeDialog({ isOpen, onOpenChange, onIndexed }: UploadNationalCodeDialogProps) {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [documentName, setDocumentName] = useState('');
    const [skipBaseline, setSkipBaseline] = useState(false);
    const [phase, setPhase] = useState<UploadPhase>('idle');
    const [progress, setProgress] = useState(0);
    const [result, setResult] = useState<IndexStats | null>(null);
    const [error, setError] = useState<string | null>(null);

    const phaseMessages: Record<UploadPhase, string> = {
        idle: '',
        uploading: 'Uploading and extracting PDF text...',
        chunking: 'Chunking document for RAG indexing...',
        extracting: 'AI extracting structured baseline parameters...',
        saving: 'Saving to Firestore...',
        done: 'Indexing complete!',
        error: 'An error occurred.',
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            setResult(null);
            setError(null);
            setPhase('idle');
            // Auto-fill document name from filename
            if (!documentName) {
                setDocumentName(file.name.replace('.pdf', '').replace(/_/g, ' '));
            }
        }
    };

    const handleUpload = async () => {
        if (!selectedFile) return;

        setPhase('uploading');
        setProgress(10);
        setError(null);

        try {
            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('documentName', documentName || selectedFile.name);
            formData.append('skipBaseline', String(skipBaseline));

            setProgress(20);
            setPhase('chunking');

            const response = await fetch('/api/index-national-code', {
                method: 'POST',
                body: formData,
            });

            setProgress(70);
            setPhase(skipBaseline ? 'saving' : 'extracting');

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Indexing failed');
            }

            setProgress(100);
            setPhase('done');
            setResult(data.stats);
            onIndexed(data.stats);

            toast({
                title: 'Indexed Successfully',
                description: `${data.stats.chunksIndexed} chunks indexed. ${data.stats.baselineEntriesSaved} baseline entries saved.`,
            });
        } catch (err: any) {
            setPhase('error');
            setError(err.message);
            toast({ variant: 'destructive', title: 'Indexing Failed', description: err.message });
        }
    };

    const handleClose = () => {
        if (phase !== 'uploading' && phase !== 'chunking' && phase !== 'extracting' && phase !== 'saving') {
            setSelectedFile(null);
            setDocumentName('');
            setPhase('idle');
            setProgress(0);
            setResult(null);
            setError(null);
            onOpenChange(false);
        }
    };

    const isProcessing = ['uploading', 'chunking', 'extracting', 'saving'].includes(phase);

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Index National Building Code</DialogTitle>
                    <DialogDescription>
                        Upload a large PDF (NBC Vol 1, Vol 2, etc.) to index it for AI-powered fallback retrieval.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <Alert>
                        <Info className="h-4 w-4" />
                        <AlertDescription className="text-xs">
                            This uses a <strong>Hybrid Strategy</strong>: the document is chunked for RAG search AND key parameters are extracted into structured baseline regulations for the Parametric Toolbar.
                        </AlertDescription>
                    </Alert>

                    {phase === 'idle' || phase === 'error' ? (
                        <>
                            {/* File Selection */}
                            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                                <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                                <input
                                    type="file"
                                    accept=".pdf"
                                    onChange={handleFileSelect}
                                    className="hidden"
                                    id="nbc-file-input"
                                />
                                <label htmlFor="nbc-file-input" className="cursor-pointer">
                                    <Button variant="outline" asChild>
                                        <span>
                                            <FileText className="mr-2 h-4 w-4" />
                                            Select PDF
                                        </span>
                                    </Button>
                                </label>
                                {selectedFile && (
                                    <div className="mt-3 space-y-1">
                                        <p className="text-sm font-medium">{selectedFile.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {(selectedFile.size / 1024 / 1024).toFixed(1)} MB
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Document Name */}
                            {selectedFile && (
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Document Label</Label>
                                    <Input
                                        value={documentName}
                                        onChange={(e) => setDocumentName(e.target.value)}
                                        placeholder="e.g. NBC 2016 Vol 1"
                                        className="h-8 text-sm"
                                    />
                                    <p className="text-[10px] text-muted-foreground">
                                        This label will appear in the admin panel.
                                    </p>
                                </div>
                            )}

                            {/* Skip Baseline Toggle */}
                            {selectedFile && (
                                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border">
                                    <div>
                                        <p className="text-xs font-medium">Skip Structured Extraction</p>
                                        <p className="text-[10px] text-muted-foreground">
                                            Only index for RAG search, skip baseline parameter extraction.
                                        </p>
                                    </div>
                                    <Switch
                                        checked={skipBaseline}
                                        onCheckedChange={setSkipBaseline}
                                    />
                                </div>
                            )}

                            {error && (
                                <Alert variant="destructive">
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>{error}</AlertDescription>
                                </Alert>
                            )}

                            <Button
                                onClick={handleUpload}
                                disabled={!selectedFile}
                                className="w-full"
                            >
                                <Upload className="mr-2 h-4 w-4" />
                                Index Document
                            </Button>
                        </>
                    ) : phase === 'done' && result ? (
                        <div className="space-y-4">
                            <Alert>
                                <CheckCircle className="h-4 w-4 text-green-500" />
                                <AlertDescription>
                                    <strong>{result.documentName || documentName}</strong> indexed successfully.
                                </AlertDescription>
                            </Alert>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-muted/30 rounded-lg p-3 text-center">
                                    <p className="text-2xl font-bold text-primary">{result.chunksIndexed}</p>
                                    <p className="text-xs text-muted-foreground">RAG Chunks</p>
                                </div>
                                <div className="bg-muted/30 rounded-lg p-3 text-center">
                                    <p className="text-2xl font-bold text-primary">{result.baselineEntriesSaved}</p>
                                    <p className="text-xs text-muted-foreground">Baseline Entries</p>
                                </div>
                                <div className="col-span-2 bg-muted/30 rounded-lg p-3 text-center">
                                    <p className="text-lg font-bold">{(result.textLength / 1000).toFixed(0)}k</p>
                                    <p className="text-xs text-muted-foreground">Characters Indexed</p>
                                </div>
                            </div>

                            <Button onClick={handleClose} className="w-full">Done</Button>
                        </div>
                    ) : (
                        // Processing state
                        <div className="space-y-4 py-4">
                            <div className="flex items-center gap-3">
                                <Loader2 className="h-5 w-5 animate-spin text-primary flex-shrink-0" />
                                <p className="text-sm font-medium">{phaseMessages[phase]}</p>
                            </div>
                            <Progress value={progress} className="h-2" />
                            <p className="text-xs text-muted-foreground text-center">
                                Large documents may take 1-3 minutes. Please don't close this window.
                            </p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
