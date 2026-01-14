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

        // 2. If standard parsing yielded little text (e.g. Scanned PDF), try OCR
        // Threshold: 100 characters is arbitrary but filters out "Page 1" type headers.
        if (!text || text.trim().length < 100) {
            console.log('[PDF Service] Low text content detected, attempting OCR...');
            const ocrText = await performOCR(buffer);
            // Append OCR text (or use it if primary was empty)
            text = (text || '') + '\n\n' + ocrText;
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

// Helper: OCR Logic
// We import dependencies dynamically to prevent loading them if not needed (performance)
async function performOCR(buffer: Buffer): Promise<string> {
    try {
        console.log('[PDF Service] Starting OCR...');
        const pdf2img = await import('pdf-img-convert');
        const { createWorker } = await import('tesseract.js');

        // Convert PDF pages to images
        const images = await pdf2img.default.convert(buffer);
        console.log(`[PDF Service] Converted PDF to ${images.length} images for OCR`);

        const worker = await createWorker('eng');
        let fullText = '';

        for (let i = 0; i < images.length; i++) {
            // pdf-img-convert returns Uint8Array or Buffer. worker.recognize takes Buffer/string/etc.
            const ret = await worker.recognize(Buffer.from(images[i]));
            fullText += ret.data.text + '\n\n';
            console.log(`[PDF Service] OCR processed page ${i + 1}/${images.length}`);
        }

        await worker.terminate();
        return fullText;
    } catch (e) {
        console.error('[PDF Service] OCR Extraction Failed:', e);
        return '';
    }
}
