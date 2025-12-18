
'use server';
/**
 * @fileOverview Generates 3D building massing options for a given plot.
 *
 * - generateMassingOptions: The main flow function.
 */

import { ai } from '@/ai/genkit';
import { GenerateMassingInputSchema, GenerateMassingOutputSchema, type GenerateMassingInput, type GenerateMassingOutput } from '@/lib/types';


export async function generateMassingOptions(input: GenerateMassingInput): Promise<GenerateMassingOutput> {
  return generateMassingOptionsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'massingGeneratorPrompt',
  input: { schema: GenerateMassingInputSchema },
  prompt: `You are an expert urban planning AI. Your task is to generate two distinct 3D building massing scenarios for a given plot.

  You MUST operate under the following strict constraints:

  1.  **Adhere to Regulations**: You will be given a 'plot' object and a 'regulations' object. All of your output MUST be compliant with these regulations. This is not a suggestion. Your generated GFA and coverage must be less than or equal to the limits.
  2.  **Respect Setbacks**: The plot object may contain a 'setback' value in meters. You must only generate building data for the area *inside* this setback. The system will handle the geometry.
  3.  **Obey FAR and Coverage**: The 'floor_area_ratio' (FAR) and 'max_ground_coverage' in the regulations are absolute limits. The total Gross Floor Area (GFA) of your generated buildings (sum of each building's area * its numFloors) MUST NOT exceed the FAR multiplied by the total plot area. The ground footprint of buildings MUST NOT exceed the coverage percentage.
  4.  **Do NOT Generate Geometry**: Your only job is to define the properties of the buildings (name, number of floors, intended use). The system will handle creating the actual building footprints based on your plan by splitting the available setback area. Do not output any GeoJSON or coordinate data.
  5.  **Placement**: The 'placement' for each building you generate MUST be the name of the plot it is inside.
  6.  **Two Scenarios**: You must generate exactly two different scenarios.
  7.  **Populate Objects**: The 'objects' array for each scenario must not be empty. It must contain the building definitions.
  8.  **Include Building Type**: Every object you generate in the 'objects' array MUST include the field "type": "Building". This is mandatory.
  9.  **Valid Intended Use**: The 'intendedUse' field for each building MUST be one of the following exact values: "Residential", "Commercial", "Mixed-Use", "Industrial", "Public". Do not use any other values like "Office" or "Retail".
  10. **Required Fields**: For each scenario, you must include a 'name', a 'description', and an 'objects' array. For each object, you must include 'name', 'type', 'placement', 'intendedUse', and 'numFloors'.
  11. **JSON Only Response**: Your entire response must be a single, valid JSON object and NOTHING else. The object must have one top-level key: "scenarios", which is an array of the two scenarios you generated. Do not include any explanatory text, markdown formatting like \`\`\`json, or anything outside of the JSON structure.

  Plot (Target Zone):
  {{{plot}}}

  Applicable Regulations (MUST BE FOLLOWED):
  {{{regulations}}}

  Generate the two compliant massing scenarios now.`,
});


const generateMassingOptionsFlow = ai.defineFlow(
  {
    name: 'generateMassingOptionsFlow',
    inputSchema: GenerateMassingInputSchema,
    outputSchema: GenerateMassingOutputSchema,
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

    let output: GenerateMassingOutput;
    try {
        output = JSON.parse(cleanedJson);
    } catch (error) {
        console.error("Failed to parse AI response:", error);
        throw new Error("AI returned an invalid JSON format. Please try again.");
    }
    
    if (!output.scenarios || output.scenarios.length < 2) {
      throw new Error('AI failed to generate sufficient massing scenarios. Please try a different prompt.');
    }
    
    // Basic validation to ensure the AI followed instructions.
    for (const scenario of output.scenarios) {
        if (!scenario.name) {
            throw new Error(`AI returned an incomplete scenario: missing "name".`);
        }
        if (!scenario.description) {
            throw new Error(`AI returned an incomplete scenario for "${scenario.name}": missing "description".`);
        }
        if (!scenario.objects) {
            throw new Error(`AI returned an incomplete scenario for "${scenario.name}": missing "objects" array.`);
        }
        if (scenario.objects.length === 0) {
            throw new Error(`AI returned an empty "objects" array for scenario "${scenario.name}".`);
        }
        for (const obj of scenario.objects) {
            if (!obj.name || !obj.type || !obj.placement || obj.numFloors === undefined || !obj.intendedUse) {
                throw new Error(`AI returned an incomplete building in a scenario. It must have name, type, placement, intendedUse, and numFloors.`);
            }
        }
    }

    return output;
  }
);
