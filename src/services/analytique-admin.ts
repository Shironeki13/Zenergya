import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import {
    analytiqueEffective, controleCodeExterne, segment, type AnalytiqueEffective, type AnalytiqueLigne, type NiveauAnalytique, type SegmentsAnalytiques,
} from '@/lib/analytique';
import { Timestamp } from 'firebase-admin/firestore';
import type { InvoiceLineItem } from '@/lib/types';
import { segmentAffaire } from '@/lib/projects/affaire';
import { STATUTS_ENGAGES } from '@/lib/commandes';

/**
 * Analytique au serveur : code effectif du client, du contrat et de ses prestations (généré ou externe), figeage des
 * codes générés, code externe, réaffectation explicite, et pose de l'analytique sur les lignes de facture.
 */

type Doc = FirebaseFirestore.DocumentSnapshot;
const codeDe = async (coll: string, id: unknown): Promise<string | null> => {
    if (!id) return null;
    const d = await adminDb.collection(coll).doc(String(id)).get();
    return d.exists ? (d.get('code') as string | undefined) ?? null : null;
};

export type AnalytiquePrestation = { serviceId: string; siteId: string; activityCode: string; activityLabel: string; analytique: AnalytiqueEffective };
export type AnalytiqueContrat = {
    clientId: string; contractId: string;
    segments: SegmentsAnalytiques;
    axes: AnalytiqueLigne['axes'];
    client: AnalytiqueEffective;
    contrat: AnalytiqueEffective;
    prestations: AnalytiquePrestation[];
    historique: { code: string; jusquAu: string; motif: string; par: string }[];
};

async function segmentsClient(client: Doc, companyId?: string | null) {
    const societeId = companyId || client.get('companyId');
    const [societe, agence, secteur] = await Promise.all([codeDe('companies', societeId), codeDe('agencies', client.get('agencyId')), codeDe('sectors', client.get('sectorId'))]);
    return {
        segments: { societe, agence, secteur, client: (client.get('externalCode') as string | undefined) ?? null } as SegmentsAnalytiques,
        ids: { companyId: societeId as string | undefined, agencyId: client.get('agencyId') as string | undefined, sectorId: client.get('sectorId') as string | undefined, clientId: client.id },
    };
}

/** Analytique du client seul (société du client). */
export async function analytiqueClient(clientId: string): Promise<{ analytique: AnalytiqueEffective; segments: SegmentsAnalytiques }> {
    const client = await adminDb.collection('clients').doc(clientId).get();
    if (!client.exists) throw new Error('Client introuvable.');
    const { segments } = await segmentsClient(client);
    return { analytique: analytiqueEffective('client', { analyticCode: client.get('analyticCode'), analyticExternal: client.get('analyticExternal') }, segments), segments };
}

/** Analytique d'un contrat : client, contrat (société émettrice du contrat, sinon celle du client) et prestations. */
export async function analytiqueContrat(contractId: string): Promise<AnalytiqueContrat> {
    const contract = await adminDb.collection('contracts').doc(contractId).get();
    if (!contract.exists) throw new Error('Contrat introuvable.');
    const client = await adminDb.collection('clients').doc(String(contract.get('clientId'))).get();
    if (!client.exists) throw new Error('Client du contrat introuvable.');
    const [{ segments: sClient }, { segments: base, ids }, services, activities] = await Promise.all([
        segmentsClient(client), segmentsClient(client, contract.get('companyId')),
        adminDb.collection('services').where('contractId', '==', contractId).get(), adminDb.collection('activities').get(),
    ]);
    const activite = new Map(activities.docs.map(a => [a.id, { code: String(a.get('code') ?? ''), label: String(a.get('label') ?? '') }]));
    const niveau = (d: Doc) => ({ analyticCode: d.get('analyticCode') as string | null | undefined, analyticExternal: d.get('analyticExternal') as string | null | undefined });
    const eClient = analytiqueEffective('client', niveau(client), sClient);
    const sContrat = { ...base, contrat: (contract.get('contractNumber') as string | undefined) ?? null };
    const eContrat = analytiqueEffective('contrat', niveau(contract), sContrat, eClient);
    // Axes : figés avec le code du contrat (un changement de secteur ne déplace pas les ventes d'un contrat non réaffecté).
    const calcules: AnalytiqueLigne['axes'] = {
        ...Object.fromEntries(Object.entries({ societe: base.societe, agence: base.agence, secteur: base.secteur, client: base.client, contrat: sContrat.contrat }).filter(([, v]) => v).map(([k, v]) => [k, segment(v)])),
        ...Object.fromEntries(Object.entries(ids).filter(([, v]) => v)), contractId,
    };
    const figes = contract.get('analyticCode') ? contract.get('analyticAxes') as AnalytiqueLigne['axes'] | undefined : undefined;
    return {
        clientId: client.id, contractId, segments: sContrat,
        axes: figes ?? calcules,
        client: eClient, contrat: eContrat,
        prestations: services.docs.filter(d => d.get('isActive') !== false).map(d => {
            const a = activite.get(String(d.get('activityId'))) ?? { code: '', label: '' };
            return { serviceId: d.id, siteId: String(d.get('siteId') ?? ''), activityCode: a.code, activityLabel: a.label, analytique: analytiqueEffective('prestation', niveau(d), { ...sContrat, activite: a.code }, eContrat) };
        }).sort((x, y) => x.siteId.localeCompare(y.siteId) || x.activityCode.localeCompare(y.activityCode)),
        historique: (contract.get('analyticHistory') as AnalytiqueContrat['historique'] | undefined) ?? [],
    };
}

