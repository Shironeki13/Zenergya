'use server';
/**
 * @fileOverview Un flow simple pour répondre à des questions.
 *
 * - askQuestion - La fonction principale pour poser une question.
 * - AskQuestionInput - Le type d'entrée pour la fonction.
 * - AskQuestionOutput - Le type de retour pour la fonction.
 */
import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const AskQuestionInputSchema = z.object({
  question: z.string().describe('La question à poser à lIA.'),
});
export type AskQuestionInput = z.infer<typeof AskQuestionInputSchema>;

const AskQuestionOutputSchema = z.object({
  answer: z.string().describe('La réponse fournie par lIA.'),
});
export type AskQuestionOutput = z.infer<typeof AskQuestionOutputSchema>;

// Cette fonction est exportée pour être appelée depuis le front-end.
export async function askQuestion(
  input: AskQuestionInput
): Promise<AskQuestionOutput> {
  return qaFlow(input);
}

// Définition du flow Genkit
const qaFlow = ai.defineFlow(
  {
    name: 'qaFlow',
    inputSchema: AskQuestionInputSchema,
    outputSchema: AskQuestionOutputSchema,
  },
  async (input) => {
    // Utilisation du modèle 'gemini-pro', qui est un modèle standard pour le texte.
    const { text } = await ai.generate({
      model: 'googleai/gemini-pro',
      prompt: `Réponds à la question suivante de manière concise : ${input.question}`,
    });

    return {
      answer: text,
    };
  }
);
