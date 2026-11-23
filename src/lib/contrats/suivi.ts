import { decaler, lireDuree } from './frise';
import type { Contract } from '@/lib/types';

/**
 * Tableau de bord de la contrathèque (logique pure) : ce qu'il faut traiter sur l'ensemble des contrats — échéances
 * dépassées, dates limites de préavis, échéances proches, documents en attente de validation ou refusés,
 * résiliations à venir — classé par urgence, et le calendrier des douze prochains mois.
 */

export type TypeDocumentSuivi = 'avenant' | 'os' | 'reconduction' | 'resiliation' | 'syndic' | 'be';
/** Natures proposées en sous-filtre, dans l'ordre d'affichage. */
export const NATURES_DOCUMENT: (TypeDocumentSuivi | 'contrat')[] = ['contrat', 'avenant', 'os', 'reconduction', 'resiliation', 'syndic', 'be'];
export const LIBELLE_NATURE: Record<TypeDocumentSuivi | 'contrat', string> = { contrat: 'Contrat', avenant: 'Avenant', os: 'Ordre de service', reconduction: 'Reconduction', resiliation: 'Résiliation', syndic: 'Changement de syndic', be: 'Changement de BE' };
export const LIBELLE_DOCUMENT: Record<TypeDocumentSuivi, string> = { avenant: 'Avenant', os: 'Ordre de service', reconduction: 'Reconduction', resiliation: 'Résiliation', syndic: 'Changement de syndic', be: 'Changement de bureau d\'études' };

/** Document de contrat à suivre (lu au serveur) : en attente, refusé, ou résiliation validée à effet futur. */
export type DocumentSuivi = {
    type: TypeDocumentSuivi; id: string; contractId: string;
    etat: 'en_attente' | 'refuse' | 'valide';
    deposeLe: string | null; deposePar: string;
    /** Date d'effet (jour) si le document en porte une. */
    effet: string | null;
    resume: string;
    motifRefus?: string;
    decideLe?: string | null;
};

export type Gravite = 'critique' | 'attention' | 'info';
export type TypeSuivi = 'echeance_depassee' | 'preavis' | 'echeance' | 'contrat_attente' | 'contrat_refuse' | 'document_attente' | 'document_refuse' | 'resiliation_a_venir';
export const LIBELLE_SUIVI: Record<TypeSuivi, string> = {
    echeance_depassee: 'Échéance dépassée', preavis: 'Préavis', echeance: 'Échéance', contrat_attente: 'Contrat à valider', contrat_refuse: 'Contrat refusé',
    document_attente: 'Document à valider', document_refuse: 'Document refusé', resiliation_a_venir: 'Résiliation à venir',
};

export type LigneSuivi = {
    cle: string; type: TypeSuivi; gravite: Gravite;
    /** Nature de ce qui est à valider ou refusé : le contrat lui-même, ou un de ses documents. */
    document?: TypeDocumentSuivi | 'contrat';
    contractId: string; contrat: string; client: string;
    /** Jour de l'échéance, du préavis, de l'effet ou du dépôt. */
    date: string | null;
    /** Jours avant la date (négatif : dépassée ; pour un document en attente : jours d'attente). */
    jours: number | null;
    texte: string;
};

export type MoisCalendrier = { mois: string; preavis: { contractId: string; contrat: string; client: string; date: string }[]; echeances: { contractId: string; contrat: string; client: string; date: string; tacite: boolean }[] };

export type SuiviContratheque = {
    chiffres: { actifs: number; aValider: number; refuses: number; preavis90: number; echeances180: number; depassees: number; sansPreavis: number };
    lignes: LigneSuivi[];
    calendrier: MoisCalendrier[];
};

const jour = (d?: string | null) => (d ? String(d).slice(0, 10) : null);
const fr = (d: string) => d.split('-').reverse().join('/');
const ecart = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
/** Motif sans ponctuation finale (la phrase la remet). */
const motif = (m?: string) => (m ? ` : ${m.trim().replace(/[.\s]+$/, '')}` : '');
const RANG: Record<Gravite, number> = { critique: 0, attention: 1, info: 2 };

export const SEUILS_SUIVI = { preavisCritique: 60, preavisAttention: 180, echeance: 180, attenteLongue: 7, refusRecents: 60 };

