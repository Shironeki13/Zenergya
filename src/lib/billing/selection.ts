/**
 * Facturation manuelle : échéances dues d'un contrat présentées une à une, à cocher avant l'émission.
 *
 * Une « échéance due » regroupe les lignes de facture d'une même échéance (coupée par une révision : plusieurs
 * lignes ; facturation globale : une ligne pour plusieurs sites). Les échéances d'un même élément se facturent dans
 * l'ordre : on ne peut pas en retenir une en laissant de côté une plus ancienne (le facturé resterait troué).
 * Module sans dépendance serveur.
 */
import type { InvoiceLineItem } from '@/lib/types';
import { lineItemKeys, type DueResult, type Echeance, type NatureBlocage } from './contract-billing';

export type EcheanceDue = {
    id: string;
    /** Éléments facturables couverts (ordre de facturation). */
    cles: string[];
    activite: string;
    libelle: string;
    /** Site, ou nombre de sites en facturation globale. */
    site: string;
    debut: string;
    fin: string;
    facturableLe: string;
    montant: number;
    revise: boolean;
    prorata: boolean;
    lignes: InvoiceLineItem[];
    /** Échéance non facturable en l'état : motif, nature et site concerné (pour le lien de correction). */
    blocage?: { message: string; nature: NatureBlocage; siteId: string };
};

const dans = (l: InvoiceLineItem, e: Echeance) =>
    lineItemKeys(l).includes(e.item.key) && String(l.periodStartDate) >= e.start && String(l.periodEndDate) <= e.end;

/**
 * Échéances dues, de la plus ancienne à la plus récente. Une échéance bloquée (donnée manquante) est listée sans
 * ligne ni montant : elle ne peut pas être cochée, ni les suivantes de la même prestation. Les échéances de montant
 * nul sont omises.
 */
export function echeancesDues(due: Pick<DueResult, 'echeances' | 'lines' | 'bloquees'>): EcheanceDue[] {
    const bloquee = (e: Echeance) => (due.bloquees ?? []).find(b => b.key === e.item.key && b.start === e.start);
    // Composantes : échéances reliées par une ligne commune (facturation globale).
    const groupe = due.echeances.map((_, i) => i);
    const racine = (i: number): number => (groupe[i] === i ? i : (groupe[i] = racine(groupe[i])));
    const lignesDe = due.echeances.map(e => due.lines.filter(l => dans(l, e)));
    const premier = new Map<InvoiceLineItem, number>();
    lignesDe.forEach((ls, i) => ls.forEach(l => {
        const j = premier.get(l);
        if (j === undefined) premier.set(l, i); else groupe[racine(i)] = racine(j);
    }));
    const parRacine = new Map<number, number[]>();
    due.echeances.forEach((e, i) => { if (lignesDe[i].length || bloquee(e)) parRacine.set(racine(i), [...(parRacine.get(racine(i)) ?? []), i]); });

    const out: EcheanceDue[] = [];
    for (const membres of parRacine.values()) {
        const es = membres.map(i => due.echeances[i]);
        const motif = es.map(x => ({ x, b: bloquee(x) })).find(m => m.b);
        // Bloquée : rien n'est facturé pour l'échéance, même si une partie a pu être calculée.
        const lignes = motif ? [] : [...new Set(membres.flatMap(i => lignesDe[i]))];
        const e = es[0];
        const sites = [...new Set(es.map(x => x.item.site.name))];
        const debut = es.map(x => x.start).sort()[0];
        const fin = es.map(x => x.end).sort().at(-1)!;
        out.push({
            id: `${es.map(x => x.item.key).sort().join('+')}|${debut}`,
            cles: es.map(x => x.item.key),
            activite: e.item.activity.code,
            libelle: [e.item.activity.label, es.length === 1 ? e.item.label : undefined].filter(Boolean).join(' — '),
            site: sites.length === 1 ? sites[0] : `${sites.length} sites`,
            debut, fin,
            facturableLe: es.map(x => x.billableOn).sort().at(-1)!,
            montant: Math.round(lignes.reduce((a, l) => a + l.total, 0) * 100) / 100,
            revise: lignes.some(l => !!l.revision),
            prorata: es.some(x => x.days < x.nominalDays && !x.item.p1Acompte && !x.item.p1Releve && !x.item.p1Dju),
            lignes,
            ...(motif && { blocage: { message: motif.b!.message, nature: motif.b!.nature, siteId: motif.x.item.site.id } }),
        });
    }
    return out.sort((a, b) => a.debut.localeCompare(b.debut) || a.site.localeCompare(b.site, 'fr') || a.activite.localeCompare(b.activite));
}