/**
 * Fige les codes générés manquants du client, du contrat et de ses prestations (ne remplace jamais un code figé).
 * Appelé à l'émission d'une facture : les ventes déjà facturées gardent leur code.
 */
export async function figerAnalytique(contractId: string): Promise<AnalytiqueContrat> {
    const a = await analytiqueContrat(contractId);
    const batch = adminDb.batch();
    let n = 0;
    const figer = (ref: FirebaseFirestore.DocumentReference, e: AnalytiqueEffective) => { if (!e.fige && e.genere) { batch.update(ref, { analyticCode: e.genere }); e.fige = true; n++; } };
    figer(adminDb.collection('clients').doc(a.clientId), a.client);
    if (!a.contrat.fige && a.contrat.genere) batch.update(adminDb.collection('contracts').doc(contractId), { analyticAxes: a.axes });
    figer(adminDb.collection('contracts').doc(contractId), a.contrat);
    for (const p of a.prestations) figer(adminDb.collection('services').doc(p.serviceId), p.analytique);
    if (n) await batch.commit();
    return a;
}

/** Analytique d'une ligne du contrat : sa prestation, sinon le contrat complété de l'activité de la ligne. */
export function analytiqueDeLigne(a: AnalytiqueContrat, line: Pick<InvoiceLineItem, 'serviceId' | 'siteId' | 'activityCode'>): AnalytiqueLigne | null {
    const p = (line.serviceId && a.prestations.find(x => x.serviceId === line.serviceId))
        || (line.siteId && line.activityCode && a.prestations.find(x => x.siteId === line.siteId && x.activityCode === line.activityCode))
        || null;
    const e = p ? p.analytique : line.activityCode
        ? analytiqueEffective('prestation', {}, { ...a.segments, activite: line.activityCode }, a.contrat)
        : a.contrat;
    if (!e.code) return null;
    const activite = segment(p?.activityCode ?? line.activityCode);
    return {
        code: e.code, ...(e.genere && { genere: e.genere }), ...(e.externe && { externe: e.externe }),
        axes: { ...a.axes, ...(activite && { activite }), ...(line.siteId && { siteId: line.siteId }) },
    };
}

/** Pose l'analytique sur les lignes d'un document du contrat (les lignes qui en portent déjà une sont gardées). */
export function avecAnalytique<T extends InvoiceLineItem>(a: AnalytiqueContrat, lines: T[]): T[] {
    return lines.map(l => {
        if (l.analytique) return l;
        const x = analytiqueDeLigne(a, l);
        return x ? { ...l, analytique: x } : l;
    });
}

// --- Travaux : analytique d'une affaire ---

export type AffaireAnalytique = {
    id: string; code: string; clientId: string; companyId: string; agencyId?: string; sectorId?: string; contractId?: string; siteId?: string; mode?: 'P5' | 'P6';
    analyticCode?: string | null; analyticAxes?: AnalytiqueLigne['axes']; analyticExternal?: string | null;
};

/**
 * Analytique d'une affaire de travaux : code du client (société, agence et secteur de l'affaire, sinon du client) +
 * affaire ; figée à la création de l'affaire (`analyticCode`, `analyticAxes`) ; code externe prioritaire.
 */
