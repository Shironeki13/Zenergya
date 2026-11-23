import type { Amendment, BeChange, Contract, Renewal, Termination, TrusteeChange, ValidationDocument } from '@/lib/types';

/**
 * Vie d'un contrat (logique pure) : une frise chronologique de tout ce qui lui est arrivé et de ce qui l'attend —
 * dépôt et validation, début, chaque document (avenant, ordre de service, reconduction, résiliation, changement de
 * syndic ou de bureau d'études) avec l'état de sa validation, modifications faites par la contrathèque, puis les
 * échéances à venir : date limite de préavis, échéance, reconduction tacite.
 */

export type EtatVie = 'fait' | 'en_cours' | 'alerte' | 'a_venir' | 'annule';
export type TypeVie = 'depot' | 'validation' | 'debut' | 'avenant' | 'os' | 'reconduction' | 'resiliation' | 'syndic' | 'be' | 'modification' | 'aujourdhui' | 'preavis' | 'echeance' | 'fin';

export const LIBELLE_TYPE_VIE: Record<TypeVie, string> = {
    depot: 'Contrat déposé', validation: 'Contrat validé', debut: 'Début du contrat', avenant: 'Avenant', os: 'Ordre de service', reconduction: 'Reconduction',
    resiliation: 'Résiliation', syndic: 'Changement de syndic', be: 'Changement de bureau d\'études', modification: 'Modification', aujourdhui: 'Aujourd\'hui',
    preavis: 'Date limite de préavis', echeance: 'Échéance', fin: 'Fin du contrat',
};

export type Validation = { etat: 'en_attente' | 'valide' | 'refuse'; deposePar?: string; deposeLe?: string | null; validePar?: string; valideLe?: string | null; motifRefus?: string; corrections?: NonNullable<ValidationDocument['corrections']> };

export type EtapeVie = {
    id: string;
    type: TypeVie;
    /** Jour AAAA-MM-JJ. */
    date: string;
    etat: EtatVie;
    titre: string;
    resume?: string;
    /** Document déposé : état de sa validation. */
    validation?: Validation;
    /** Ce que l'étape change dans le contrat : libellé → valeur. */
    effets?: { libelle: string; valeur: string }[];
    /** Pièce justificative. */
    piece?: { url: string; nom?: string };
    /** Onglet des documents où retrouver l'étape. */
    onglet?: 'amendments' | 'terminations' | 'renewals' | 'trustee' | 'be';
    note?: string;
};

export type VieContrat = {
    etapes: EtapeVie[];
    /** Documents en attente de validation, et refusés. */
    enAttente: number;
    refuses: number;
    /** Part de la durée écoulée entre le début et l'échéance (0 à 100), si les deux dates sont connues. */
    ecoule: number | null;
    prochaine: EtapeVie | null;
};

