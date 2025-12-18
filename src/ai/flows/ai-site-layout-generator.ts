
'use server';
/**
 * @fileOverview Generates a site layout plan based on a user prompt and a plot geometry.
 *
 * - generateSiteLayout: The main flow function.
 */

import { ai } from '@/ai/genkit';
import { GenerateSiteLayoutInputSchema, GenerateSiteLayoutOutputSchema, type GenerateSiteLayoutInput, type GenerateSiteLayoutOutput } from '@/lib/types';


export async function generateSiteLayout(input: GenerateSiteLayoutInput): Promise<GenerateSiteLayoutOutput> {
  return generateSiteLayoutFlow(input);
}

const prompt = ai.definePrompt({
  name: 'siteLayoutGeneratorPrompt',
  input: { schema: GenerateSiteLayoutInputSchema },
  prompt: `You are an expert urban planner and architect. Your task is to design two distinct, high-level site layout scenarios based on user requirements, pre-defined zones, and strict development regulations.

You will be given:
1. A GeoJSON Feature<Polygon> of the parent plot (for context of its shape and size).
2. A JSON array of user-defined zones ('userDefinedAreas'). Each zone has a geometry and an 'intendedUse' (like 'Residential', 'GreenArea', 'ParkingArea').
3. A text prompt from the user with their requirements.
4. A JSON object of the applicable development regulations for the plot's location.

Your goal is to flesh out the user-defined zones into concrete plans that are COMPLIANT with the regulations.

For each scenario, you must:
- Generate a unique name and a short description for the scenario's design philosophy.
- For a 'Residential' or 'Commercial' zone, decide how many buildings to place within it, their names, and number of floors.
- The 'placement' for each generated object must correspond to the name of the user-defined zone it belongs to.
- Ensure there is logical spacing between buildings. Do not cram them together. If a zone is small, place fewer buildings.

CRITICAL: You MUST strictly adhere to the provided 'regulations'. Pay close attention to constraints like 'max_ground_coverage', 'floor_area_ratio' (FAR), and any height or floor limits. Your generated 'numFloors' for buildings must not violate these rules.

You MUST generate exactly TWO different scenarios. For example, one scenario could prioritize maximizing building units while staying within regulations, while another prioritizes green space.

Rules:
- Your response MUST be a single JSON object containing a 'scenarios' array with exactly two elements. Do not include any explanatory text, markdown formatting like \`\`\`json, or anything outside of the JSON structure.
- Every scenario MUST have a 'name', a 'description', and a non-empty 'objects' array.
- Every object within a scenario MUST have 'type', 'name', and 'placement'.
- The 'type' MUST be one of: "Building", "GreenArea", "ParkingArea". Do NOT use generic types like "Area".
- If the object 'type' is 'Building', you MUST include 'intendedUse' and 'numFloors', and the 'numFloors' must be compliant.
- The 'massing' field controls the building's architectural form:
  * Use 'PodiumTower' for:
    - Mixed-use developments with commercial podiums and residential/office towers
    - High-density buildings with more than 10 floors
    - Any building where the user explicitly mentions "podium", "tower", or "mixed-use"
  * Use 'Simple' for low-rise buildings (< 10 floors) or when a simple box form is appropriate
- When using 'PodiumTower' massing, ensure 'numFloors' is at least 6 (3 for podium + 3+ for tower).
- Do NOT generate any GeoJSON geometry yourself.

Parent Plot Geometry (for context):
{{{plotGeometry}}}

User-Defined Zones:
{{{userDefinedAreas}}}

Applicable Regulations (MUST BE FOLLOWED):
{{{regulations}}}

User Prompt:
"{{prompt}}"

Generate the two compliant site layout scenarios now.`,
});

const generateSiteLayoutFlow = ai.defineFlow(
  {
    name: 'generateSiteLayoutFlow',
    inputSchema: GenerateSiteLayoutInputSchema,
    outputSchema: GenerateSiteLayoutOutputSchema,
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

    let output: GenerateSiteLayoutOutput;
    try {
      output = JSON.parse(cleanedJson);
    } catch (error) {
      console.error("Failed to parse AI response:", error);
      throw new Error("AI returned an invalid JSON format. Please try again.");
    }

    if (!output.scenarios || output.scenarios.length < 2) {
      throw new Error('AI failed to generate sufficient layout scenarios. Please try a different prompt.');
    }

    // Basic validation to ensure the AI followed instructions.
    for (const scenario of output.scenarios) {
      if (!scenario.name || !scenario.description || !scenario.objects || scenario.objects.length === 0) {
        throw new Error(`AI returned an incomplete scenario. It must have a name, description, and at least one object. Please try again.`);
      }
      for (const obj of scenario.objects) {
        if (!obj.name || !obj.type || !obj.placement) {
          throw new Error(`AI returned an incomplete object in a scenario. It must have at least a name, type, and placement. Please try again.`);
        }
      }
    }

    return output;
  }
);
