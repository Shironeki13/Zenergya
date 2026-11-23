import { roundCents, sumCents } from '@/lib/money';
import type { Invoice } from '@/lib/types';
import type { Progress, Project, ProjectSituation } from './types';

/**
 * Frise chronologique d'un chantier (logique pure) : les étapes de l'affaire dans l'ordre — ouverture, devis
 * complémentaires, situations (ou factures directes) avec leur facture et son règlement, réception, retenue de
 * garantie, clôture — puis ce qui reste à venir. Trois jauges la résument : avancement du chantier, facturé, encaissé.
 */

export type EtatEtape = 'fait' | 'en_cours' | 'alerte' | 'a_venir' | 'annule';
export type EtatFacture = 'payee' | 'a_payer' | 'en_retard' | 'annulee';
export const LIBELLE_ETAT_FACTURE: Record<EtatFacture, string> = { payee: 'Payée', a_payer: 'À payer', en_retard: 'En retard', annulee: 'Annulée (avoir)' };

export type LotAvancement = { cle: string; label: string; montant: number; pct: number; avant: number };

export type EtapeFrise = {
    id: string;
    type: 'ouverture' | 'devis' | 'situation' | 'facture' | 'preparation' | 'reception' | 'retenue' | 'cloture' | 'reste';
    /** Jour AAAA-MM-JJ ; null : à venir, sans date. */
    date: string | null;
    etat: EtatEtape;
    titre: string;
    resume?: string;
    /** Avancement cumulé du chantier après l'étape, en % du marché. */
    avancement?: number;
    montantHT?: number;
    montantTTC?: number;
    retenue?: number;
    netAPayer?: number;
    facture?: { id: string; numero: string; date: string; echeance: string; etat: EtatFacture };
    devis?: { id: string; numero: string };
    /** Avancement par lot après l'étape, et avant elle. */
    lots?: LotAvancement[];
};

export type FriseChantier = {
    etapes: EtapeFrise[];
    /** En % du marché HT. */
    jauges: { avancement: number; facture: number; encaisse: number };
    montants: { marche: number; facture: number; encaisse: number; resteAFacturer: number; aEncaisser: number };
    /** Avancement actuel par lot (situation en préparation comprise). */
    lots: LotAvancement[];
};

const jour = (d?: string | null) => (d ? String(d).slice(0, 10) : null);
const pct1 = (x: number) => Math.round(x * 10) / 10;

/** Avancement global en % du marché : avancement de chaque ligne pondéré par son montant HT. */
export function avancementGlobal(lines: Project['lines'], progress: Progress | undefined): number {
    const total = sumCents(lines.map(l => l.totalHT));
    if (!(total > 0) || !progress) return 0;
    return pct1(lines.reduce((s, l) => s + l.totalHT * Math.min(100, Math.max(0, progress[l.id] ?? 0)), 0) / total);
}

/** Avancement par lot : par titre du devis quand il y en a plusieurs, sinon ligne par ligne. */
export function avancementParLot(lines: Project['lines'], progress: Progress | undefined, avant?: Progress): LotAvancement[] {
    const sections = [...new Set(lines.map(l => l.section ?? ''))];
    const groupes = sections.length > 1 ? sections.map(s => ({ cle: `s:${s}`, label: s || 'Autres lignes', lignes: lines.filter(l => (l.section ?? '') === s) }))
        : lines.map(l => ({ cle: l.id, label: l.label, lignes: [l] }));
    return groupes.map(g => ({ cle: g.cle, label: g.label, montant: sumCents(g.lignes.map(l => l.totalHT)), pct: avancementGlobal(g.lignes, progress), avant: avancementGlobal(g.lignes, avant) }))
        .filter(g => g.montant > 0);
}

export function etatFacture(inv: Pick<Invoice, 'status' | 'dueDate' | 'cancelledByCreditNoteId'>, today: string): EtatFacture {
    if (inv.status === 'cancelled' || inv.cancelledByCreditNoteId) return 'annulee';
    if (inv.status === 'paid') return 'payee';
    return inv.status === 'overdue' || (jour(inv.dueDate) ?? '9999') < today ? 'en_retard' : 'a_payer';
}