export function suiviContratheque(contracts: Contract[], documents: DocumentSuivi[], today: string, seuils = SEUILS_SUIVI): SuiviContratheque {
    const lignes: LigneSuivi[] = [];
    const parId = new Map(contracts.map(c => [c.id, c]));
    const nom = (c?: Contract) => ({ contrat: c?.contractNumber ?? c?.id ?? '—', client: c?.clientName ?? '—' });
    const calendrier: MoisCalendrier[] = [];
    for (let i = 0; i < 12; i++) calendrier.push({ mois: decaler(`${today.slice(0, 7)}-01`, { mois: i, jours: 0 }, 1).slice(0, 7), preavis: [], echeances: [] });
    const duMois = (d: string) => calendrier.find(m => m.mois === d.slice(0, 7));
    let sansPreavis = 0;

    for (const c of contracts) {
        const base = { contractId: c.id, ...nom(c) };
        if (c.validationStatus === 'pending_validation') {
            const depose = jour(c.createdAt);
            const attente = depose ? ecart(depose, today) : null;
            lignes.push({ cle: `contrat:${c.id}`, type: 'contrat_attente', document: 'contrat', gravite: attente !== null && attente > seuils.attenteLongue ? 'critique' : 'attention', ...base, date: depose, jours: attente, texte: `Contrat en attente de validation${attente !== null ? ` depuis ${attente} jour(s)` : ''}${c.requesterEmail || c.createdBy ? `, déposé par ${c.requesterEmail ?? c.createdBy}` : ''}.` });
        } else if (c.validationStatus === 'refused') {
            lignes.push({ cle: `contrat:${c.id}`, type: 'contrat_refuse', document: 'contrat', gravite: 'attention', ...base, date: jour(c.createdAt), jours: null, texte: `Contrat refusé${motif(c.refusalReason)}. À corriger par le demandeur.` });
        }
        if (c.status !== 'Actif') continue;
        const fin = jour(c.endDate);
        if (!fin) continue;
        const tacite = !!c.renewal && !!c.tacitRenewal;
        const reste = ecart(today, fin);
        if (reste < 0) {
            lignes.push({ cle: `echeance:${c.id}`, type: 'echeance_depassee', gravite: 'critique', ...base, date: fin, jours: reste, texte: `Échéance dépassée depuis ${-reste} jour(s) (${fr(fin)}) : contrat toujours actif, à reconduire ou à terminer.` });
            continue;
        }
        duMois(fin)?.echeances.push({ ...base, date: fin, tacite });
        const preavis = lireDuree(c.noticePeriod);
        if (!preavis) sansPreavis++;
        const limite = preavis ? decaler(fin, preavis, -1) : null;
        if (limite && limite >= today) {
            duMois(limite)?.preavis.push({ ...base, date: limite });
            const j = ecart(today, limite);
            if (j <= seuils.preavisAttention) {
                lignes.push({ cle: `preavis:${c.id}`, type: 'preavis', gravite: j <= seuils.preavisCritique ? 'critique' : 'attention', ...base, date: limite, jours: j, texte: `Date limite de préavis dans ${j} jour(s) (${fr(limite)}), ${c.noticePeriod} avant l'échéance du ${fr(fin)}${tacite ? ' ; sans dénonciation, reconduction tacite' : ''}.` });
            }
        }
        if (reste <= seuils.echeance) {
            const passe = limite !== null && limite < today;
            lignes.push({
                cle: `echeance:${c.id}`, type: 'echeance', gravite: !preavis ? 'attention' : 'info', ...base, date: fin, jours: reste,
                texte: `Échéance dans ${reste} jour(s) (${fr(fin)})${tacite ? `, reconduction tacite${c.renewalDuration ? ` de ${c.renewalDuration}` : ''}` : c.renewal ? ', reconduction possible' : ', sans reconduction'}`
                    + (passe ? ' ; préavis dépassé.' : !preavis ? ` ; préavis ${c.noticePeriod ? `« ${c.noticePeriod} » non reconnu` : 'non renseigné'} : date limite de dénonciation inconnue.` : '.'),
            });
        }
    }

    for (const d of documents) {
        const c = parId.get(d.contractId);
        const base = { contractId: d.contractId, ...nom(c) };
        const libelle = LIBELLE_DOCUMENT[d.type];
        const e = d.type === 'reconduction' || d.type === 'resiliation' ? 'e' : '';   // accord : une reconduction refusée
        if (d.etat === 'en_attente') {
            const attente = d.deposeLe ? ecart(d.deposeLe, today) : null;
            lignes.push({ cle: `doc:${d.type}:${d.id}`, type: 'document_attente', document: d.type, gravite: attente !== null && attente > seuils.attenteLongue ? 'critique' : 'attention', ...base, date: d.deposeLe, jours: attente, texte: `${libelle} en attente de validation${attente !== null ? ` depuis ${attente} jour(s)` : ''}${d.deposePar ? `, déposé${e} par ${d.deposePar}` : ''}${motif(d.resume)}.` });
        } else if (d.etat === 'refuse') {
            const depuis = d.decideLe ? ecart(d.decideLe, today) : null;
            if (depuis === null || depuis <= seuils.refusRecents) lignes.push({ cle: `doc:${d.type}:${d.id}`, type: 'document_refuse', document: d.type, gravite: 'info', ...base, date: d.decideLe ?? d.deposeLe, jours: null, texte: `${libelle} refusé${e}${motif(d.motifRefus)}${d.deposePar ? ` (déposé${e} par ${d.deposePar})` : ''}. À corriger et redéposer.` });
        } else if (d.type === 'resiliation' && d.effet && d.effet >= today) {
            const j = ecart(today, d.effet);
            lignes.push({ cle: `doc:${d.type}:${d.id}`, type: 'resiliation_a_venir', document: d.type, gravite: j <= 30 ? 'attention' : 'info', ...base, date: d.effet, jours: j, texte: `Résiliation validée, effective dans ${j} jour(s) (${fr(d.effet)})${motif(d.resume)}.` });
        }
    }

    lignes.sort((a, b) => RANG[a.gravite] - RANG[b.gravite] || (a.type.startsWith('document') || a.type.startsWith('contrat') ? -(a.jours ?? 0) : (a.jours ?? 0)) - (b.type.startsWith('document') || b.type.startsWith('contrat') ? -(b.jours ?? 0) : (b.jours ?? 0)) || a.contrat.localeCompare(b.contrat));
    const compte = (t: TypeSuivi) => lignes.filter(l => l.type === t).length;
    return {
        chiffres: {
            actifs: contracts.filter(c => c.status === 'Actif').length,
            aValider: compte('document_attente') + compte('contrat_attente'), refuses: compte('document_refuse') + compte('contrat_refuse'),
            preavis90: lignes.filter(l => l.type === 'preavis' && (l.jours ?? 999) <= 90).length,
            echeances180: compte('echeance'), depassees: compte('echeance_depassee'), sansPreavis,
        },
        lignes, calendrier,
    };
}
