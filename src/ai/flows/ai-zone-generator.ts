
'use server';
/**
 * @fileOverview Generates 2D layout zones within a plot based on a user prompt.
 *
 * - generateLayoutZones: The main flow function.
 */

import { ai } from '@/ai/genkit';
import { GenerateZonesInputSchema, GenerateZonesOutputSchema, type GenerateZonesInput, type GenerateZonesOutput } from '@/lib/types';


export async function generateLayoutZones(input: GenerateZonesInput): Promise<GenerateZonesOutput> {
  return generateLayoutZonesFlow(input);
}

const prompt = ai.definePrompt({
  name: 'zoneGeneratorPrompt',
  input: { schema: GenerateZonesInputSchema },
  prompt: `You are an expert urban planner. Your task is to subdivide a plot of land into distinct functional zones based on a user's prompt.

You will be given:
1. The GeoJSON geometry of the parent plot.
2. A text prompt from the user with their requirements.
3. Applicable development regulations.

Your goal is to define a logical set of zones that reflect the user's request. You should pay attention to keywords and quantities. For example, "a park" means one 'GreenArea' zone, and "two residential blocks" means two 'BuildableArea' zones with 'Residential' use. You should not generate the geometry for these zones; the system will do that by splitting the plot. You only need to define the zones themselves.

CRITICAL RULES:
- Your response MUST be a single, valid JSON object with one top-level key: "zones".
- The "zones" key must be an array of zone objects.
- Each zone object MUST have a 'name' and a 'type'.
- The 'type' MUST be one of: "BuildableArea", "GreenArea", "ParkingArea". Use 'GreenArea' for parks, gardens, etc. Use 'ParkingArea' for parking lots. Use 'BuildableArea' for any kind of building.
- If a zone 'type' is "BuildableArea", you SHOULD also include the 'intendedUse' field, which must be one of: "Residential", "Commercial", "Mixed-Use", "Industrial", "Public".
- Do NOT include any explanatory text, markdown formatting like \`\`\`json, or anything outside of the main JSON object.

Parent Plot Geometry (for context):
{{{plotGeometry}}}

Applicable Regulations (for context):
{{{regulations}}}

User Prompt:
"{{prompt}}"

Generate the zones now.`,
});

const generateLayoutZonesFlow = ai.defineFlow(
  {
    name: 'generateLayoutZonesFlow',
    inputSchema: GenerateZonesInputSchema,
    outputSchema: GenerateZonesOutputSchema,
  },
  async (input) => {
    const llmResponse = await prompt(input);
    const rawOutput = llmResponse.text;

    let cleanedJson = rawOutput.trim();
    if (cleanedJson.startsWith('```json')) {
        cleanedJson = cleanedJson.substring(7);
    }
    if (cleanedJson.endsWith('```')) {
        cleanedJson = cleanedJson.substring(0, cleanedJson.length - 3);
    }

    let output: GenerateZonesOutput;
    try {
        output = JSON.parse(cleanedJson);
    } catch (error) {
        console.error("Failed to parse AI response for zones:", error);
        throw new Error("AI returned an invalid JSON format for zones. Please try again.");
    }
    
    if (!output.zones || output.zones.length === 0) {
      throw new Error('AI failed to generate any layout zones. Please try a different prompt.');
    }
    
    for (const zone of output.zones) {
        if (!zone.name || !zone.type) {
             throw new Error(`AI returned an incomplete zone. It must have a name and type.`);
        }
    }

    return output;
  }
);
