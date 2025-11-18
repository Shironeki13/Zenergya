
'use server';
/**
 * @fileOverview Flow to extract contract information from a PDF document.
 *
 * - extractContractInfo - The main function to trigger the analysis.
 */

import { ai } from '@/ai/genkit';
import { ExtractContractInfoInputSchema, ExtractContractInfoOutputSchema, type ExtractContractInfoInput, type ExtractContractInfoOutput } from '@/lib/types';


export async function extractContractInfo(input: ExtractContractInfoInput): Promise<ExtractContractInfoOutput> {
  return extractContractInfoFlow(input);
}


const prompt = ai.definePrompt({
  name: 'extractContractInfoPrompt',
  input: { schema: ExtractContractInfoInputSchema },
  output: { schema: ExtractContractInfoOutputSchema },
  prompt: `Tu es un expert en analyse de documents contractuels. Analyse le document PDF fourni et extrais les informations suivantes de manière structurée.

  Voici les informations à extraire:
  - Raison sociale du client (name)
  - Adresse, Code Postal, Ville (address, postalCode, city)
  - Type de client: 'private' ou 'public' (clientType)
  - Typologie du client (typologyId). Par exemple 'Copropriété'.
  - Représenté par (representedBy), si c'est une copropriété.
  - Utilisation de Chorus Pro (useChorus). Si le client est 'public' et qu'un SIRET est mentionné, mettre à true.
  - SIRET (siret)
  - Code service Chorus (chorusServiceCode)
  - Numéro d'engagement juridique Chorus (chorusLegalCommitmentNumber)
  - Prestations/Activités (activityIds). C'est un tableau d'IDs. Tu dois choisir les IDs correspondants parmi cette liste de prestations disponibles: {{{json activities}}}
  - Date de démarrage (startDate) au format YYYY-MM-DD.
  - Date de fin (endDate) au format YYYY-MM-DD.
  - Reconduction (renewal): true ou false.
  - Durée de la reconduction (renewalDuration), si applicable.
  - Tacite reconduction (tacitRenewal): true ou false, si applicable.

  Document à analyser:
  {{media url=documentDataUri}}
  `,
});

const extractContractInfoFlow = ai.defineFlow(
  {
    name: 'extractContractInfoFlow',
    inputSchema: ExtractContractInfoInputSchema,
    outputSchema: ExtractContractInfoOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);
