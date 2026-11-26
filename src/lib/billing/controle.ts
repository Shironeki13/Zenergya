/**
 * Contrôle avant émission (facturation manuelle) : ce que la facture en préparation a d'inhabituel par rapport à ce
 * qui a déjà été facturé sur le contrat. Les alertes n'empêchent pas d'émettre : elles demandent un regard.
 *
 * - Prestation au forfait : le montant de l'échéance est comparé à celui de sa dernière facturation, montant contre
 *   montant pour deux périodes de même longueur, au rythme journalier sinon (prorata, autre périodicité). Une
 *   révision annuelle reste sous le seuil.
 * - P1 au compteur, au DJU ou en acompte : pas de comparaison (la saison fait varier les montants).
 * - Facture entière : comparée à la précédente du contrat.
 * Module sans dépendance serveur.
 */
import type { EcheanceDue } from './selection';

export type Gravite = 'forte' | 'attention' | 'info';
export type Alerte = { id: string; gravite: Gravite; texte: string };

/** Dernière facturation d'une prestation (clé : éléments triés joints par « + »). */
export type DerniereLigne = { montant: number; jours: number; fin: string; numero: string };
export type Precedent = {
    parCle: Record<string, DerniereLigne>;
    /** Dernière facture émise du contrat (hors proforma, hors annulée). */
    derniere: { numero: string; date: string; totalHT: number } | null;
    /** Nombre de factures émises sur le contrat. */
    nombre: number;
};

export const SEUILS = { attention: 0.2, forte: 0.5, factureForte: 1 } as const;

const jours = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
const eur = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ')} €`;
const pct = (r: number) => `${r > 0 ? '+' : '−'}${Math.abs(Math.round(r * 100))} %`;
export const cleDe = (cles: string[]) => [...cles].sort().join('+');
const saisonnier = (e: EcheanceDue) => e.lignes.some(l => l.p1Releve || l.p1Dju || l.p1Acompte || l.refacturation);

export function controlesEmission(dues: EcheanceDue[], selection: string[], precedent: Precedent, aujourdhui: string): Alerte[] {
    const retenues = dues.filter(e => selection.includes(e.id));
    if (retenues.length === 0) return [];
    const alertes: Alerte[] = [];

    // Prestation par prestation : écart du montant par jour avec la dernière facturation.
    const dejaVue = new Set<string>();
    for (const e of retenues) {
        const cle = cleDe(e.cles);
        const avant = precedent.parCle[cle];
        if (!avant || saisonnier(e) || dejaVue.has(cle) || avant.jours <= 0 || avant.montant === 0) continue;
        dejaVue.add(cle);
        const duree = jours(e.debut, e.fin);
        // Périodes de même longueur (deux trimestres, deux mois) : montant contre montant. Sinon (prorata, autre
        // périodicité) : au rythme journalier.
        const comparable = Math.abs(duree / avant.jours - 1) <= 0.05;
        const reference = comparable ? avant.montant : Math.round((avant.montant / avant.jours) * duree * 100) / 100;
        const ecart = e.montant / reference - 1;
        if (Math.abs(ecart) < SEUILS.attention) continue;
        alertes.push({
            id: `ecart:${e.id}`, gravite: Math.abs(ecart) >= SEUILS.forte ? 'forte' : 'attention',
            texte: `${e.activite} ${e.site} : ${eur(e.montant)} pour cette période, contre ${eur(reference)} ${comparable ? `sur la facture ${avant.numero}` : `au rythme de la facture ${avant.numero}`} (${pct(ecart)}). Vérifiez le montant de la prestation${e.revise ? ' et sa révision' : ''}.`,
        });
    }

    // Rattrapage : plusieurs échéances d'une même prestation sur la même facture.
    const parCle = new Map<string, EcheanceDue[]>();
    for (const e of retenues) parCle.set(cleDe(e.cles), [...(parCle.get(cleDe(e.cles)) ?? []), e]);
    const rattrapages = [...parCle.values()].filter(es => es.length > 1);
    if (rattrapages.length) {
        const max = Math.max(...rattrapages.map(es => es.length));
        const plusAncienne = rattrapages.flat().map(e => e.debut).sort()[0];
        alertes.push({
            id: 'rattrapage', gravite: max >= 3 ? 'attention' : 'info',
            texte: `Rattrapage : ${rattrapages.length} prestation${rattrapages.length > 1 ? 's' : ''} facturée${rattrapages.length > 1 ? 's' : ''} sur plusieurs échéances à la fois (jusqu'à ${max}), depuis le ${plusAncienne.split('-').reverse().join('/')}.`,
        });
    }

    // Facturation d'avance.
    const avance = retenues.filter(e => e.facturableLe > aujourdhui);
    if (avance.length) alertes.push({ id: 'avance', gravite: 'info', texte: `${avance.length} échéance${avance.length > 1 ? 's' : ''} facturée${avance.length > 1 ? 's' : ''} d'avance (pas encore exigible${avance.length > 1 ? 's' : ''}).` });

    // Facture entière, comparée à la précédente.
    const total = Math.round(retenues.reduce((a, e) => a + e.montant, 0) * 100) / 100;
    if (!precedent.derniere) {
        alertes.push({ id: 'premiere', gravite: 'info', texte: 'Première facture de ce contrat : aucune facture précédente à laquelle la comparer.' });
    } else if (precedent.derniere.totalHT > 0 && !retenues.some(saisonnier)) {
        const ecart = total / precedent.derniere.totalHT - 1;
        if (ecart >= SEUILS.factureForte || ecart <= -SEUILS.forte) {
            alertes.push({
                id: 'facture', gravite: alertes.some(a => a.id.startsWith('ecart:') || a.id === 'rattrapage') ? 'attention' : 'forte',
                texte: `Total de ${eur(total)} HT, contre ${eur(precedent.derniere.totalHT)} HT pour la facture précédente ${precedent.derniere.numero} (${pct(ecart)}).`,
            });
        }
    }
    const ordre: Record<Gravite, number> = { forte: 0, attention: 1, info: 2 };
    return alertes.sort((a, b) => ordre[a.gravite] - ordre[b.gravite]);
}

