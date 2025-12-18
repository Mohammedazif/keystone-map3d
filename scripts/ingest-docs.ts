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

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');





const DOCS_DIR = path.resolve(process.cwd(), 'Rules Documentations');
const INDEX_NAME = 'compliance-rag';

async function extractText(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.pdf') {
        const dataBuffer = await fs.readFile(filePath);
        const data = await pdf(dataBuffer);
        return data.text;
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

    // Simple chunking by paragraphs or fixed size
    const chunks = text.split(/\n\s*\n/).filter(c => c.trim().length > 50);

    return chunks.map(chunk => {
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
    console.log('Starting ingestion...');

    try {
        const docs = await processDirectory(DOCS_DIR);
        console.log(`Found ${docs.length} chunks to index.`);

        // Index in batches
        const BATCH_SIZE = 50;
        for (let i = 0; i < docs.length; i += BATCH_SIZE) {
            const batch = docs.slice(i, i + BATCH_SIZE);
            await ai.index({
                indexer: devLocalIndexerRef(INDEX_NAME),
                documents: batch,
            });
            console.log(`Indexed batch ${i / BATCH_SIZE + 1}/${Math.ceil(docs.length / BATCH_SIZE)}`);
        }

        console.log('Ingestion complete!');
    } catch (error) {
        console.error('Ingestion failed:', error);
    }
}

main();
