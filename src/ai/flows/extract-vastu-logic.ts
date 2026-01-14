
import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { generateStructuredWithFallback } from '@/ai/model-fallback';

const ExtractVastuInputSchema = z.object({
  documentText: z.string(),
  fileName: z.string().optional(),
});

const VastuRecommendationSchema = z.object({
  category: z.enum(['Entrance', 'Kitchen', 'MasterBedroom', 'Water', 'Living', 'General']),
  idealDirections: z.array(z.string()).describe("List of ideal cardinal directions (e.g. ['NE', 'E'])"),
  avoidDirections: z.array(z.string()).describe("List of directions to avoid (e.g. ['SW'])"),
  description: z.string().describe("Brief explanation of the rule"),
  weight: z.number().min(1).max(10).describe("Importance of this rule (1=Low, 10=Critical)"),
});

const ExtractVastuOutputSchema = z.object({
  name: z.string().describe("A comprehensive name for this Vastu guidelines set (e.g. 'Residential Vastu 2024')"),
  recommendations: z.array(VastuRecommendationSchema),
  complianceScore: z.number().nullable().optional().describe("Baseline or max possible score if mentioned"),
});

export const extractVastuLogic = ai.defineFlow(
  {
    name: 'extractVastuLogic',
    inputSchema: ExtractVastuInputSchema,
    outputSchema: ExtractVastuOutputSchema,
  },
  async (input) => {
    const prompt = `
      You are an expert Vastu Shastra consultant.
      Analyze the provided building/design guidelines text and extract Vastu principles.
      
      Document: ${input.fileName}
      Content:
      ${input.documentText.substring(0, 30000)} 
      
      Extract structured recommendations for key building zones:
      - Main Entrance (Dwar)
      - Kitchen (Agni)
      - Master Bedroom (Nairutya)
      - Water Bodies/Tanks (Eshanya)
      
      For each recommendation, specify:
      1. Best cardinal directions (Use standard codes: N, S, E, W, NE, NW, SE, SW).
      2. Directions to avoid.
      3. Importance weight (1-10).
      
      If the text contains general architectural guidelines mixed with Vastu, ONLY extract the Vastu-specific parts (orientation, placement, elements).

      Output valid JSON matching this structure:
      {
        "name": "string",
        "recommendations": [
          {
            "category": "Entrance" | "Kitchen" | "MasterBedroom" | "Water" | "Living" | "General",
            "idealDirections": ["NE", ...],
            "avoidDirections": ["SW", ...],
            "description": "string",
            "weight": number
          }
        ],
        "complianceScore": number (optional)
      }
    `;

    return await generateStructuredWithFallback<z.infer<typeof ExtractVastuOutputSchema>>(prompt);
  }
);
