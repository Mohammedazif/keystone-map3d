import { NextRequest, NextResponse } from 'next/server';
import { extractRegulationData } from '@/ai/flows/ai-regulation-extractor';
import mammoth from 'mammoth';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

async function extractTextFromFile(file: File): Promise<string> {
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.pdf')) {
        const data = await pdf(buffer);
        return data.text;
    } else if (fileName.endsWith('.docx')) {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
    } else if (fileName.endsWith('.txt')) {
        return buffer.toString('utf-8');
    }

    throw new Error('Unsupported file type. Please upload PDF, DOCX, or TXT files.');
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

        if (!documentText || documentText.trim().length < 50) {
            return NextResponse.json(
                { error: 'Could not extract sufficient text from document' },
                { status: 400 }
            );
        }

        // Use AI to extract regulation data
        const extractedData = await extractRegulationData({
            documentText,
            fileName: file.name,
        });

        return NextResponse.json({
            success: true,
            data: extractedData,
        });
    } catch (error: any) {
        console.error('Error processing regulation document:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to process document' },
            { status: 500 }
        );
    }
}
