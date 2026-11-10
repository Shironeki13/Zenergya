import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { STATUTS_ENGAGES, factureHT, type Commande, type StatutCommande } from '@/lib/commandes';
import { heuresPar, type SaisieHeures } from '@/lib/heures';
import { roundCents, sumCents } from '@/lib/money';
import { rentabilite, type Rentabilite } from '@/lib/projects/rentabilite';
import type { Project } from '@/lib/projects/types';

/**
 * Rentabilité des affaires de travaux : rapproche le budget des devis (prévu), les commandes affectées à l'affaire
 * (engagé, réel des factures fournisseurs), les heures saisies (main-d'œuvre) et les factures émises (facturé).
 */

type FactureAffaire = { projectId: string; status?: string; subtotal?: number; situation?: unknown };

/** Ventes HT facturées d'une affaire : factures de situation (par situations) ou factures de ses devis (directe), hors annulées et proformas. */
function facture(p: Pick<Project, 'billing'>, factures: FactureAffaire[]): number {
    const parSituations = (p.billing ?? 'situations') === 'situations';
    return sumCents(factures.filter(i => i.status !== 'cancelled' && i.status !== 'proforma' && (parSituations ? !!i.situation : true)).map(i => Number(i.subtotal ?? 0)));
}

const surAffaire = (c: Commande, projectId: string) => c.lines.filter(l => l.cible.type === 'affaire' && l.cible.projectId === projectId);

export type CommandeAffaire = { id: string; number?: string; date: string; supplierName: string; title: string; status: StatutCommande; montant: number; reel: number; engagee: boolean };
export type HeuresTechnicien = { userName: string; heures: number; cout: number; du: string; au: string };
export type RentabiliteAffaire = { projectId: string; rentabilite: Rentabilite; commandes: CommandeAffaire[]; heures: HeuresTechnicien[] };

function detail(p: Project, commandes: Commande[], heures: SaisieHeures[], factures: FactureAffaire[]): RentabiliteAffaire {
    const cmds = commandes.filter(c => surAffaire(c, p.id).length > 0);
    const hs = heures.filter(s => s.cible.type === 'affaire' && s.cible.projectId === p.id);
    const parTech = heuresPar(hs, s => s.userName);
    return {
        projectId: p.id,
        rentabilite: rentabilite({ projectId: p.id, budget: p.budget, vente: p.totalHT, commandes: cmds, heures: hs, facture: facture(p, factures.filter(f => f.projectId === p.id)) }),
        // Part de la commande affectée à l'affaire ; réel : factures du fournisseur, au prorata de cette part.
        commandes: cmds.filter(c => !['brouillon', 'annulee'].includes(c.status)).map(c => {
            const montant = sumCents(surAffaire(c, p.id).map(l => l.total));
            return { id: c.id, ...(c.number && { number: c.number }), date: c.date, supplierName: c.supplierName, title: c.title, status: c.status, montant, reel: c.totalHT ? roundCents(factureHT(c) * (montant / c.totalHT)) : 0, engagee: STATUTS_ENGAGES.includes(c.status) };
        }).sort((a, b) => a.date.localeCompare(b.date) || (a.number ?? '').localeCompare(b.number ?? '')),
        heures: [...parTech].map(([userName, t]) => {
            const jours = hs.filter(s => s.userName === userName).map(s => s.date).sort();
            return { userName, heures: t.heures, cout: t.cout, du: jours[0], au: jours[jours.length - 1] };
        }).sort((a, b) => b.heures - a.heures),
    };
}

const lire = async <T,>(q: FirebaseFirestore.Query) => (await q.get()).docs.map(d => ({ id: d.id, ...d.data() }) as T);

export async function rentabiliteAffaire(projectId: string): Promise<RentabiliteAffaire> {
    const d = await adminDb.collection('projects').doc(projectId).get();
    if (!d.exists) throw new Error('Affaire introuvable.');
    const [commandes, heures, factures] = await Promise.all([
        lire<Commande>(adminDb.collection('commandes')), lire<SaisieHeures>(adminDb.collection('heures')),
        lire<FactureAffaire>(adminDb.collection('invoices').where('projectId', '==', projectId)),
    ]);
    return detail({ id: d.id, ...d.data() } as Project, commandes, heures, factures);
}

/** Résumé par affaire, pour la liste : engagé, réel, facturé, marge prévue et à terminaison, alertes. */
export type ResumeRentabilite = Pick<Rentabilite, 'vente' | 'facture' | 'margePrevue' | 'tauxMargePrevue' | 'margeATerminaison' | 'tauxMargeATerminaison' | 'ecartMarge' | 'heuresPrevues' | 'heuresReelles'> & { prevu: number; engage: number; reel: number; enValidation: number; alertes: string[] };

export async function rentabiliteAffaires(): Promise<Record<string, ResumeRentabilite>> {
    const [projets, commandes, heures, factures] = await Promise.all([
        lire<Project>(adminDb.collection('projects')), lire<Commande>(adminDb.collection('commandes')), lire<SaisieHeures>(adminDb.collection('heures')),
        lire<FactureAffaire>(adminDb.collection('invoices').orderBy('projectId')),   // seules les factures d'affaire portent ce champ
    ]);
    return Object.fromEntries(projets.map(p => {
        const r = detail(p, commandes, heures, factures).rentabilite;
        const { vente, facture: f, margePrevue, tauxMargePrevue, margeATerminaison, tauxMargeATerminaison, ecartMarge, heuresPrevues, heuresReelles, alertes, total } = r;
        return [p.id, { vente, facture: f, margePrevue, tauxMargePrevue, margeATerminaison, tauxMargeATerminaison, ecartMarge, heuresPrevues, heuresReelles, alertes, prevu: total.prevu, engage: total.engage, reel: total.reel, enValidation: total.enValidation }];
    }));
}