type Ordre = Pick<EcheanceDue, 'id' | 'cles' | 'debut'> & { blocage?: unknown };
const partage = (a: Ordre, b: Ordre) => a.cles.some(k => b.cles.includes(k));

/** Une échéance peut être cochée si ni elle ni aucune échéance plus ancienne qu'elle entraînerait n'est bloquée. */
export function cochable(echeances: Ordre[], cible: Ordre): boolean {
    const vus = new Set<string>();
    const file = [cible];
    while (file.length) {
        const c = file.pop()!;
        if (vus.has(c.id)) continue;
        vus.add(c.id);
        if (c.blocage) return false;
        for (const e of echeances) if (e.debut < c.debut && partage(e, c)) file.push(e);
    }
    return true;
}

/**
 * Coche ou décoche une échéance en gardant l'ordre : cocher entraîne les échéances plus anciennes du même élément,
 * décocher entraîne les plus récentes.
 */
export function basculer(echeances: Ordre[], selection: string[], id: string, coche: boolean): string[] {
    const cible = echeances.find(e => e.id === id);
    if (!cible) return selection;
    // Bloquée, ou précédée d'une échéance bloquée de la même prestation : ne peut pas être cochée.
    if (coche && !cochable(echeances, cible)) return selection;
    const s = new Set(selection);
    // Propagation de proche en proche (une échéance globale relie plusieurs éléments).
    const file = [cible];
    while (file.length) {
        const c = file.pop()!;
        if (coche ? s.has(c.id) && c !== cible : !s.has(c.id) && c !== cible) continue;
        if (coche) s.add(c.id); else s.delete(c.id);
        for (const e of echeances) {
            if (e.id === c.id || !partage(e, c)) continue;
            if (coche ? e.debut < c.debut && !s.has(e.id) : e.debut > c.debut && s.has(e.id)) file.push(e);
        }
    }
    return echeances.filter(e => s.has(e.id)).map(e => e.id);
}

/** Anomalies d'une sélection : vide, inconnue (l'aperçu a changé) ou trouée. Aucune : sélection facturable. */
export function controleSelection(echeances: Ordre[], selection: string[]): string[] {
    if (selection.length === 0) return ['Aucune échéance sélectionnée.'];
    const connus = new Set(echeances.map(e => e.id));
    if (selection.some(id => !connus.has(id))) return ["Les échéances dues ont changé depuis l'aperçu : rechargez la page."];
    const s = new Set(selection);
    if (echeances.some(e => s.has(e.id) && e.blocage)) return ["Une échéance bloquée ne peut pas être facturée."];
    const trou = echeances.some(e => s.has(e.id) && echeances.some(a => !s.has(a.id) && a.debut < e.debut && partage(a, e)));
    return trou ? ["Une échéance ne peut pas être facturée avant une échéance plus ancienne de la même prestation."] : [];
}

/** Lignes de facture des échéances retenues. */
export function lignesRetenues(echeances: Pick<EcheanceDue, 'id' | 'lignes'>[], selection: string[]): InvoiceLineItem[] {
    const s = new Set(selection);
    return [...new Set(echeances.filter(e => s.has(e.id)).flatMap(e => e.lignes))];
}

/** Où corriger un blocage : l'écran à ouvrir et le libellé du lien. */
export function lienBlocage(b: NonNullable<EcheanceDue['blocage']>, contractId: string): { href: string; libelle: string } {
    switch (b.nature) {
        case 'tva': return { href: `/sites/${b.siteId}`, libelle: 'Renseigner la TVA de la prestation' };
        case 'releve': return { href: '/meters', libelle: 'Saisir le relevé' };
        case 'dju': return { href: '/settings', libelle: 'Compléter les DJU (Paramétrage › Stations météo)' };
        case 'acompte': return { href: `/sites/${b.siteId}`, libelle: 'Compléter le paramétrage P1 du site' };
        case 'revision': return { href: '/billing/indices', libelle: "Saisir l'indice manquant" };
        case 'global': return { href: `/contracts/${contractId}`, libelle: 'Ouvrir le contrat (passer en multi-site)' };
    }
}