export async function analytiqueAffaire(p: AffaireAnalytique): Promise<{ effective: AnalytiqueEffective; axes: AnalytiqueLigne['axes'] }> {
    if (p.analyticCode && p.analyticAxes) {
        const externe = p.analyticExternal?.trim() || null;
        return { effective: { code: externe ?? p.analyticCode, origine: externe ? 'externe' : 'genere', genere: p.analyticCode, externe, fige: true, manque: [] }, axes: p.analyticAxes };
    }
    const client = await adminDb.collection('clients').doc(p.clientId).get();
    if (!client.exists) throw new Error('Client de l\'affaire introuvable.');
    const agencyId = p.agencyId || (client.get('agencyId') as string | undefined), sectorId = p.sectorId || (client.get('sectorId') as string | undefined);
    const [societe, agence, secteur, contrat] = await Promise.all([
        codeDe('companies', p.companyId), codeDe('agencies', agencyId), codeDe('sectors', sectorId),
        p.contractId ? adminDb.collection('contracts').doc(p.contractId).get().then(d => (d.get('contractNumber') as string | undefined) ?? null) : null,
    ]);
    const segments: SegmentsAnalytiques = { societe, agence, secteur, client: (client.get('externalCode') as string | undefined) ?? null };
    const base = analytiqueEffective('client', {}, segments);
    const affaire = segmentAffaire(p.code);
    const genere = base.genere ? `${base.genere}-${affaire}` : null;
    const externe = p.analyticExternal?.trim() || null;
    const axes: AnalytiqueLigne['axes'] = {
        ...Object.fromEntries(Object.entries({ societe, agence, secteur, client: segments.client, contratLie: contrat }).filter(([, v]) => v).map(([k, v]) => [k, segment(v)])),
        affaire, ...(p.mode && { activite: p.mode }),
        ...Object.fromEntries(Object.entries({ companyId: p.companyId, agencyId, sectorId, clientId: p.clientId, contractId: p.contractId, siteId: p.siteId }).filter(([, v]) => v)),
        projectId: p.id,
    };
    return { effective: { code: externe ?? genere, origine: externe ? 'externe' : genere ? 'genere' : 'aucun', genere, externe, fige: false, manque: base.manque }, axes };
}

/** Analytique à poser sur les lignes de facture d'une affaire ; null si elle n'a ni code générable ni code externe. */
export async function analytiqueLigneAffaire(p: AffaireAnalytique): Promise<AnalytiqueLigne | null> {
    const { effective: e, axes } = await analytiqueAffaire(p);
    return e.code ? { code: e.code, ...(e.genere && { genere: e.genere }), ...(e.externe && { externe: e.externe }), axes } : null;
}

const COLLECTION: Record<NiveauAnalytique, string> = { client: 'clients', contrat: 'contracts', prestation: 'services' };

/** Enregistre (ou retire, si vide) le code externe d'un client, d'un contrat ou d'une prestation. */
export async function setAnalytiqueExterne(niveau: NiveauAnalytique, id: string, valeur: string, by: string): Promise<void> {
    const erreur = controleCodeExterne(valeur);
    if (erreur) throw new Error(`Code externe : ${erreur}`);
    const ref = adminDb.collection(COLLECTION[niveau]).doc(id);
    if (!(await ref.get()).exists) throw new Error('Élément introuvable.');
    await ref.update({ analyticExternal: valeur.trim() || FieldValue.delete(), analyticExternalBy: by, analyticExternalAt: new Date().toISOString() });
}

/**
 * Réaffectation : régénère le code du contrat et de ses prestations à partir du référentiel actuel (changement
 * d'agence, de secteur, de société). L'ancien code reste dans l'historique du contrat ; les factures déjà émises
 * gardent le leur. Avec `client`, le code du client est régénéré aussi.
 */
export async function reaffecterAnalytique(contractId: string, motif: string, by: string, opts: { client?: boolean } = {}): Promise<AnalytiqueContrat> {
    if (!motif.trim()) throw new Error('Motif de la réaffectation obligatoire.');
    const avant = await analytiqueContrat(contractId);
    const batch = adminDb.batch();
    if (opts.client) batch.update(adminDb.collection('clients').doc(avant.clientId), { analyticCode: FieldValue.delete() });
    batch.update(adminDb.collection('contracts').doc(contractId), {
        analyticCode: FieldValue.delete(), analyticAxes: FieldValue.delete(),
        ...(avant.contrat.genere && avant.contrat.fige && { analyticHistory: FieldValue.arrayUnion({ code: avant.contrat.genere, jusquAu: new Date().toISOString(), motif: motif.trim(), par: by }) }),
    });
    for (const p of avant.prestations) batch.update(adminDb.collection('services').doc(p.serviceId), { analyticCode: FieldValue.delete() });
    await batch.commit();
    const apres = await figerAnalytique(contractId);
    if (!apres.contrat.genere) throw new Error(`Code non générable : ${apres.contrat.manque.join(', ')} à renseigner.`);
    return apres;
}

