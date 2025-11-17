
'use server';
/**
 * @fileOverview Flow to extract contract information from a PDF document.
 *
 * - extractContractInfo - The main function to trigger the analysis.
 * - ExtractContractInfoInput - The input type for the flow.
 * - ExtractContractInfoOutput - The return type for the flow.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import type { Activity } from '@/lib/types';


export const ExtractContractInfoInputSchema = z.object({
  documentDataUri: z.string().describe("A contract document as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:application/pdf;base64,<encoded_data>'."),
  activities: z.array(z.object({
    id: z.string(),
    code: z.string(),
    label: z.string(),
  })).describe('List of available activities to choose from.'),
});
export type ExtractContractInfoInput = z.infer<typeof ExtractContractInfoInputSchema>;

export const ExtractContractInfoOutputSchema = z.object({
  name: z.string().optional().describe("Raison sociale du client. Toujours en MAJUSCULES."),
  address: z.string().optional().describe("Adresse complète du client (numéro, rue, etc.)."),
  postalCode: z.string().optional().describe("Code postal du client."),
  city: z.string().optional().describe("Ville du client. Toujours en MAJUSCULES."),
  clientType: z.enum(["private", "public"]).optional().describe("Le type de client, 'private' (privé) ou 'public' (public)."),
  typologyId: z.string().optional().describe("L'ID de la typologie client. Ex: 'Copropriété', 'Industrie', 'Tertiaire'."),
  representedBy: z.string().optional().describe("Le représentant légal, pertinent seulement si la typologie est 'Copropriété'."),
  useChorus: z.boolean().optional().describe("Indique si le client utilise la facturation via Chorus Pro. Déduire si un SIRET est présent pour un client public."),
  siret: z.string().optional().describe("Le numéro de SIRET du client, si disponible."),
  chorusServiceCode: z.string().optional().describe("Le code service Chorus, si disponible."),
  chorusLegalCommitmentNumber: z.string().optional().describe("Le numéro d'engagement juridique (EJ) pour Chorus, si disponible."),
  activityIds: z.array(z.string()).optional().describe("Un tableau des IDs des prestations (activités) trouvées dans le document. Choisir parmi la liste fournie."),
  startDate: z.string().optional().describe("Date de démarrage du contrat au format ISO 8601 (YYYY-MM-DD)."),
  endDate: z.string().optional().describe("Date de fin du contrat au format ISO 8601 (YYYY-MM-DD)."),
  renewal: z.boolean().optional().describe("Indique si le contrat est à reconduction."),
  renewalDuration: z.string().optional().describe("La durée de la reconduction (ex: '1 an', '2 ans')."),
  tacitRenewal: z.boolean().optional().describe("Indique si la reconduction est tacite."),
});
export type ExtractContractInfoOutput = z.infer<typeof ExtractContractInfoOutputSchema>;


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
