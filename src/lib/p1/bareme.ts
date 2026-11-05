import { controlerBareme, EXIGENCES_MARCHE, type TrancheBareme, type TypeMarche } from '@/lib/p1/parametrage';

/**
 * Barème de partage de l'écart (RG-53) et régularisation (RG-54), comme le moteur P1 (moteur/marche.py).
 *
 * - Écart = N'B − NC : positif, économie ; négatif, dépassement.
 * - Les tranches d'un sens découpent la valeur absolue de l'écart en fractions du N'B ; chaque tranche donne sa
 *   part au client. Un sens sans tranche : partage nul (100 % exploitant), signalé, jamais supposé.
 * - Régularisation (signée : positive, à facturer au client ; négative, à lui reverser) : sur un MTI l'écart est
 *   chez l'exploitant et seule la part du client circule ; sur un MCI, CPI, PFI l'écart est chez le client et la
 *   part de l'exploitant lui est facturée (en économie) ou rendue (en dépassement). Sans intéressement : 0.
 */

const SENS: Record<string, TrancheBareme['sens']> = { economie: 'economie', eco: 'economie', 'économie': 'economie', depassement: 'depassement', dep: 'depassement', 'dépassement': 'depassement' };
const pct = (s: string) => Number(s.replace(',', '.').replace('%', '').trim()) / 100;

/** « économie 0-10 % 50 % ; économie 10-100 % 70 % ; dépassement 0-100 % 30 % » → tranches ; message sinon. */
export function parseBareme(text: string): TrancheBareme[] | string {
    const out: TrancheBareme[] = [];
    for (const part of text.split(';').map(p => p.trim()).filter(Boolean)) {
        const m = /^(\S+)\s+([\d.,]+)\s*%?\s*[-–à]\s*([\d.,]+)\s*%?\s*[:=]?\s*([\d.,]+)\s*%?$/i.exec(part);
        const sens = m ? SENS[m[1].toLowerCase()] : undefined;
        if (!m || !sens) return `tranche « ${part} » illisible : « économie 0-10 % 50 % » (sens, bornes en % du N'B, part du client en %).`;
        out.push({ sens, borneBasse: pct(m[2]), borneHaute: pct(m[3]), partClient: pct(m[4]) });
    }
    return out.length ? out : 'barème vide.';
}

export const formatBareme = (tranches: TrancheBareme[]) => tranches
    .map(t => `${t.sens === 'economie' ? 'économie' : 'dépassement'} ${+(t.borneBasse * 100).toFixed(4)}-${+(t.borneHaute * 100).toFixed(4)} % ${+(t.partClient * 100).toFixed(4)} %`)
    .join(' ; ');

/** Contrôle d'un barème : bornes et parts, tranches contiguës depuis 0 pour chaque sens défini. */
export function validateBareme(tranches: TrancheBareme[]): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    for (const t of tranches) {
        if (!(t.borneBasse >= 0) || !(t.borneHaute > t.borneBasse)) errors.push(`tranche ${t.sens} : bornes ${t.borneBasse * 100} à ${t.borneHaute * 100} % invalides`);
        if (!(t.partClient >= 0 && t.partClient <= 1)) errors.push(`tranche ${t.sens} : part du client entre 0 et 100 %`);
    }
    const warnings: string[] = [];
    for (const anomalie of controlerBareme(tranches)) {
        if (anomalie.startsWith('aucune tranche')) warnings.push(`${anomalie.replace('economie', 'économie').replace('depassement', 'dépassement')} : partage nul (100 % exploitant)`);
        else errors.push(anomalie);
    }
    return { errors, warnings };
}

export type PartageDetail = { sens: TrancheBareme['sens']; borneBasse: number; borneHaute: number; quantite: number; partClient: number; quantiteClient: number };

/** RG-53 : part du client et de l'exploitant (valeurs absolues, MWh) et détail par tranche. */
export function partage(ecart: number, nPrimeB: number, tranches: TrancheBareme[]): { client: number; exploitant: number; detail: PartageDetail[]; alerte?: string } {
    const sens: TrancheBareme['sens'] = ecart >= 0 ? 'economie' : 'depassement';
    const absolu = Math.abs(ecart);
    const zones = tranches.filter(t => t.sens === sens).sort((a, b) => a.borneBasse - b.borneBasse);
    if (zones.length === 0) {
        return { client: 0, exploitant: absolu, detail: [], alerte: `aucune tranche ${sens === 'economie' ? "d'économie" : 'de dépassement'} : partage nul (100 % exploitant)` };
    }
    let client = 0;
    const detail: PartageDetail[] = zones.map(z => {
        const quantite = Math.max(0, Math.min(absolu, z.borneHaute * nPrimeB) - z.borneBasse * nPrimeB);
        client += quantite * z.partClient;
        return { sens, borneBasse: z.borneBasse, borneHaute: z.borneHaute, quantite, partClient: z.partClient, quantiteClient: quantite * z.partClient };
    });
    return { client, exploitant: absolu - client, detail };
}

/** RG-54 : quantité de régularisation (MWh, signée : positive à facturer au client), à valoriser au prix K. */
export function quantiteRegularisation(typeMarche: TypeMarche, ecart: number, partClient: number): number {
    if (!EXIGENCES_MARCHE[typeMarche].bareme) return 0;
    const economie = ecart >= 0;
    if (typeMarche === 'MTI') return economie ? -partClient : partClient;
    return economie ? ecart - partClient : -(Math.abs(ecart) - partClient);
}
