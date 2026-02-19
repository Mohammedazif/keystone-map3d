import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import path from 'path';
import { createRequire } from 'module';
import { generateWithFallback } from '@/ai/model-fallback';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

// Initialize Firebase Admin SDK
if (!getApps().length) {
    try {
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            if (serviceAccount.private_key) {
                serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
            }
            initializeApp({
                credential: cert(serviceAccount),
                projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'keystone-map3d',
            });
        } else {
            const keyPath = path.resolve(process.cwd(), 'firebase-admin-key.json');
            initializeApp({
                credential: cert(keyPath),
                projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'keystone-map3d',
            });
        }
    } catch (error) {
        console.error('Failed to initialize Firebase Admin:', error);
    }
}

const db = getFirestore();

const MIN_CHUNK_SIZE = 500;
const MAX_CHUNK_SIZE = 2000;

function createChunks(text: string, source: string): Array<{ text: string; source: string; isNational: boolean }> {
    const paragraphs = text.split(/\n\s*\n/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const para of paragraphs) {
        if ((currentChunk + para).length > MAX_CHUNK_SIZE && currentChunk.length > MIN_CHUNK_SIZE) {
            chunks.push(currentChunk.trim());
            currentChunk = para;
        } else {
            currentChunk += (currentChunk ? '\n\n' : '') + para;
        }
    }
    if (currentChunk.length > MIN_CHUNK_SIZE) {
        chunks.push(currentChunk.trim());
    }

    return chunks.map(chunk => ({
        text: chunk,
        source,
        isNational: true,
    }));
}

