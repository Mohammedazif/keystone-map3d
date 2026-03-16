
import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { generateStructuredWithFallback } from '@/ai/model-fallback';


// Server-side fallback: if AI doesn't extract scorecard items, ensure we return a sensible default set
export async function extractVastuLogicWithFallback(input: z.infer<typeof ExtractVastuInputSchema>) {
  const out = await extractVastuLogic(input as any);
  try {
    const parsed = out as any;
    if (!parsed.scorecardItems || parsed.scorecardItems.length === 0) {
      const defaults = [
        { id: 'A1', code: 'A1', section: 'Plot Shape', title: 'Plot shape regularity', complianceBasis: 'Rectangular plots preferred', maxMarks: 10 },
        { id: 'B1', code: 'B1', section: 'Entrance', title: 'Main entry gate placement', complianceBasis: 'Gate in auspicious side zone', maxMarks: 10 },
        { id: 'P1', code: 'P1', section: 'Brahmasthan', title: 'Brahmasthan open', complianceBasis: 'Center should be free', maxMarks: 15 },
        { id: 'F1', code: 'F1', section: 'Water', title: 'NE water placement', complianceBasis: 'Water in NE preferred', maxMarks: 10 },
        { id: 'G1', code: 'G1', section: 'Parking', title: 'Parking placement', complianceBasis: 'Parking in NW/S/W preferred', maxMarks: 10 },
        { id: 'H1', code: 'H1', section: 'Landscape', title: 'NE landscaping', complianceBasis: 'Green/open NE', maxMarks: 8 },
      ];
      parsed.scorecardItems = defaults;
      parsed.totalPossibleScore = (parsed.totalPossibleScore || 0) + defaults.reduce((s: number, it: any) => s + (it.maxMarks || 0), 0);
    }
    return parsed;
  } catch (e) {
    return out;
  }
}
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

const VastuScorecardItemSchema = z.object({
  id: z.string(),
  code: z.string(),
  section: z.string(),
  title: z.string(),
  complianceBasis: z.string(),
  maxMarks: z.number(),
});

const VastuVerdictBandSchema = z.object({
  label: z.string(),
  minScore: z.number(),
  maxScore: z.number().optional(),
});

const ExtractVastuOutputSchema = z.object({
  name: z.string().describe("A comprehensive name for this Vastu guidelines set (e.g. 'Residential Vastu 2024')"),
  recommendations: z.array(VastuRecommendationSchema),
  scorecardItems: z.array(VastuScorecardItemSchema).optional(),
  verdictBands: z.array(VastuVerdictBandSchema).optional(),
  totalPossibleScore: z.number().optional(),
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
      
      If the text contains a tabular Vastu scorecard, also extract:
      1. All scorecard rows with section, code, title, compliance basis, and max marks.
      2. The total possible score.
      3. Verdict scale bands with min/max score ranges.

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
        "scorecardItems": [
          {
            "id": "b1",
            "code": "B1",
            "section": "Main Entrance & Gate Placement",
            "title": "Main entry gate located in auspicious Vastu zones",
            "complianceBasis": "In prescribed zone = Full; Nearby zone = Partial; South-West = 0",
            "maxMarks": 5
          }
        ],
        "verdictBands": [
          {
            "label": "VASTU COMPLIANT — Approved",
            "minScore": 90,
            "maxScore": 138
          }
        ],
        "totalPossibleScore": 138,
        "complianceScore": number (optional)
      }
    `;

    return await generateStructuredWithFallback<z.infer<typeof ExtractVastuOutputSchema>>(prompt);
  }
);
