'use client';

import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Trash2, RefreshCw, BookOpen, Database, Plus, AlertCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { UploadNationalCodeDialog } from './upload-national-code-dialog';
import { Alert, AlertDescription } from './ui/alert';
import { Skeleton } from './ui/skeleton';

interface IndexedDocument {
    source: string;
    chunkCount: number;
}

interface BaselineEntry {
    id: string;
    type: string;
    geometry: any;
    _source: string;
}

interface IndexStats {
    documentName: string;
    textLength: number;
    chunksIndexed: number;
    baselineEntriesSaved: number;
}

export function NationalCodePanel() {
    const [documents, setDocuments] = useState<IndexedDocument[]>([]);
    const [baselines, setBaselines] = useState<BaselineEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchDocuments = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            // 1. Fetch RAG documents via API
            const docResponse = await fetch('/api/index-national-code');
            const docData = await docResponse.json();

            // 2. Fetch Baseline entries directly from Firestore
            const regsRef = collection(db, 'regulations');
            const q = query(regsRef, where('location', '==', 'National (NBC)'));
            const querySnapshot = await getDocs(q);
            const baselineData = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as BaselineEntry));

            if (docData.success) {
                setDocuments(docData.documents || []);
            }
            setBaselines(baselineData);
        } catch (err: any) {
            console.error('Fetch error:', err);
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDocuments();
    }, [fetchDocuments]);

    const handleIndexed = (stats: IndexStats) => {
        fetchDocuments();
        setIsUploadOpen(false);
    };

    const totalChunks = documents.reduce((sum, d) => sum + d.chunkCount, 0);

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold">National Building Code (NBC)</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Large documents indexed for AI-powered fallback retrieval
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={fetchDocuments} disabled={isLoading}>
                        <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Button size="sm" onClick={() => setIsUploadOpen(true)}>
                        <Plus className="h-3.5 w-3.5 mr-1.5" />
                        Index Document
                    </Button>
                </div>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-2 gap-3">
                <Card className="border-dashed">
                    <CardContent className="p-3 flex items-center gap-3">
                        <Database className="h-8 w-8 text-primary/60 flex-shrink-0" />
                        <div>
                            <p className="text-xl font-bold">{totalChunks.toLocaleString()}</p>
                            <p className="text-xs text-muted-foreground">Total RAG Chunks</p>
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-dashed">
                    <CardContent className="p-3 flex items-center gap-3">
                        <BookOpen className="h-8 w-8 text-primary/60 flex-shrink-0" />
                        <div>
                            <p className="text-xl font-bold">{documents.length}</p>
                            <p className="text-xs text-muted-foreground">Documents Indexed</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* How it works */}
            <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs space-y-1">
                    <p><strong>Hybrid Strategy:</strong></p>
                    <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                        <li>Documents are chunked for <strong>RAG search</strong> — used when AI needs specific rule details</li>
                        <li>Core parameters (FAR, setbacks, height) are extracted as <strong>Structured Baseline</strong> — used by the Parametric Toolbar sliders</li>
                        <li>NBC is used as <strong>fallback</strong> when no state-specific regulation is found</li>
                    </ul>
                </AlertDescription>
            </Alert>

            {/* Document List */}
            <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Indexed Documents</h4>

                {isLoading ? (
                    <div className="space-y-2">
                        {[1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                    </div>
                ) : error ? (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : documents.length === 0 ? (
                    <div className="text-center py-8 border-2 border-dashed border-border rounded-lg">
                        <BookOpen className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
                        <p className="text-sm text-muted-foreground">No national code documents indexed yet.</p>
                        <p className="text-xs text-muted-foreground mt-1">Upload NBC Vol 1 and Vol 2 to enable AI fallback.</p>
                        <Button
                            variant="outline"
                            size="sm"
                            className="mt-4"
                            onClick={() => setIsUploadOpen(true)}
                        >
                            <Plus className="h-3.5 w-3.5 mr-1.5" />
                            Index First Document
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {documents.map((doc) => (
                            <div
                                key={doc.source}
                                className="flex items-center justify-between p-3 bg-muted/20 rounded-lg border"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <BookOpen className="h-4 w-4 text-primary flex-shrink-0" />
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium truncate">{doc.source}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {doc.chunkCount.toLocaleString()} chunks indexed
                                        </p>
                                    </div>
                                </div>
                                <Badge variant="secondary" className="flex-shrink-0 ml-2">
                                    RAG Ready
                                </Badge>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Baseline Entries List */}
            <div className="space-y-2 pt-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Structured Baseline Parameters</h4>
                <p className="text-[10px] text-muted-foreground -mt-1">Numeric data used for Parametric Toolbar fallback</p>

                {isLoading ? (
                    <div className="space-y-2">
                        <Skeleton className="h-12 w-full" />
                    </div>
                ) : baselines.length === 0 ? (
                    <div className="text-center py-4 bg-muted/10 border border-dashed rounded-lg">
                        <p className="text-xs text-muted-foreground italic">No baseline parameters extracted yet.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {baselines.map((reg) => (
                            <div
                                key={reg.id}
                                className="p-2 bg-background border rounded-md shadow-sm"
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <p className="text-xs font-bold truncate">{reg.type}</p>
                                    <Badge variant="outline" className="text-[9px] h-4">NBC</Badge>
                                </div>
                                <div className="grid grid-cols-3 gap-1 text-[9px]">
                                    <div className="flex flex-col">
                                        <span className="text-muted-foreground uppercase">FAR</span>
                                        <span className="font-mono text-primary">{reg.geometry?.floor_area_ratio?.value || 'N/A'}</span>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-muted-foreground uppercase">Coverage</span>
                                        <span className="font-mono text-primary">{reg.geometry?.max_ground_coverage?.value || 'N/A'}%</span>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-muted-foreground uppercase">Setback</span>
                                        <span className="font-mono text-primary">{reg.geometry?.front_setback?.value || reg.geometry?.setback?.value || 'N/A'}m</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <UploadNationalCodeDialog
                isOpen={isUploadOpen}
                onOpenChange={setIsUploadOpen}
                onIndexed={handleIndexed}
            />
        </div>
    );
}
