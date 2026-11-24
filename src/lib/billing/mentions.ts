/**
 * Mentions obligatoires des factures (Code de commerce L441-9, CGI annexe II art. 242 nonies A) : textes composés
 * à partir de la société émettrice, du client, des conditions de paiement et des lignes. Module sans dépendance serveur.
 */

export type SocieteLegale = {
    legalForm?: string; shareCapital?: number | null; rcsCity?: string; siren?: string; siret?: string;
    vatOnDebits?: boolean; latePenaltyRate?: string; earlyPaymentDiscount?: string;
};

export const PENALITES_DEFAUT = '1,5 % par mois';
export const ESCOMPTE_DEFAUT = "Pas d'escompte pour paiement anticipé.";
export const DELAI_DEFAUT = '30 jours à compter de la date de facture';
export const MENTION_DEBITS = "Option pour le paiement de la taxe d'après les débits.";

const chiffres = (v?: string) => (v ?? '').replace(/\D/g, '');
const groupe3 = (v: string) => v.replace(/(\d{3})(?=\d)/g, '$1 ');
const euros = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 }).replace(/[  ]/g, ' ')} €`;

/** « SAS au capital de 1 000 000 € · RCS Lyon 900 000 000 » ; vide si rien n'est renseigné. */
export function identiteLegale(c: SocieteLegale): string {
    const siren = chiffres(c.siren) || chiffres(c.siret).slice(0, 9);
    const forme = c.legalForm?.trim();
    const capital = typeof c.shareCapital === 'number' && c.shareCapital > 0 ? `au capital de ${euros(c.shareCapital)}` : '';
    const rcs = c.rcsCity?.trim() ? `RCS ${c.rcsCity.trim()}${siren.length === 9 ? ` ${groupe3(siren)}` : ''}` : '';
    return [[forme, capital].filter(Boolean).join(' '), rcs].filter(Boolean).join(' · ');
}

/** Ce qui manque à la société pour une facture complète (affiché au paramétrage). */
export function manquesSociete(c: SocieteLegale & { vatNumber?: string; address?: string }): string[] {
    return [
        !c.legalForm?.trim() && 'forme juridique',
        !(typeof c.shareCapital === 'number' && c.shareCapital > 0) && 'capital social',
        !c.rcsCity?.trim() && "ville d'immatriculation au RCS",
        !chiffres(c.siret) && !chiffres(c.siren) && 'SIRET',
        !c.vatNumber?.trim() && 'numéro de TVA intracommunautaire',
        !c.address?.trim() && 'adresse',
    ].filter((x): x is string => !!x);
}

/** Conditions de paiement imprimées : le libellé du paramétrage, sinon le délai par défaut. */
export function conditionsPaiement(term?: { deadline?: string } | null): string {
    return `Conditions de paiement : ${term?.deadline?.trim() || DELAI_DEFAUT}.`;
}

export function mentionPenalites(c: SocieteLegale): string {
    return `Tout retard de paiement entraîne des pénalités de ${c.latePenaltyRate?.trim() || PENALITES_DEFAUT} ainsi qu'une indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 du Code de commerce).`;
}

export const mentionEscompte = (c: SocieteLegale) => c.earlyPaymentDiscount?.trim() || ESCOMPTE_DEFAUT;

export type NatureActivite = 'biens' | 'services';
export type ActiviteNature = { code: string; type?: string; operationNature?: NatureActivite };

/** Nature d'une activité : celle du paramétrage, sinon fourniture d'énergie (P1) = biens, le reste = services. */
export function natureActivite(a?: ActiviteNature): NatureActivite {
    return a?.operationNature ?? (a?.type === 'P1' ? 'biens' : 'services');
}

/** Nature de l'opération de la facture, d'après les activités de ses lignes (activité inconnue : services). */
export function natureOperation(lignes: { activityCode?: string }[], activites: ActiviteNature[]): string {
    const parCode = new Map(activites.map(a => [a.code, a]));
    const natures = new Set(lignes.map(l => natureActivite(l.activityCode ? parCode.get(l.activityCode) : undefined)));
    if (natures.has('biens') && natures.has('services')) return 'Livraison de biens et prestation de services';
    return natures.has('biens') ? 'Livraison de biens' : 'Prestation de services';
}

export type Adresse = { name?: string; address?: string; postalCode?: string; city?: string };

const cle = (a: Adresse) => `${a.address ?? ''}|${a.postalCode ?? ''}|${a.city ?? ''}`.toLowerCase().replace(/[\s,.-]+/g, '');

/** Lieux d'exécution à imprimer : les sites des lignes dont l'adresse diffère de l'adresse de facturation. */
export function lieuxExecution(sites: Adresse[], facturation: Adresse): string[] {
    const vus = new Set<string>();
    const lieux: string[] = [];
    for (const s of sites) {
        if (!s.address?.trim() || cle(s) === cle(facturation)) continue;
        const texte = [s.name?.trim(), [s.address.trim(), `${s.postalCode ?? ''} ${s.city ?? ''}`.trim()].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
        if (!vus.has(texte)) { vus.add(texte); lieux.push(texte); }
    }
    return lieux;
}

/** Numéro de TVA intracommunautaire français déduit du SIREN (clé de contrôle) ; null si le SIREN est invalide. */
export function tvaDepuisSiren(siretOuSiren?: string): string | null {
    const siren = chiffres(siretOuSiren).slice(0, 9);
    if (siren.length !== 9) return null;
    const k = (12 + 3 * (Number(siren) % 97)) % 97;
    return `FR${String(k).padStart(2, '0')}${siren}`;
}
