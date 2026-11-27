/**
 * Modèle d'IA (Gemini) utilisé pour lire les documents et répondre aux questions.
 *
 * Réglable sans toucher au code : variable d'environnement `GEMINI_MODELE` (ex. « gemini-3.8-flash »). Par défaut, le
 * modèle Flash stable le plus récent à la date de mise à jour (lecture des PDF et réponse structurée). Les modèles
 * Gemini sont dépréciés puis arrêtés régulièrement : voir https://ai.google.dev/gemini-api/docs/deprecations.
 */
export const MODELE_DEFAUT = 'gemini-3.8-flash';

export function nomModele(env: Record<string, string | undefined> = process.env): string {
    const m = env.GEMINI_MODELE?.trim().replace(/^googleai\//, '');
    return m || MODELE_DEFAUT;
}

/** Référence Genkit du modèle (plugin Google AI). */
export const modeleIA = (env?: Record<string, string | undefined>) => `googleai/${nomModele(env)}`;

/** Lecture par l'IA impossible sans clé : message clair plutôt qu'une erreur du fournisseur. */
export function exigerCleIA(env: Record<string, string | undefined> = process.env): void {
    if (!env.GEMINI_API_KEY?.trim()) throw new Error("Lecture par l'IA non configurée : la clé GEMINI_API_KEY est absente du serveur. Saisissez le contrat à la main ou demandez à un administrateur de la renseigner.");
}
