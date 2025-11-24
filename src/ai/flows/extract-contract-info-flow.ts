
'use server';
/**
 * @fileOverview Flow to extract contract information from a PDF document.
 *
 * - extractContractInfo - The main function to trigger the analysis.
 */
import { ai } from '@/ai/genkit';
import { ExtractContractInfoInputSchema, ExtractContractInfoOutputSchema, type ExtractContractInfoInput, type ExtractContractInfoOutput } from '@/lib/types';
import { getTypologies, getSchedules, getTerms, getActivities } from '@/services/firestore';
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
  async ({ documentDataUri, activities, prompt, typologies, schedules, terms }) => {
    
    const template = Handlebars.compile(prompt);
    const fullPrompt = template({
        activities: JSON.stringify(activities.map(({ id, code, label }) => ({ id, code, label })), null, 2),
        typologies: JSON.stringify(typologies.map(({ id, name }) => ({ id, name })), null, 2),
        schedules: JSON.stringify(schedules.map(({ id, name }) => ({ id, name })), null, 2),
        terms: JSON.stringify(terms.map(({ id, name }) => ({ id, name })), null, 2),
    });
    
    const { output } = await ai.generate({
        model: 'googleai/gemini-1.5-flash-latest',
        prompt: [
            { text: fullPrompt },
            { media: { url: documentDataUri, contentType: 'application/pdf' } }
        ],
        output: {
            schema: ExtractContractInfoOutputSchema
        },
        config: {
            temperature: 0.2,
        },
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
