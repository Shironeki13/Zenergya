
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
  prompt: `Tu es un expert en analyse de documents contractuels. Analyse le document PDF fourni et extrais les informations suivantes de manière structurée. Si une information n'est pas trouvée, laisse le champ vide.

  Voici les informations à extraire:
  - Raison sociale du client (name): Le nom complet du client. Toujours en MAJUSCULES.
  - Adresse (address): L'adresse complète du client (numéro, rue, etc.).
  - Code Postal (postalCode): Le code postal du client.
  - Ville (city): La ville du client. Toujours en MAJUSCULES.
  - Type de client (clientType): Détermine si le client est 'private' (privé) ou 'public' (public).
  - Typologie du client (typologyId): Déduis la typologie du client. Ce doit être l'une des valeurs suivantes : 'Santé', 'Industrie', 'Tertiaire', 'Défense', 'Copropriété', 'Bailleur Social'.
  - Représenté par (representedBy): Le représentant légal, pertinent uniquement si la typologie est 'Copropriété'.
  - Prestations/Activités (amounts): Pour chaque prestation détectée dans le contrat, extrais son montant annuel HT. Les prestations à rechercher sont : P1 (Fourniture et gestion de l’énergie), P2 (Maintenance préventive et petit entretien), P3 (Garantie totale / gros entretien). Tu dois retourner un tableau d'objets, chacun avec 'activityId' (l'ID de l'activité correspondante) et 'amount' (le montant numérique). Choisis les IDs parmi cette liste de prestations disponibles: {{{json activities}}}
  - Date de démarrage (startDate): La date de début du contrat, au format YYYY-MM-DD.
  - Date de fin (endDate): La date de fin du contrat, au format YYYY-MM-DD.
  - Reconduction (renewal): Indique si le contrat est à reconduction (true ou false).
  - Durée de la reconduction (renewalDuration): Si la reconduction est activée, précise sa durée (ex: '1 an').
  - Tacite reconduction (tacitRenewal): Si la reconduction est activée, indique si elle est tacite (true ou false).

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
    if (output) {
        // Automatically populate activityIds from the extracted amounts
        output.activityIds = output.amounts?.map(a => a.activityId) ?? [];
    }
    return output!;
  }
);

