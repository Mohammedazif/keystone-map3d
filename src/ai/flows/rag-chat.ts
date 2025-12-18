import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { devLocalRetrieverRef } from '@genkit-ai/dev-local-vectorstore';

const RagChatInputSchema = z.object({
    query: z.string().describe('The user question or query.'),
});

export const ragChat = ai.defineFlow(
    {
        name: 'ragChat',
        inputSchema: RagChatInputSchema,
        outputSchema: z.string(),
    },
    async (input) => {
        // 1. Retrieve relevant documents
        const docs = await ai.retrieve({
            retriever: devLocalRetrieverRef('compliance-rag'),
            query: input.query,
            options: { k: 10 }, // Retrieve top 10 documents
        });

        // 2. Construct context from retrieved documents
        const context = docs.map((d) => d.content[0].text).join('\n\n');

        // 3. Generate answer using the LLM
        const { text } = await ai.generate({
            prompt: `
        You are a helpful AI assistant for a construction project.
        Use the following context to answer the user's question.
        If the answer is not in the context, say you don't know.
        
        Context:
        ${context}
        
        Question:
        ${input.query}
      `,
        });

        return text;
    }
);
