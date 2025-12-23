import { config } from 'dotenv';
config();
import { ai } from '../src/ai/genkit';

import { devLocalIndexerRef } from '@genkit-ai/dev-local-vectorstore';

import { Document } from 'genkit/retriever';
import fs from 'fs/promises';
import path from 'path';
import mammoth from 'mammoth';
import AdmZip from 'adm-zip';
import crypto from 'crypto';
import { createRequire } from 'module';

import { createWorker } from 'tesseract.js';
import pdfImgConvert from 'pdf-img-convert';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');





const DOCS_DIR = path.resolve(process.cwd(), 'Regulations Doc');
const INDEX_NAME = 'compliance-rag';

async function performOCR(filePath: string): Promise<string> {
    console.log(`[OCR] Parsing images from ${path.basename(filePath)}...`);
    try {
        const outputImages = await pdfImgConvert.convert(filePath);
        console.log(`[OCR] Converted to ${outputImages.length} images. Initializing Tesseract...`);

        // Limit to first 50 pages to avoid excessive processing
        const MAX_PAGES = 50;
        const pagesToProcess = Math.min(outputImages.length, MAX_PAGES);

        if (outputImages.length > MAX_PAGES) {
            console.log(`[OCR] Limiting to first ${MAX_PAGES} pages (document has ${outputImages.length} pages)`);
        }

        const worker = await createWorker('eng');
        let fullText = '';
        const MAX_TEXT_LENGTH = 500000; // 500KB limit per document

        for (let i = 0; i < pagesToProcess; i++) {
            // Check if we've exceeded max length
            if (fullText.length > MAX_TEXT_LENGTH) {
                console.log(`[OCR] Reached max text length at page ${i + 1}, stopping OCR`);
                break;
            }

            // pdf-img-convert returns Uint8Array (buffer), convert to Buffer for Tesseract in Node
            const imageBuffer = Buffer.from(outputImages[i]);
            const { data: { text } } = await worker.recognize(imageBuffer);
            fullText += text + '\n\n';
            console.log(`[OCR] Processed page ${i + 1}/${pagesToProcess}`);
        }

        await worker.terminate();

        // Final safety check - truncate if still too long
        if (fullText.length > MAX_TEXT_LENGTH) {
            console.log(`[OCR] Truncating text from ${fullText.length} to ${MAX_TEXT_LENGTH} characters`);
            fullText = fullText.substring(0, MAX_TEXT_LENGTH);
        }

        return fullText;
    } catch (e) {
        console.error('[OCR] Failed:', e);
        return '';
    }
}

async function extractText(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.pdf') {
        const dataBuffer = await fs.readFile(filePath);
        try {
            const data = await pdf(dataBuffer);
            // If text is too short, assume it's an image scan and try OCR
            if (data.text.trim().length < 50) {
                console.log(`[PDF] Text content too sparse (${data.text.trim().length} chars). Attempting OCR...`);
                return await performOCR(filePath);
            }
            return data.text;
        } catch (e) {
            console.warn('[PDF] Parsing failed, trying OCR...', e);
            return await performOCR(filePath);
        }
    } else if (ext === '.docx') {
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value;
    } else if (ext === '.txt' || ext === '.md') {
        return await fs.readFile(filePath, 'utf-8');
    }

    return '';
}

async function processFile(filePath: string): Promise<Document[]> {
    console.log(`Processing ${filePath}...`);
    const text = await extractText(filePath);
    if (!text.trim()) return [];

    const MAX_CHUNK_SIZE = 10000; // 10KB max per chunk
    const MIN_CHUNK_SIZE = 50;

    // Split by paragraphs first
    let chunks = text.split(/\n\s*\n/).filter(c => c.trim().length > MIN_CHUNK_SIZE);

    // Further split any chunks that are too large
    const finalChunks: string[] = [];
    for (const chunk of chunks) {
        if (chunk.length <= MAX_CHUNK_SIZE) {
            finalChunks.push(chunk);
        } else {
            // Split large chunks into smaller pieces
            const sentences = chunk.split(/[.!?]+\s+/);
            let currentChunk = '';

            for (const sentence of sentences) {
                if ((currentChunk + sentence).length > MAX_CHUNK_SIZE) {
                    if (currentChunk.length > MIN_CHUNK_SIZE) {
                        finalChunks.push(currentChunk.trim());
                    }
                    currentChunk = sentence;
                } else {
                    currentChunk += (currentChunk ? '. ' : '') + sentence;
                }
            }

            if (currentChunk.length > MIN_CHUNK_SIZE) {
                finalChunks.push(currentChunk.trim());
            }
        }
    }

    console.log(`Created ${finalChunks.length} chunks from ${path.basename(filePath)}`);

    return finalChunks.map(chunk => {
        return Document.fromText(chunk, {
            source: path.basename(filePath),
            filePath: filePath,
        });
    });
}

async function processDirectory(dir: string): Promise<Document[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let documents: Document[] = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            documents = documents.concat(await processDirectory(fullPath));
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();

            if (ext === '.zip') {
                // Handle ZIP extraction temporarily
                const zip = new AdmZip(fullPath);
                const zipEntries = zip.getEntries();

                // Create a temp dir for extraction
                const tempDir = path.join(dir, `temp_${path.basename(entry.name, '.zip')}`);
                if (!await fs.stat(tempDir).catch(() => false)) {
                    await fs.mkdir(tempDir);
                }

                zip.extractAllTo(tempDir, true);
                documents = documents.concat(await processDirectory(tempDir));

                // Cleanup temp dir (optional, skipping for safety/speed in this demo)
            } else if (['.pdf', '.docx', '.txt', '.md'].includes(ext)) {
                documents = documents.concat(await processFile(fullPath));
            }
        }
    }
    return documents;
}

async function main() {
    try {
        const args = process.argv.slice(2);
        const shouldClear = args.includes('--clear');

        if (shouldClear) {
            console.log(`Clearing existing index: ${INDEX_NAME}...`);
            const dbPath = path.resolve(process.cwd(), `__db_${INDEX_NAME}.json`);
            await fs.unlink(dbPath).catch(() => console.log('No existing index found to clear.'));
            console.log('Index cleared.');
        }

        console.log(`Starting ingestion from: ${DOCS_DIR}`);
        const docs = await processDirectory(DOCS_DIR);
        console.log(`Found ${docs.length} chunks to index.`);

        // Index in smaller batches to avoid JSON.stringify size limits
        const BATCH_SIZE = 10;
        let successfulBatches = 0;
        let failedBatches = 0;

        for (let i = 0; i < docs.length; i += BATCH_SIZE) {
            const batch = docs.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(docs.length / BATCH_SIZE);

            try {
                await ai.index({
                    indexer: devLocalIndexerRef(INDEX_NAME),
                    documents: batch,
                });
                successfulBatches++;
                console.log(`Indexed batch ${batchNum}/${totalBatches}`);
            } catch (batchError) {
                failedBatches++;
                console.error(`Failed to index batch ${batchNum}/${totalBatches}:`, batchError);
                // Continue with next batch instead of stopping
            }
        }

        console.log(`\nIngestion complete!`);
        console.log(`Successful batches: ${successfulBatches}`);
        console.log(`Failed batches: ${failedBatches}`);
    } catch (error) {
        console.error('Ingestion failed:', error);
    }
}

main();