type FactureEmise = {
    invoiceNumber?: string; status?: string; cancelledByCreditNoteId?: string; date?: string; subtotal?: number;
    lineItems?: { itemKey?: string; itemKeys?: string[]; total?: number; periodStartDate?: string; periodEndDate?: string }[];
};

/** Ce qui a déjà été facturé sur le contrat, d'après ses factures émises (proformas et factures annulées écartés). */
export function precedentDe(factures: FactureEmise[]): Precedent {
    const emises = factures.filter(f => f.status !== 'proforma' && f.status !== 'cancelled' && !f.cancelledByCreditNoteId && f.invoiceNumber)
        .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) || String(a.invoiceNumber).localeCompare(String(b.invoiceNumber)));
    const parCle: Precedent['parCle'] = {};
    for (const f of emises) {
        // Lignes d'une même prestation et d'une même facture cumulées (échéance coupée par une révision).
        // Une même période n'est comptée qu'une fois : les quote-parts d'une ventilation de TVA en sont plusieurs lignes.
        const cumul = new Map<string, DerniereLigne>();
        const periodes = new Set<string>();
        for (const l of f.lineItems ?? []) {
            const cles = l.itemKeys?.length ? l.itemKeys : l.itemKey ? [l.itemKey] : [];
            const debut = String(l.periodStartDate ?? '').slice(0, 10), fin = String(l.periodEndDate ?? '').slice(0, 10);
            if (!cles.length || !debut || !fin) continue;
            const cle = cleDe(cles), c = cumul.get(cle);
            const nouvelle = !periodes.has(`${cle}|${debut}|${fin}`);
            periodes.add(`${cle}|${debut}|${fin}`);
            cumul.set(cle, { montant: (c?.montant ?? 0) + (l.total ?? 0), jours: (c?.jours ?? 0) + (nouvelle ? jours(debut, fin) : 0), fin: c && c.fin > fin ? c.fin : fin, numero: String(f.invoiceNumber) });
        }
        for (const [cle, c] of cumul) if (!parCle[cle] || parCle[cle].fin <= c.fin) parCle[cle] = c;
    }
    const d = emises.at(-1);
    return { parCle, derniere: d ? { numero: String(d.invoiceNumber), date: String(d.date ?? '').slice(0, 10), totalHT: d.subtotal ?? 0 } : null, nombre: emises.length };
}
