import { NextResponse, type NextRequest } from 'next/server';
import { ragChat } from '@/ai/flows/rag-chat';
import { z } from 'zod';

const chatRequestSchema = z.object({
  query: z.string(),
  isGeneralMode: z.boolean().optional(),
  buildingContext: z.any().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsedBody = chatRequestSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsedBody.error.flatten() }, { status: 400 });
    }

    const { query, buildingContext, isGeneralMode } = parsedBody.data;

    // Convert buildingContext to string if it's an object
    const contextString = typeof buildingContext === 'object'
      ? JSON.stringify(buildingContext, null, 2)
      : buildingContext;

    const answer = await ragChat({
      query,
      buildingContext: contextString,
      isGeneralMode: isGeneralMode
    });

    return NextResponse.json({ text: answer });

  } catch (error) {
    console.error('Chat API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'An error occurred while processing your request.', details: errorMessage }, { status: 500 });
  }
}