// --- Suivi des ventes par analytique ---

export type LigneVente = { analytique: AnalytiqueLigne | null; montant: number; site: string; document: string; date: string };
export type SuiviVentes = {
    lignes: LigneVente[];
    /** Libellés des codes d'axe (« LYO » → « Lyon »), pour l'affichage. */
    libelles: Record<'societe' | 'agence' | 'secteur' | 'client' | 'contrat' | 'activite', Record<string, string>>;
    total: number; nonAffecte: number;
    /** Coûts de la période portant un code analytique : lignes des commandes engagées (à leur date) et heures saisies (à leur coût). */
    achats: LigneVente[];
    totalAchats: number;
};

/**
 * Ventes HT d'une période (dates AAAA-MM-JJ incluses), ligne à ligne, avec leur analytique : factures émises (hors
 * proformas) et avoirs (lignes négatives). Avec les coûts de la même période : commandes engagées et heures.
 */
export async function suiviVentes(debut: string, fin: string): Promise<SuiviVentes> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(debut) || !/^\d{4}-\d{2}-\d{2}$/.test(fin) || fin < debut) throw new Error('Période : dates de début et de fin, dans l\'ordre.');
    const du = Timestamp.fromDate(new Date(`${debut}T00:00:00Z`)), au = Timestamp.fromDate(new Date(`${fin}T23:59:59Z`));
    const [invoices, creditNotes, sites, companies, agencies, sectors, clients, contracts, activities, projects, commandes, heures] = await Promise.all([
        adminDb.collection('invoices').where('date', '>=', du).where('date', '<=', au).get(),
        adminDb.collection('creditNotes').where('date', '>=', du).where('date', '<=', au).get(),
        adminDb.collection('sites').select('name').get(), adminDb.collection('companies').select('code', 'name').get(),
        adminDb.collection('agencies').select('code', 'name').get(), adminDb.collection('sectors').select('code', 'name').get(),
        adminDb.collection('clients').select('externalCode', 'name').get(), adminDb.collection('contracts').select('contractNumber', 'label', 'clientName').get(),
        adminDb.collection('activities').select('code', 'label').get(), adminDb.collection('projects').select('code', 'title', 'clientName').get(),
        adminDb.collection('commandes').where('date', '>=', debut).where('date', '<=', fin).get(), adminDb.collection('heures').where('date', '>=', debut).where('date', '<=', fin).get(),
    ]);
    const nomSite = new Map(sites.docs.map(d => [d.id, String(d.get('name') ?? '')]));
    const jour = (v: unknown) => (v instanceof Timestamp ? v.toDate() : new Date(String(v))).toISOString().slice(0, 10);
    const lignes: LigneVente[] = [];
    const ajouter = (items: InvoiceLineItem[] | undefined, document: string, date: string) => {
        for (const l of items ?? []) {
            if (!l.total) continue;
            lignes.push({ analytique: l.analytique ?? null, montant: l.total, site: l.siteId ? nomSite.get(l.siteId) ?? '' : '', document, date });
        }
    };
    for (const d of invoices.docs) {
        if (d.get('status') === 'proforma') continue;
        ajouter(d.get('lineItems'), String(d.get('invoiceNumber') ?? d.id), jour(d.get('date')));
    }
    // Les lignes d'un avoir sont déjà négatives (annulation : lignes de la facture inversées ; régularisation : écart négatif).
    for (const d of creditNotes.docs) ajouter(d.get('lineItems'), String(d.get('creditNoteNumber') ?? d.id), jour(d.get('date')));
    const lib = (docs: FirebaseFirestore.QueryDocumentSnapshot[], code: string, nom: (d: FirebaseFirestore.QueryDocumentSnapshot) => string) =>
        Object.fromEntries(docs.filter(d => d.get(code)).map(d => [segment(d.get(code)), nom(d)]));
    // Coûts : lignes des commandes engagées (validées, passées, reçues, soldées) et heures, avec l'analytique figée à leur saisie.
    const achats: LigneVente[] = [];
    for (const d of commandes.docs) {
        if (!STATUTS_ENGAGES.includes(d.get('status'))) continue;
        for (const l of (d.get('lines') ?? []) as { total?: number; analytique?: AnalytiqueLigne }[]) if (l.total) achats.push({ analytique: l.analytique ?? null, montant: l.total, site: '', document: String(d.get('number') ?? d.id), date: String(d.get('date')) });
    }
    for (const d of heures.docs) if (d.get('cost')) achats.push({ analytique: (d.get('analytique') as AnalytiqueLigne | undefined) ?? null, montant: Number(d.get('cost')), site: '', document: `Heures — ${d.get('userName') ?? ''}`, date: String(d.get('date')) });
    const total = Math.round(lignes.reduce((t, l) => t + l.montant, 0) * 100) / 100;
    return {
        lignes,
        libelles: {
            societe: lib(companies.docs, 'code', d => String(d.get('name') ?? '')), agence: lib(agencies.docs, 'code', d => String(d.get('name') ?? '')),
            secteur: lib(sectors.docs, 'code', d => String(d.get('name') ?? '')), client: lib(clients.docs, 'externalCode', d => String(d.get('name') ?? '')),
            contrat: {
                ...lib(contracts.docs, 'contractNumber', d => `${d.get('clientName') ?? ''}${d.get('label') ? ` — ${d.get('label')}` : ''}`),
                ...Object.fromEntries(projects.docs.map(d => [segmentAffaire(String(d.get('code') ?? '')), `Travaux — ${d.get('title') ?? ''}`])),
            },
            activite: { ...lib(activities.docs, 'code', d => String(d.get('label') ?? '')), P5: 'Travaux P5', P6: 'Travaux P6' },
        },
        total, nonAffecte: Math.round(lignes.filter(l => !l.analytique).reduce((t, l) => t + l.montant, 0) * 100) / 100,
        achats, totalAchats: Math.round(achats.reduce((t, l) => t + l.montant, 0) * 100) / 100,
    };
}

