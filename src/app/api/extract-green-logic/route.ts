import { NextRequest, NextResponse } from 'next/server';
import { extractGreenLogic } from '@/ai/flows/extract-green-logic';
import mammoth from 'mammoth';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

import { createWorker } from 'tesseract.js';

async function performOCR(buffer: Buffer): Promise<string> {
    try {
        console.log('[GreenLogic] Starting OCR...');
        // Dynamic import for pdf-img-convert
        const pdf2img = await import('pdf-img-convert');

        // Convert PDF pages to images
        const images = await pdf2img.default.convert(buffer);
        console.log(`[GreenLogic] Converted PDF to ${images.length} images for OCR`);

        const worker = await createWorker('eng');
        let fullText = '';

        for (let i = 0; i < images.length; i++) {
            // pdf-img-convert returns Uint8Array or Buffer. worker.recognize takes Buffer/string/etc.
            const ret = await worker.recognize(Buffer.from(images[i]));
            fullText += ret.data.text + '\n\n';
            console.log(`[GreenLogic] OCR processed page ${i + 1}/${images.length}`);
        }

        await worker.terminate();
        return fullText;
    } catch (e) {
        console.error('[GreenLogic] OCR Extraction Failed:', e);
        return '';
    }
}

async function extractTextFromFile(file: File): Promise<string> {
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name.toLowerCase();

    let text = '';

    if (fileName.endsWith('.pdf')) {
        try {
            const data = await pdf(buffer);
            text = data.text;
        } catch (e) {
            console.warn('[GreenLogic] Standard PDF parse failed, trying OCR...', e);
        }

        // If standard parsing yielded little to no text, try OCR
        if (!text || text.trim().length < 100) {
            console.log('[GreenLogic] Low text content detected, attempting OCR...');
            const ocrText = await performOCR(buffer);
            // Append OCR text (or use it if primary was empty)
            text = (text || '') + '\n' + ocrText;
        }
    } else if (fileName.endsWith('.docx')) {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
    } else if (fileName.endsWith('.txt')) {
        text = buffer.toString('utf-8');
    } else {
        throw new Error('Unsupported file type. Please upload PDF, DOCX, or TXT files.');
    }

    return text;
}

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        // Extract text from document
        const documentText = await extractTextFromFile(file);

        console.log(`[GreenLogic] Extracted text length: ${documentText?.length}`);
        console.log(`[GreenLogic] Text preview: ${documentText?.substring(0, 200)}...`);

        if (!documentText || documentText.trim().length < 50) {
            console.warn('[GreenLogic] Insufficient text extracted. This might be a scanned PDF.');
            return NextResponse.json(
                { error: 'Could not extract sufficient text. The document might be a scanned image (OCR required).' },
                { status: 400 }
            );
        }

        // Use AI to extract regulation data
        const extractedData = await extractGreenLogic({
            documentText,
            fileName: file.name,
        });

        return NextResponse.json({
            success: true,
            data: extractedData,
        });
    } catch (error: any) {
        console.error('Error processing green regulation document:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to process document' },
            { status: 500 }
        );
    }
}
