import { NextResponse, type NextRequest } from 'next/server';
import { assessSoilSuitability, type SoilSuitabilityInput } from '@/ai/flows/ai-soil-suitability-assessment';
import { z } from 'zod';

const chatRequestSchema = z.object({
  buildingDescription: z.string(),
  soilPh: z.number(),
  soilBd: z.number(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsedBody = chatRequestSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsedBody.error.flatten() }, { status: 400 });
    }

    const input: SoilSuitabilityInput = {
      soilPh: parsedBody.data.soilPh,
      soilBd: parsedBody.data.soilBd,
      buildingDescription: parsedBody.data.buildingDescription,
    };
    
    const result = await assessSoilSuitability(input);

    return NextResponse.json(result);

  } catch (error) {
    console.error('Chat API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'An error occurred while processing your request.', details: errorMessage }, { status: 500 });
  }
}
