
'use server';
/**
 * @fileOverview Estimates building construction costs based on building data and user queries.
 *
 * - estimateBuildingCost - A function that estimates building construction costs.
 * - EstimateBuildingCostInput - The input type for the estimateBuildingCost function.
 * - EstimateBuildingCostOutput - The return type for the estimateBuildingCost function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const EstimateBuildingCostInputSchema = z.object({
  buildingData: z.string().describe('JSON string containing building data, including geometry, height, and soil data.'),
  query: z.string().describe('The user query about construction costs or related information.'),
});
export type EstimateBuildingCostInput = z.infer<typeof EstimateBuildingCostInputSchema>;

const EstimateBuildingCostOutputSchema = z.object({
  answer: z.string().describe('The LLM answer to the user query, incorporating building data and potentially calling external tools.'),
});
export type EstimateBuildingCostOutput = z.infer<typeof EstimateBuildingCostOutputSchema>;

export async function estimateBuildingCost(input: EstimateBuildingCostInput): Promise<EstimateBuildingCostOutput> {
  return estimateBuildingCostFlow(input);
}

const prompt = ai.definePrompt(
  {
    name: 'buildingCostEstimatorPrompt',
    input: { schema: EstimateBuildingCostInputSchema },
    output: { schema: EstimateBuildingCostOutputSchema },
    prompt: `You are a helpful AI assistant specializing in construction cost estimation. 
You will receive building data as a JSON string and a user query. Use the building data to answer the query as accurately as possible.

Building Data:
{{{buildingData}}}

Query:
{{{query}}}
`,
  },
);

const estimateBuildingCostFlow = ai.defineFlow(
  {
    name: 'estimateBuildingCostFlow',
    inputSchema: EstimateBuildingCostInputSchema,
    outputSchema: EstimateBuildingCostOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    if (!output) {
      throw new Error("AI failed to provide an answer.");
    }
    return output;
  }
);
