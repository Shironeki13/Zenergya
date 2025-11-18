
'use server';
/**
 * @fileOverview Flow to extract contract information from a PDF document.
 *
 * - extractContractInfo - The main function to trigger the analysis.
 */

import { ai } from '@/ai/genkit';
import { ExtractContractInfoInputSchema, ExtractContractInfoOutputSchema, type ExtractContractInfoInput, type ExtractContractInfoOutput } from '@/lib/types';
import Handlebars from 'handlebars';


export async function extractContractInfo(input: ExtractContractInfoInput): Promise<ExtractContractInfoOutput> {
  return extractContractInfoFlow(input);
}

const extractContractInfoFlow = ai.defineFlow(
  {
    name: 'extractContractInfoFlow',
    inputSchema: ExtractContractInfoInputSchema,
    outputSchema: ExtractContractInfoOutputSchema,
  },
  async (input) => {
    
    const template = Handlebars.compile(input.prompt);
    const fullPrompt = template({
        activities: JSON.stringify(input.activities.map(({ id, code, label }) => ({ id, code, label })), null, 2),
        documentDataUri: input.documentDataUri,
    });
    
    const { output } = await ai.generate({
        prompt: fullPrompt,
        model: 'googleai/gemini-pro',
        output: {
            schema: ExtractContractInfoOutputSchema
        }
    });

    if (output) {
        // Automatically populate activityIds from the extracted amounts if not already present
        if (!output.activityIds || output.activityIds.length === 0) {
            output.activityIds = output.amounts?.map(a => a.activityId) ?? [];
        }
    }
    return output!;
  }
);