async function extractNationalBaseline(text: string, documentName: string): Promise<any[]> {
    // Use first 80k chars (covers most TOC + key sections)
    const sampleText = text.slice(0, 80000);

    const prompt = `You are an expert at extracting structured building regulation data from the National Building Code (NBC) of India.

Document: ${documentName}
Content (first portion):
${sampleText}

Task: Extract the NATIONAL BASELINE regulation parameters for each major land use type mentioned. These are the general/default values that apply nationally when no specific state regulation is available.

Look for:
- Residential (Group Housing, Plotted, etc.)
- Commercial (Offices, Retail, etc.)
- Mixed-Use
- Industrial

For each type found, extract:
- floor_area_ratio (FAR/FSI) - must be a decimal like 1.5, 2.0, 3.5
- max_ground_coverage - percentage (0-100)
- max_height - in meters
- front_setback, rear_setback, side_setback - in meters
- parking - spaces per unit or per 100sqm
- open_space - percentage

Return a JSON array. Use "National (NBC)" as the location. Use the specific zone/type name from the document.
Example:
[
  {
    "location": "National (NBC)",
    "type": "Residential - Group Housing",
    "geometry": {
      "floor_area_ratio": {"desc": "FAR per NBC", "unit": "", "value": 1.5, "min": 1.0, "max": 3.0},
      "max_ground_coverage": {"desc": "Max ground coverage", "unit": "%", "value": 40, "min": 20, "max": 60},
      "max_height": {"desc": "Max building height", "unit": "m", "value": 30, "min": 10, "max": 100},
      "front_setback": {"desc": "Front setback", "unit": "m", "value": 6, "min": 3, "max": 12},
      "rear_setback": {"desc": "Rear setback", "unit": "m", "value": 4, "min": 2, "max": 9},
      "side_setback": {"desc": "Side setback", "unit": "m", "value": 3, "min": 1.5, "max": 6}
    },
    "facilities": {
      "parking": {"desc": "Parking spaces per unit", "unit": "spaces/unit", "value": 1, "min": 0.5, "max": 2},
      "open_space": {"desc": "Open space requirement", "unit": "%", "value": 15, "min": 10, "max": 33}
    },
    "sustainability": {
      "rainwater_harvesting": {"desc": "RWH capacity", "unit": "liters/sqm", "value": 30, "min": 10, "max": 100},
      "solar_panels": {"desc": "Solar panel area", "unit": "% of roof", "value": 20, "min": 0, "max": 100}
    },
    "safety_and_services": {
      "fire_safety": {"desc": "Fire safety level", "unit": "", "value": 2, "min": 1, "max": 3}
    },
    "administration": {
      "fee_rate": {"desc": "Processing fee", "unit": "% of cost", "value": 0.1, "min": 0.05, "max": 1}
    },
    "confidence": 0.85
  }
]

If you cannot find specific values, use reasonable national defaults. Always return at least one entry for "Residential - Group Housing".
`;

    const responseText = await generateWithFallback(prompt);

    try {
        const firstBracket = responseText.indexOf('[');
        const lastBracket = responseText.lastIndexOf(']');
        if (firstBracket === -1 || lastBracket <= firstBracket) {
            throw new Error('No JSON array in response');
        }
        const jsonStr = responseText.substring(firstBracket, lastBracket + 1);
        let parsed = JSON.parse(jsonStr);
        if (!Array.isArray(parsed)) parsed = [parsed];

        // Sanitize FAR values
        return parsed.map((item: any) => {
            if (item.geometry?.floor_area_ratio) {
                let far = item.geometry.floor_area_ratio.value;
                if (far > 20) far = far > 100 ? far / 100 : 1.5;
                item.geometry.floor_area_ratio.value = far;
            }
            if (item.geometry?.max_ground_coverage) {
                let cov = item.geometry.max_ground_coverage.value;
                if (cov > 100) cov = 100;
                item.geometry.max_ground_coverage.value = cov;
            }
            return item;
        });
    } catch (e) {
        console.error('[NBC Indexer] Failed to parse baseline extraction:', e);
        // Return a safe default if parsing fails
        return [{
            location: 'National (NBC)',
            type: 'Residential - Group Housing',
            geometry: {
                floor_area_ratio: { desc: 'FAR per NBC', unit: '', value: 1.5, min: 1.0, max: 3.0 },
                max_ground_coverage: { desc: 'Max ground coverage', unit: '%', value: 40, min: 20, max: 60 },
                max_height: { desc: 'Max building height', unit: 'm', value: 30, min: 10, max: 100 },
                front_setback: { desc: 'Front setback', unit: 'm', value: 6, min: 3, max: 12 },
                rear_setback: { desc: 'Rear setback', unit: 'm', value: 4, min: 2, max: 9 },
                side_setback: { desc: 'Side setback', unit: 'm', value: 3, min: 1.5, max: 6 },
            },
            facilities: {
                parking: { desc: 'Parking spaces per unit', unit: 'spaces/unit', value: 1, min: 0.5, max: 2 },
                open_space: { desc: 'Open space requirement', unit: '%', value: 15, min: 10, max: 33 },
            },
            sustainability: {
                rainwater_harvesting: { desc: 'RWH capacity', unit: 'liters/sqm', value: 30, min: 10, max: 100 },
                solar_panels: { desc: 'Solar panel area', unit: '% of roof', value: 20, min: 0, max: 100 },
            },
            safety_and_services: {
                fire_safety: { desc: 'Fire safety level', unit: '', value: 2, min: 1, max: 3 },
            },
            administration: {
                fee_rate: { desc: 'Processing fee', unit: '% of cost', value: 0.1, min: 0.05, max: 1 },
            },
            confidence: 0.5,
        }];
    }
}

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const documentName = (formData.get('documentName') as string) || file?.name || 'NBC Document';
        const skipBaseline = formData.get('skipBaseline') === 'true';

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        const fileName = file.name.toLowerCase();
        if (!fileName.endsWith('.pdf')) {
            return NextResponse.json({ error: 'Only PDF files are supported for national code indexing.' }, { status: 400 });
        }

        console.log(`[NBC Indexer] Processing: ${documentName} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);

        // 1. Extract text from PDF
        const buffer = Buffer.from(await file.arrayBuffer());
        const pdfData = await pdf(buffer);
        const fullText: string = pdfData.text;

        if (!fullText || fullText.trim().length < 100) {
            return NextResponse.json({ error: 'Could not extract text from PDF.' }, { status: 400 });
        }

        console.log(`[NBC Indexer] Extracted ${fullText.length} characters of text.`);

        // 2. Create RAG chunks
        const source = file.name; // Use filename as source key (matches LOCATION_MAP)
        const chunks = createChunks(fullText, source);
        console.log(`[NBC Indexer] Created ${chunks.length} RAG chunks.`);

        // 3. Upload RAG chunks to Firestore (delete old ones for this source first)
        const vectorsRef = db.collection('regulations-vectors');

        // Delete existing chunks for this source
        const existingSnapshot = await vectorsRef.where('source', '==', source).get();
        if (!existingSnapshot.empty) {
            console.log(`[NBC Indexer] Deleting ${existingSnapshot.size} existing chunks for source: ${source}`);
            const deleteBatch = db.batch();
            existingSnapshot.docs.forEach(d => deleteBatch.delete(d.ref));
            await deleteBatch.commit();
        }

        // Upload new chunks in batches of 500
        let uploadedChunks = 0;
        const BATCH_SIZE = 500;
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const batchChunks = chunks.slice(i, i + BATCH_SIZE);
            for (const chunk of batchChunks) {
                batch.set(vectorsRef.doc(), chunk);
            }
            await batch.commit();
            uploadedChunks += batchChunks.length;
            console.log(`[NBC Indexer] Uploaded ${uploadedChunks}/${chunks.length} chunks...`);
        }

        // 4. Extract structured baseline (unless skipped)
        let baselineCount = 0;
        let baselineData: any[] = [];

        if (!skipBaseline) {
            console.log('[NBC Indexer] Extracting structured baseline parameters...');
            baselineData = await extractNationalBaseline(fullText, documentName);
            console.log(`[NBC Indexer] Extracted ${baselineData.length} baseline regulation entries.`);

            // Save baseline to 'regulations' collection
            const regRef = db.collection('regulations');
            const baselineBatch = db.batch();
            for (const reg of baselineData) {
                if (!reg.location || !reg.type) continue;
                const docId = `${reg.location}-${reg.type}`.replace(/\s+/g, '-').replace(/[()]/g, '');
                const docRef = regRef.doc(docId);
                baselineBatch.set(docRef, {
                    ...reg,
                    _source: documentName,
                    _isNationalBaseline: true,
                    _lastIndexed: Date.now(),
                }, { merge: true });
                baselineCount++;
            }
            await baselineBatch.commit();
            console.log(`[NBC Indexer] Saved ${baselineCount} baseline entries to regulations collection.`);
        }

        return NextResponse.json({
            success: true,
            documentName,
            stats: {
                textLength: fullText.length,
                chunksIndexed: uploadedChunks,
                baselineEntriesSaved: baselineCount,
            },
            baselineData: skipBaseline ? [] : baselineData,
        });

    } catch (error: any) {
        console.error('[NBC Indexer] Error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to index national code document' },
            { status: 500 }
        );
    }
}

// GET: List all indexed national documents
export async function GET() {
    try {
        const vectorsRef = db.collection('regulations-vectors');
        const snapshot = await vectorsRef.where('isNational', '==', true).select('source').get();

        const sourceCounts: Record<string, number> = {};
        snapshot.docs.forEach(d => {
            const src = d.data().source;
            sourceCounts[src] = (sourceCounts[src] || 0) + 1;
        });

        const documents = Object.entries(sourceCounts).map(([source, chunkCount]) => ({
            source,
            chunkCount,
        }));

        return NextResponse.json({ success: true, documents });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