const jour = (d?: string | null) => (d ? String(d).slice(0, 10) : null);
const frJour = (d: string) => d.split('-').reverse().join('/');
const eur = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €`;

/** « 3 mois », « 90 jours », « 1 an », « 6 » (mois) → durée ; null si le texte ne se lit pas. */
export function lireDuree(texte?: string | null): { mois: number; jours: number } | null {
    const t = (texte ?? '').trim().toLowerCase().replace(',', '.');
    if (!t) return null;
    const m = /^(\d+(?:\.\d+)?)\s*(an|ans|année|années|mois|m|jour|jours|j|semaine|semaines)?\b/.exec(t);
    if (!m) return null;
    const n = Number(m[1]);
    if (!(n > 0)) return null;
    const u = m[2] ?? 'mois';
    if (u.startsWith('an')) return { mois: Math.round(n * 12), jours: 0 };
    if (u === 'mois' || u === 'm') return { mois: Math.round(n), jours: 0 };
    return { mois: 0, jours: Math.round(n * (u.startsWith('semaine') ? 7 : 1)) };
}

/** Jour décalé d'une durée (négative : avant) ; fin de mois respectée (31/05 − 3 mois = 28/02). */
export function decaler(day: string, d: { mois: number; jours: number }, sens: 1 | -1): string {
    const [y, m, j] = day.split('-').map(Number);
    const cible = new Date(Date.UTC(y, m - 1 + sens * d.mois, 1));
    const dernier = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
    cible.setUTCDate(Math.min(j, dernier) + sens * d.jours);
    return cible.toISOString().slice(0, 10);
}

const validationDe = (d: ValidationDocument & { createdAt?: string; createdBy?: string }): Validation => ({
    etat: d.validationStatus === 'refused' ? 'refuse' : d.validationStatus === 'pending_validation' ? 'en_attente' : 'valide',
    ...(d.createdBy && { deposePar: d.createdBy }), deposeLe: jour(d.createdAt), ...(d.validatedBy && { validePar: d.validatedBy }), valideLe: jour(d.validatedAt),
    ...(d.refusalReason && { motifRefus: d.refusalReason }), ...(d.corrections?.length && { corrections: d.corrections }),
});
const etatDe = (v: Validation): EtatVie => (v.etat === 'valide' ? 'fait' : v.etat === 'refuse' ? 'annule' : 'en_cours');
const piece = (d: { documentUrl?: string; documentName?: string }) => (d.documentUrl ? { piece: { url: d.documentUrl, ...(d.documentName && { nom: d.documentName }) } } : {});

export type DocumentsContrat = { amendments: Amendment[]; terminations: Termination[]; renewals: Renewal[]; trusteeChanges: TrusteeChange[]; beChanges: BeChange[] };

export function vieContrat(contract: Contract, docs: DocumentsContrat, today: string): VieContrat {
    const etapes: EtapeVie[] = [];
    const debut = jour(contract.startDate), fin = jour(contract.endDate);

    // Dépôt et validation du contrat.
    const depose = jour(contract.createdAt);
    // Contrat enregistré après son début (reprise d'un contrat existant) : ce n'est pas un dépôt initial.
    const repris = !!depose && !!debut && depose > debut;
    if (depose) etapes.push({ id: 'depot', type: 'depot', date: depose, etat: 'fait', titre: repris ? 'Repris dans Zenergya' : 'Contrat déposé', ...(contract.createdBy || contract.requesterEmail ? { resume: `par ${contract.createdBy ?? contract.requesterEmail}` } : {}) });
    if (contract.validationStatus === 'validated' && jour(contract.validatedAt)) {
        etapes.push({ id: 'validation', type: 'validation', date: jour(contract.validatedAt)!, etat: 'fait', titre: 'Contrat validé', ...(contract.validatedBy && { resume: `par ${contract.validatedBy}` }) });
    } else if (contract.validationStatus === 'refused') {
        etapes.push({ id: 'validation', type: 'validation', date: depose ?? today, etat: 'alerte', titre: 'Contrat refusé', ...(contract.refusalReason && { resume: contract.refusalReason }) });
    } else if (contract.validationStatus === 'pending_validation') {
        etapes.push({ id: 'validation', type: 'validation', date: depose ?? today, etat: 'en_cours', titre: 'En attente de validation', resume: 'par la contrathèque' });
    }
    if (debut) etapes.push({ id: 'debut', type: 'debut', date: debut, etat: debut <= today ? 'fait' : 'a_venir', titre: 'Début du contrat' });

    // Documents : à leur date d'effet (à défaut, de dépôt).
    for (const a of docs.amendments) {
        const v = validationDe(a);
        const os = a.nature === 'os';
        const effets = [
            ...(a.impactsDuration && a.newEndDate ? [{ libelle: 'Nouvelle échéance', valeur: frJour(jour(a.newEndDate)!) }] : []),
            ...([['P1', a.impactP1], ['P2', a.impactP2], ['P3', a.impactP3], ['P3R', a.impactP3R]] as const).filter(([, x]) => !!x).map(([k, x]) => ({ libelle: `Montant ${k}`, valeur: `${eur(x!)} HT/an` })),
            { libelle: 'Signé', valeur: a.signed ? 'Oui' : 'Non' },
        ];
        etapes.push({ id: `avenant:${a.id}`, type: os ? 'os' : 'avenant', date: jour(a.effectiveDate) ?? jour(a.createdAt) ?? today, etat: etatDe(v), titre: os ? 'Ordre de service' : 'Avenant', ...(a.description && { resume: a.description }), validation: v, effets, ...piece(a), onglet: 'amendments' });
    }
    for (const r of docs.renewals) {
        const v = validationDe(r);
        etapes.push({ id: `reconduction:${r.id}`, type: 'reconduction', date: jour(r.createdAt) ?? today, etat: etatDe(v), titre: 'Reconduction', ...(r.duration && { resume: r.duration }), validation: v, effets: [...(r.newEndDate ? [{ libelle: 'Nouvelle échéance', valeur: frJour(jour(r.newEndDate)!) }] : []), ...(r.duration ? [{ libelle: 'Durée', valeur: r.duration }] : [])], ...piece(r), onglet: 'renewals' });
    }
    for (const t of docs.terminations) {
        const v = validationDe(t);
        etapes.push({ id: `resiliation:${t.id}`, type: 'resiliation', date: jour(t.effectiveDate) ?? jour(t.createdAt) ?? today, etat: v.etat === 'valide' ? (jour(t.effectiveDate)! <= today ? 'fait' : 'a_venir') : etatDe(v), titre: 'Résiliation', ...(t.reason && { resume: t.reason }), validation: v, effets: [{ libelle: 'Date d\'effet', valeur: frJour(jour(t.effectiveDate)!) }, ...(t.reason ? [{ libelle: 'Motif', valeur: t.reason }] : [])], ...piece(t), onglet: 'terminations' });
    }
    for (const c of docs.trusteeChanges) {
        const v = validationDe(c);
        etapes.push({ id: `syndic:${c.id}`, type: 'syndic', date: jour(c.effectiveDate) ?? jour(c.createdAt) ?? today, etat: etatDe(v), titre: 'Changement de syndic', resume: c.newRepresentative, validation: v, effets: [...(c.currentRepresentative ? [{ libelle: 'Ancien syndic', valeur: c.currentRepresentative }] : []), { libelle: 'Nouveau syndic', valeur: c.newRepresentative }, ...(c.contactEmail ? [{ libelle: 'Contact', valeur: c.contactEmail }] : [])], ...piece(c), onglet: 'trustee' });
    }
    for (const c of docs.beChanges) {
        const v = validationDe(c);
        etapes.push({ id: `be:${c.id}`, type: 'be', date: jour(c.effectiveDate) ?? jour(c.createdAt) ?? today, etat: etatDe(v), titre: 'Changement de bureau d\'études', resume: c.newBe, validation: v, effets: [...(c.currentBe ? [{ libelle: 'Ancien bureau d\'études', valeur: c.currentBe }] : []), { libelle: 'Nouveau bureau d\'études', valeur: c.newBe }, ...(c.contactEmail ? [{ libelle: 'Contact', valeur: c.contactEmail }] : [])], ...piece(c), onglet: 'be' });
    }

    // Modifications du contrat validé par la contrathèque, changements de statut faits à la main.
    (contract.modificationsValidees ?? []).forEach((m, i) => {
        const effets = [
            ...(m.statut ? [{ libelle: 'Statut', valeur: `${m.statut.avant} → ${m.statut.apres}` }] : []),
            ...Object.values(m.champs ?? {}).map(c => ({ libelle: c.libelle, valeur: `${c.avant ?? '—'} → ${c.apres ?? '—'}` })),
        ];
        etapes.push({ id: `modification:${i}`, type: 'modification', date: jour(m.le) ?? today, etat: 'fait', titre: m.statut ? 'Changement de statut' : 'Modification', resume: `par ${m.par}`, effets });
    });

    // Fin : résiliation effective, ou échéance à venir avec son préavis et sa reconduction.
    const resilie = contract.status === 'Résilié' || contract.status === 'Terminé';
    const finEffective = jour(contract.terminationDate);
    if (resilie && finEffective && !docs.terminations.some(t => t.validationStatus !== 'refused' && jour(t.effectiveDate) === finEffective)) {
        etapes.push({ id: 'fin', type: 'fin', date: finEffective, etat: finEffective <= today ? 'fait' : 'a_venir', titre: contract.status === 'Résilié' ? 'Résiliation effective' : 'Fin du contrat' });
    }
    if (fin && !resilie) {
        const preavis = lireDuree(contract.noticePeriod);
        const tacite = contract.renewal && contract.tacitRenewal;
        if (preavis) {
            const limite = decaler(fin, preavis, -1);
            const passe = limite < today;
            const proche = !passe && limite <= decaler(today, { mois: 0, jours: 60 }, 1);
            etapes.push({
                id: 'preavis', type: 'preavis', date: limite, etat: passe ? 'fait' : proche ? 'alerte' : 'a_venir', titre: 'Date limite de préavis',
                resume: `${contract.noticePeriod} avant l'échéance`,
                note: passe ? (tacite ? 'Préavis dépassé : sans dénonciation reçue, la reconduction tacite est acquise.' : 'Préavis dépassé.') : `Dernier jour pour dénoncer le contrat avant son échéance du ${frJour(fin)}.`,
            });
        }
        etapes.push({
            id: 'echeance', type: 'echeance', date: fin, etat: fin < today ? 'alerte' : 'a_venir', titre: 'Échéance',
            resume: tacite ? `reconduction tacite${contract.renewalDuration ? ` de ${contract.renewalDuration}` : ''}` : contract.renewal ? 'reconduction possible' : 'sans reconduction',
            note: fin < today ? 'Échéance dépassée : contrat à reconduire (document de reconduction) ou à terminer.'
                : !preavis && contract.noticePeriod ? `Préavis « ${contract.noticePeriod} » : durée non reconnue, la date limite n'est pas calculée (écrire par exemple « 3 mois »).`
                : !preavis ? 'Préavis non renseigné sur le contrat : la date limite de dénonciation n\'est pas calculée.' : undefined,
        });
    }

    // Ordre chronologique ; à date égale : dépôt, validation, début, puis le reste.
    const rang: Partial<Record<TypeVie, number>> = { depot: 0, validation: 1, debut: 2, preavis: 8, echeance: 9, fin: 9 };
    etapes.sort((a, b) => a.date.localeCompare(b.date) || (rang[a.type] ?? 5) - (rang[b.type] ?? 5));
    // Repère « aujourd'hui », avant la première étape à venir.
    const i = etapes.findIndex(e => e.date > today);
    const repere: EtapeVie = { id: 'aujourdhui', type: 'aujourdhui', date: today, etat: 'en_cours', titre: 'Aujourd\'hui' };
    if (i === -1) etapes.push(repere); else etapes.splice(i, 0, repere);

    const documents = etapes.filter(e => e.validation);
    const ecoule = debut && fin && fin > debut ? Math.round(Math.min(100, Math.max(0, ((Date.parse(today) - Date.parse(debut)) / (Date.parse(fin) - Date.parse(debut))) * 100)) * 10) / 10 : null;
    return {
        etapes, enAttente: documents.filter(e => e.validation!.etat === 'en_attente').length + (contract.validationStatus === 'pending_validation' ? 1 : 0),
        refuses: documents.filter(e => e.validation!.etat === 'refuse').length, ecoule,
        prochaine: etapes.find(e => e.date > today && e.type !== 'aujourdhui') ?? null,
    };
}
