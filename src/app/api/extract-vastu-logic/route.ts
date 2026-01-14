
import { NextRequest, NextResponse } from 'next/server';
import { extractTextFromFile } from '@/lib/pdf-service';
import { extractVastuLogic } from '@/ai/flows/extract-vastu-logic';

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        // 1. Extract raw text (supports PDF/OCR, DOCX)
        const documentText = await extractTextFromFile(file);

        if (!documentText || documentText.trim().length < 50) {
            return NextResponse.json(
                { error: 'Could not extract sufficient text. The document might be empty or unreadable.' },
                { status: 400 }
            );
        }

        // 2. AI Extraction Flow
        const extractedData = await extractVastuLogic({
            documentText,
            fileName: file.name,
        });

        return NextResponse.json({
            success: true,
            data: extractedData,
        });

    } catch (error: any) {
        console.error('Error processing Vastu document:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to process document' },
            { status: 500 }
        );
    }
}
