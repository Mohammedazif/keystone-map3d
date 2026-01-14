import mammoth from 'mammoth';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

// Dynamic import setup for Tesseract and PDF2Img usually happens inside the function 
// to avoid build issues if these native modules aren't perfectly aligned with Next.js edge/serverless,
// but for Node.js runtime lines they are fine. 
// However, tesseract.js and pdf-img-convert are heavy.

// We'll define the interface clearly.
export async function extractTextFromFile(file: File): Promise<string> {
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name.toLowerCase();

    let text = '';

    if (fileName.endsWith('.pdf')) {
        try {
            // 1. Try standard PDF parsing (text layer)
            const data = await pdf(buffer);
            text = data.text;
        } catch (e) {
            console.warn('[PDF Service] Standard PDF parse failed, trying OCR...', e);
        }

        // 2. If standard parsing yielded little text (e.g. Scanned PDF), warn the user
        if (!text || text.trim().length < 100) {
            console.warn('[PDF Service] Low text content detected. This might be a scanned PDF. OCR is currently disabled for Vercel compatibility.');
            text = (text || '') + '\n\n[SYSTEM WARNING: This document appears to be a scanned image or has no selectable text. OCR is currently disabled.]';
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
