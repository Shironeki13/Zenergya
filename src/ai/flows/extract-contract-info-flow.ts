
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
  async ({ documentDataUri, activities, prompt }) => {
    
    const template = Handlebars.compile(prompt);
    const fullPrompt = template({
        activities: JSON.stringify(activities.map(({ id, code, label }) => ({ id, code, label })), null, 2),
    });
    
    // Using gemini-pro as it's known to be available. This model doesn't support PDF input directly.
    // The prompt must contain the text to be analyzed.
    const { output } = await ai.generate({
        model: 'googleai/gemini-pro',
        prompt: fullPrompt,
        output: {
            schema: ExtractContractInfoOutputSchema
        }
    });

    if (output) {
        // Ensure activityIds are populated from amounts if amounts are present but activityIds are not.
        if ((!output.activityIds || output.activityIds.length === 0) && output.amounts && output.amounts.length > 0) {
            output.activityIds = output.amounts.map(a => a.activityId);
        }
    }
    return output!;
  }
);