export function friseChantier(project: Project, situations: ProjectSituation[], invoices: Invoice[], today: string): FriseChantier {
    const parSituations = (project.billing ?? 'situations') === 'situations';
    const etapes: EtapeFrise[] = [];
    const facturesDe = (inv: Invoice) => ({ id: inv.id, numero: inv.invoiceNumber ?? 'proforma', date: jour(inv.date)!, echeance: jour(inv.dueDate) ?? '', etat: etatFacture(inv, today) });
    const etatDe = (e: EtatFacture): EtatEtape => (e === 'payee' ? 'fait' : e === 'en_retard' ? 'alerte' : e === 'annulee' ? 'annule' : 'en_cours');

    // Ouverture et devis rattachés ensuite.
    const devis = project.quotes ?? [];
    etapes.push({
        id: 'ouverture', type: 'ouverture', date: jour(project.createdAt), etat: 'fait', titre: 'Affaire ouverte',
        resume: `Devis ${project.quoteNumber} accepté`, montantHT: devis[0]?.vente ?? project.totalHT, devis: { id: project.quoteId, numero: project.quoteNumber },
    });
    for (const d of devis.slice(1)) {
        etapes.push({ id: `devis:${d.quoteId}`, type: 'devis', date: jour(d.rattacheLe), etat: 'fait', titre: 'Devis complémentaire', resume: `${d.number} — ${d.title}`, montantHT: d.vente, devis: { id: d.quoteId, numero: d.number } });
    }

    // Situations facturées, dans l'ordre, chacune avec sa facture ; ou factures directes des devis.
    const comptees = invoices.filter(i => i.status !== 'proforma');
    let avant: Progress | undefined;
    if (parSituations) {
        for (const s of situations.filter(x => x.status === 'facturee').sort((a, b) => a.number - b.number)) {
            const inv = comptees.find(i => i.id === s.invoiceId);
            const f = inv ? facturesDe(inv) : undefined;
            const annulee = f?.etat === 'annulee';
            etapes.push({
                id: `situation:${s.id}`, type: 'situation', date: f?.date ?? jour(s.updatedAt), etat: f ? etatDe(f.etat) : 'en_cours',
                titre: `Situation n° ${s.number}`, resume: `${avancementGlobal(project.lines, s.progress).toLocaleString('fr-FR')} % du chantier`,
                avancement: avancementGlobal(project.lines, s.progress), montantHT: inv?.subtotal, montantTTC: inv?.total,
                retenue: inv?.situation?.retention.amount, netAPayer: inv?.situation?.netToPay, ...(f && { facture: f }),
                lots: avancementParLot(project.lines, s.progress, avant),
            });
            if (!annulee) avant = s.progress;
        }
    } else {
        for (const inv of [...comptees].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
            const f = facturesDe(inv);
            etapes.push({ id: `facture:${inv.id}`, type: 'facture', date: f.date, etat: etatDe(f.etat), titre: 'Facture', resume: inv.quote?.number ? `Devis ${inv.quote.number}` : undefined, montantHT: inv.subtotal, montantTTC: inv.total, facture: f });
        }
    }

    // Montants : facturé et encaissé hors factures annulées.
    const valides = comptees.filter(i => etatFacture(i, today) !== 'annulee' && (parSituations ? !!i.situation : true));
    const facture = sumCents(valides.map(i => i.subtotal));
    const encaisse = sumCents(valides.filter(i => i.status === 'paid').map(i => i.subtotal));
    const marche = project.totalHT;
    const part = (x: number) => (marche > 0 ? pct1(Math.min(100, (x / marche) * 100)) : 0);

    // Situation en préparation : l'avancement du chantier la prend en compte.
    const brouillon = parSituations ? situations.find(s => s.status === 'brouillon') : undefined;
    const actuel = brouillon?.progress ?? avant;
    if (brouillon) {
        etapes.push({
            id: `situation:${brouillon.id}`, type: 'preparation', date: jour(brouillon.updatedAt), etat: 'en_cours', titre: `Situation n° ${brouillon.number}`, resume: 'en préparation',
            avancement: avancementGlobal(project.lines, brouillon.progress), lots: avancementParLot(project.lines, brouillon.progress, avant),
        });
    }

    // Fin de chantier.
    if (project.completedAt) etapes.push({ id: 'reception', type: 'reception', date: jour(project.completedAt), etat: 'fait', titre: 'Travaux terminés', resume: 'réception' });
    if (project.retentionReleasedAt) etapes.push({ id: 'retenue', type: 'retenue', date: jour(project.retentionReleasedAt), etat: 'fait', titre: 'Retenue de garantie libérée' });
    if (project.closedAt) etapes.push({ id: 'cloture', type: 'cloture', date: jour(project.closedAt), etat: 'fait', titre: 'Affaire clôturée' });

    // Dans l'ordre des dates (l'ouverture d'abord), puis ce qui reste à venir.
    const ordre = (e: EtapeFrise) => (e.type === 'ouverture' ? '0000' : e.date ?? '9999');
    etapes.sort((a, b) => ordre(a).localeCompare(ordre(b)));
    const reste = roundCents(marche - facture);
    if (project.status !== 'cloture') {
        if (reste > 0.005) etapes.push({ id: 'reste', type: 'reste', date: null, etat: 'a_venir', titre: 'Reste à facturer', resume: `${part(reste).toLocaleString('fr-FR')} % du marché`, montantHT: reste });
        if (!project.completedAt) etapes.push({ id: 'reception', type: 'reception', date: null, etat: 'a_venir', titre: 'Réception des travaux' });
        const retenue = sumCents(valides.map(i => i.situation?.retention.amount ?? 0));
        if (parSituations && !project.retentionBond && !project.retentionReleasedAt && retenue > 0) etapes.push({ id: 'retenue', type: 'retenue', date: null, etat: 'a_venir', titre: 'Retenue de garantie à libérer', montantTTC: retenue });
    }

    return {
        etapes,
        jauges: { avancement: parSituations ? avancementGlobal(project.lines, actuel) : part(facture), facture: part(facture), encaisse: part(encaisse) },
        montants: { marche, facture, encaisse, resteAFacturer: reste, aEncaisser: roundCents(facture - encaisse) },
        lots: parSituations ? avancementParLot(project.lines, actuel, avant) : [],
    };
}