// --- Reprise de l'existant ---

export type RepriseAnalytique = {
    contrats: number; codesFiges: number; nonGenerables: { contrat: string; manque: string[] }[];
    documents: number; lignes: number; sansContrat: number;
};

/**
 * Reprise : fige les codes des contrats (client, contrat, prestations) et pose l'analytique sur les lignes des factures
 * et avoirs déjà émis qui n'en ont pas (le code posé est celui d'aujourd'hui : l'historique n'en avait pas). Simulation
 * par défaut ; `apply` écrit. Les montants, numéros et PDF archivés ne sont pas touchés.
 */
export async function repriseAnalytique(apply: boolean): Promise<RepriseAnalytique> {
    const out: RepriseAnalytique = { contrats: 0, codesFiges: 0, nonGenerables: [], documents: 0, lignes: 0, sansContrat: 0 };
    const contracts = await adminDb.collection('contracts').select('contractNumber').get();
    const parContrat = new Map<string, AnalytiqueContrat>();
    for (const c of contracts.docs) {
        const avant = await analytiqueContrat(c.id).catch(() => null);
        if (!avant) continue;
        out.contrats++;
        const aFiger = [avant.client, avant.contrat, ...avant.prestations.map(p => p.analytique)].filter(e => !e.fige && e.genere).length;
        out.codesFiges += aFiger;
        if (!avant.contrat.code) out.nonGenerables.push({ contrat: String(c.get('contractNumber') ?? c.id), manque: avant.contrat.manque });
        parContrat.set(c.id, apply && aFiger ? await figerAnalytique(c.id) : avant);
    }
    for (const coll of ['invoices', 'creditNotes'] as const) {
        const docs = await adminDb.collection(coll).get();
        for (const d of docs.docs) {
            if (d.get('status') === 'proforma') continue;
            const lines = (d.get('lineItems') ?? []) as InvoiceLineItem[];
            if (!lines.some(l => !l.analytique)) continue;
            // Factures de travaux (devis, situations) : analytique de leur affaire, reprise à part (affaires:reprise).
            if (d.get('quoteId') || d.get('projectId')) { out.sansContrat++; continue; }
            const a = parContrat.get(String(d.get('contractId') ?? ''));
            if (!a) { out.sansContrat++; continue; }
            const maj = avecAnalytique(a, lines);
            const n = maj.filter((l, i) => l.analytique && !lines[i].analytique).length;
            if (!n) continue;
            out.documents++;
            out.lignes += n;
            if (apply) await d.ref.update({ lineItems: maj });
        }
    }
    return out;
}

/** Code externe d'une affaire de travaux (vide : retour au code généré). Les factures déjà émises gardent leur code. */
export async function setAnalytiqueExterneAffaire(projectId: string, valeur: string, by: string): Promise<void> {
    const erreur = controleCodeExterne(valeur);
    if (erreur) throw new Error(`Code externe : ${erreur}`);
    const ref = adminDb.collection('projects').doc(projectId);
    if (!(await ref.get()).exists) throw new Error('Affaire introuvable.');
    await ref.update({ analyticExternal: valeur.trim() || FieldValue.delete(), analyticExternalBy: by, analyticExternalAt: new Date().toISOString() });
}
