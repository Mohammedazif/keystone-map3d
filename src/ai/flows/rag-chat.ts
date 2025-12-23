import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { generateWithFallback } from '@/ai/model-fallback';
import { retrieveRegulationsServer, type RegulationDocument } from '@/ai/firestore-retriever-server';

const RagChatInputSchema = z.object({
    query: z.string().describe('The user question or query.'),
    isGeneralMode: z.boolean().optional().describe('If true, answer based on general principles/NBC unless specified otherwise.'),
    buildingContext: z.string().optional().describe('JSON string or description of the selected building context'),
});

export const ragChat = ai.defineFlow(
    {
        name: 'ragChat',
        inputSchema: RagChatInputSchema,
        outputSchema: z.string(),
    },
    async (input) => {
        const firestoreDocs = await retrieveRegulationsServer(input.query, 100, input.isGeneralMode);
        console.log('[RAG Chat] Retrieved', firestoreDocs.length, 'documents from Firestore');

        let docContext = firestoreDocs.map((d: RegulationDocument) => d.text).join('\n\n');

        let MAX_CONTEXT_CHARS = 120000;
        let preferredModel = undefined;

        if (docContext.length > 120000) {
            MAX_CONTEXT_CHARS = 800000;
            preferredModel = 'googleai/gemini-2.5-flash';
            console.log('[RAG Chat] Context is large (>120k chars). Switching to Gemini Flash with 800k limit.');
        }

        if (docContext.length > MAX_CONTEXT_CHARS) {
            console.warn(`[RAG Chat] Context too large (${docContext.length} chars). Truncating to ${MAX_CONTEXT_CHARS}.`);
            docContext = docContext.substring(0, MAX_CONTEXT_CHARS) + "\n...[Context Truncated]...";
        }

        console.log('[RAG Chat] Context length:', docContext.length, 'characters');

        const prompt = `
        You are an expert urban planning and building regulation assistant for the GeoConstruct platform.
        Your goal is to answer the user's questions about building regulations, zoning, project feasibility, sustainability, and Vastu based on the provided context.

        ${input.isGeneralMode ? "**MODE: GENERAL KNOWLEDGE (Using National/General standards, ignoring specific project location)**" : "**MODE: SPECIFIC PROJECT (Focusing on selected location)**"}

        Building Context (if selected):
        ${input.buildingContext ? JSON.stringify(JSON.parse(input.buildingContext).selectedBuilding, null, 2) : 'No building selected.'}

        Current Project Location:
        ${input.isGeneralMode ? "GENERAL / NATIONAL (User requested general knowledge, e.g. NBC)" : (input.buildingContext ? JSON.parse(input.buildingContext).location : 'Unknown')}
        
        Knowledge Base Context:
        ${docContext}
        
        User Question:
        ${input.query}
        
        Instructions:
        1.  **Identity Context**: You are an expert urban planning assistant. Use the "Knowledge Base Context" (RAG) as your primary source of truth.
        2.  **Location Matching (CRITICAL)**:
            - Priority 1: If the user mentions a specific location in their **question** (e.g., "in Karnataka"), you MUST use only information related to that location.
            - Priority 2: ${input.isGeneralMode ? "If no location in question, use GENERAL/NATIONAL regulations (NBC). Do NOT restrict to the 'Unknown' or prior context." : `If the question doesn't specify a location, use the "Current Project Location" provided above.`}
            - **NO HALLUCINATION**: If the requested location (from the question or project context) is NOT found in the Knowledge Base, you MUST explicitly state: "Regulations for [Location] are not available in the current knowledge base."
            - **DO NOT** use regulations from another city/state (like Delhi) to answer a question about a different location (like Karnataka) unless the user specifically asks for a comparison.
        3.  **General Planning Knowledge**: 
            - If the question is about general concepts (e.g., "What is FAR?", "Benefits of Green Building") and NOT about specific numbers/limits for a location:
            - **You MAY use your general knowledge** to define terms and explain concepts if the Knowledge Base is insufficient.
            - Do NOT use the "not available" disclaimer for general definitions. Only use it if you are asked for a *specific regulation/value* (e.g. "What is the FAR in Bangalore?") that is missing.
        4.  **Building Evaluations**: If a building is selected, compare its properties (height, area, etc.) against the specific regulations found for the active location.
        5.  **Concise & Accurate**: Be professional. If multiple documents conflict, report the contradiction.
      `;

        return await generateWithFallback(prompt, preferredModel);
    }
);
