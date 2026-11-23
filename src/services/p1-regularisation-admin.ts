import 'server-only';
import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { dueDateFor, vatTotals } from '@/lib/billing/contract-billing';
import { regularisationP1, type RegulDocument, type RegulResult } from '@/lib/billing/p1-regularisation';
import { toDay } from '@/lib/services/site-amounts';
import {
    createInvoice, createRegularisationCreditNote, getClient, getContract, getInvoicesByContract, resolveIssuingCompany, resolvePaymentTerm,
} from '@/services/firestore-admin';
import { archiveDocumentSafely } from '@/services/document-archive';
import type { Contract } from '@/lib/types';
import { decompteSaison, type DecompteSaison } from '@/lib/billing/p1-decompte';
import { exerciceDe, prixAnnuel, type PartieFacturee, type PrixAnnuel } from '@/lib/billing/p1-prix-annuel';
import type { PeriodeReference } from '@/lib/p1/parametrage';
import { coefficientSaison } from '@/lib/p1/formules';
import { partieChauffee, saisonDe, type SaisonChauffe } from '@/lib/p1/saisons';
import { P1_DOC_ID, formuleAu, valeurAu, type P1ContractDoc, type P1MeterDoc, type P1SiteDoc } from '@/lib/p1/stockage';
import type { Energie, TermeNc } from '@/lib/p1/parametrage';
import { loadSeries } from '@/services/p1-admin';
import { releveSource } from '@/services/contract-billing-admin';
import { avecAnalytique, figerAnalytique } from '@/services/analytique-admin';

/**
 * Régularisation P1 d'un contrat (préparation et émission) : P1 dû (décompte de saison ou prix annuel calculés, ou
 * montant importé `p1Reel`) − P1 déjà facturé,
 * plus les intéressements de la période. Lignes positives : une facture ; négatives : un avoir de régularisation.
 */

const chunks = <T>(list: T[]) => Array.from({ length: Math.ceil(list.length / 30) }, (_, i) => list.slice(i * 30, i * 30 + 30));

/** Mois AAAA-MM de début à fin inclus. */
export function moisEntre(debut: string, fin: string): string[] {
    if (!/^\d{4}-\d{2}$/.test(debut) || !/^\d{4}-\d{2}$/.test(fin) || fin < debut) throw new Error('Période : mois de début et de fin (AAAA-MM), dans l\'ordre.');
    const out: string[] = [];
    for (let m = debut; m <= fin && out.length < 60; ) {
        out.push(m);
        const [y, mo] = m.split('-').map(Number);
        m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }
    return out;
}

export type RegulPreview = RegulResult & { contract: Contract; billingVersion: number };

export async function prepareP1Regularisation(contractId: string, debut: string, fin: string): Promise<RegulPreview> {
    const mois = moisEntre(debut, fin);
    const [contract, versionSnap] = await Promise.all([getContract(contractId), adminDb.collection('contracts').doc(contractId).get()]);
    if (!contract) throw new Error('Contrat non trouvé.');
    const siteIds = contract.siteIds ?? [];
    const [sites, services, activities, vatRates, invoices, creditNotes, reelDocs] = await Promise.all([
        Promise.all(chunks(siteIds).map(c => adminDb.collection('sites').where(FieldPath.documentId(), 'in', c).get())).then(s => s.flatMap(x => x.docs)),
        adminDb.collection('services').where('contractId', '==', contract.id).get().then(s => s.docs),
        adminDb.collection('activities').get().then(s => new Map(s.docs.map(d => [d.id, d.data()]))),
        adminDb.collection('vatRates').get().then(s => new Map(s.docs.map(d => [d.id, Number(d.get('rate'))]))),
        getInvoicesByContract(contract.id),
        adminDb.collection('creditNotes').where('contractId', '==', contract.id).get().then(s => s.docs),
        Promise.all(chunks(siteIds).map(c => adminDb.collection('p1Reel').where('siteId', 'in', c).get())).then(s => s.flatMap(x => x.docs)),
    ]);
    const p1Services = services.filter(d => d.get('type') === 'P1' && d.get('isActive') !== false);
    const interests = (await Promise.all(chunks(p1Services.map(d => d.id)).map(c => adminDb.collection('interests').where('serviceId', 'in', c).get()))).flatMap(s => s.docs);

    const reel = new Map<string, Map<string, number>>();
    for (const d of reelDocs) {
        const siteId = String(d.get('siteId'));
        if (!reel.has(siteId)) reel.set(siteId, new Map());
        reel.get(siteId)!.set(`${d.get('usage') ?? 'total'}|${d.get('mois')}`, Number(d.get('montantHt')));
    }
    // Décompte MTI (paramétrage P1 du contrat) : le réel chauffage des sites en acomptes est le P1 dû de la saison.
    const { decomptes, erreurs: erreursDecompte } = await decomptesMti(contract.id, siteIds, mois, p1Services);
    for (const [siteId, liste] of decomptes) {
        if (!reel.has(siteId)) reel.set(siteId, new Map());
        const r = reel.get(siteId)!;
        for (const k of [...r.keys()]) if (k.startsWith('chauffage|') || k.startsWith('total|')) r.delete(k);
        for (const d of liste) for (const m of d.mois) if (mois.includes(m.mois)) r.set(`chauffage|${m.mois}`, m.montant);
    }
    // Prix annuel (formule à périodicité annuelle) des sites facturés au DJU : exercice clos, dû au C/C0 de l'exercice.
    const { prix: prixAnnuels, erreurs: erreursPrix } = await prixAnnuelsDju(contract.id, mois, p1Services, invoices);
    for (const [siteId, liste] of prixAnnuels) {
        if (!reel.has(siteId)) reel.set(siteId, new Map());
        const r = reel.get(siteId)!;
        for (const x of liste) for (const m of x.mois) { r.delete(`total|${m.mois}`); r.set(`chauffage|${m.mois}`, m.du); }
    }
    const documents: RegulDocument[] = [
        ...invoices.map(i => ({ id: i.id, kind: 'invoice' as const, status: i.status, cancelledByCreditNoteId: i.cancelledByCreditNoteId, lineItems: i.lineItems ?? [] })),
        ...creditNotes.map(c => ({ id: c.id, kind: 'creditNote' as const, status: c.get('status'), lineItems: c.get('lineItems') ?? [] })),
    ];
    const result = regularisationP1({
        mois,
        sites: sites.map(site => {
            const ofSite = p1Services.filter(d => d.get('siteId') === site.id);
            // TVA par usage : prestation P1 ECS pour l'ECS, autre prestation P1 (en acompte de préférence) pour le chauffage.
            const pick = (ecs: boolean) => ofSite.filter(d => (d.get('p1Type') === 'ECS') === ecs).sort((a, b) => Number(b.get('p1Mode') === 'acompte') - Number(a.get('p1Mode') === 'acompte'))[0];
            const rateOf = (svc?: FirebaseFirestore.QueryDocumentSnapshot) => {
                if (!svc) return undefined;
                const activity = activities.get(String(svc.get('activityId')));
                const vatId = (svc.get('vatRateId') as string | undefined) || (activity?.vatRateId as string | undefined);
                return vatId && vatRates.has(vatId) ? vatRates.get(vatId)! : undefined;
            };
            const chauffage = pick(false);
            const ecs = pick(true);
            const activity = activities.get(String((chauffage ?? ecs)?.get('activityId')));
            const vat = { chauffage: rateOf(chauffage), ecs: rateOf(ecs) };
            return {
                id: site.id, name: String(site.get('name') ?? site.id), activityCode: String(activity?.code ?? 'P1'),
                vatRates: Object.fromEntries(Object.entries(vat).filter(([, v]) => v !== undefined)),
                ecsAuReleve: ofSite.some(d => d.get('p1Type') === 'ECS' && d.get('p1Mode') === 'releve'),
                chauffageAuReleve: ofSite.some(d => d.get('p1Type') === 'CHAUFFAGE' && d.get('p1Mode') === 'releve'),
                ...(decomptes.has(site.id) && { decompte: decomptes.get(site.id) }),
                ...(prixAnnuels.has(site.id) && { prixAnnuel: prixAnnuels.get(site.id) }),
            };
        }),
        reel, documents,
        interests: interests.map(i => {
            const svc = p1Services.find(s => s.id === i.get('serviceId'));
            return { id: i.id, siteId: String(svc?.get('siteId') ?? ''), seasonLabel: String(i.get('seasonLabel') ?? ''), endDate: toDay(i.get('endDate')) ?? '', amount: Number(i.get('interestAmount') ?? 0) };
        }),
    });
    return { ...result, errors: [...erreursDecompte, ...erreursPrix, ...result.errors], contract, billingVersion: Number(versionSnap.get('billingVersion') ?? 0) };
}

/**
 * Décomptes MTI des sites en acomptes chauffage d'un contrat dont la régularisation est « décompte MTI », pour les
 * saisons couvrant la période : DJU bornés par l'allumage et l'arrêt, C/C0 annuel pondéré par les DJU (formule P1
 * chauffage du site), P1₀ = quantité de référence × prix de base, DJU contractuels du poste.
 */
async function decomptesMti(contractId: string, siteIds: string[], mois: string[], p1Services: FirebaseFirestore.QueryDocumentSnapshot[]):
    Promise<{ decomptes: Map<string, DecompteSaison[]>; erreurs: string[] }> {
    const decomptes = new Map<string, DecompteSaison[]>();
    const erreurs: string[] = [];
    const contractDoc = (await adminDb.collection('p1Parametrage').doc(P1_DOC_ID.contract(contractId)).get()).data() as P1ContractDoc | undefined;
    if (valeurAu<string>(contractDoc?.params, 'regularisation', `${mois[0]}-01`) !== 'decompte_dju') return { decomptes, erreurs };
    const sitesAcompte = [...new Set(p1Services.filter(d => d.get('p1Mode') === 'acompte' && d.get('p1Type') !== 'ECS').map(d => String(d.get('siteId'))))];
    if (!sitesAcompte.length) return { decomptes, erreurs };
    const [siteSnaps, meters, saisonsSnap, { series }, releves] = await Promise.all([
        adminDb.getAll(...sitesAcompte.map(id => adminDb.collection('p1Parametrage').doc(P1_DOC_ID.site(id)))),
        Promise.all(chunks(sitesAcompte).map(c => adminDb.collection('meters').where('siteId', 'in', c).get())).then(x => x.flatMap(y => y.docs)),
        Promise.all(chunks(sitesAcompte).map(c => adminDb.collection('saisonsChauffe').where('siteId', 'in', c).get())).then(x => x.flatMap(y => y.docs)),
        loadSeries(), releveSource(sitesAcompte, contractId),
    ]);
    const meterDocs = meters.length ? new Map((await adminDb.getAll(...meters.map(m => adminDb.collection('p1Parametrage').doc(P1_DOC_ID.meter(m.id))))).filter(d => d.exists).map(d => [d.id, d.data() as P1MeterDoc])) : new Map<string, P1MeterDoc>();
    const saisons = saisonsSnap.map(d => ({ id: d.id, ...d.data() }) as SaisonChauffe);
    const nomSite = new Map((await Promise.all(chunks(sitesAcompte).map(c => adminDb.collection('sites').where(FieldPath.documentId(), 'in', c).get()))).flatMap(x => x.docs).map(d => [d.id, String(d.get('name') ?? d.id)]));
    for (const siteId of sitesAcompte) {
        const site = siteSnaps.find(d => d.id === P1_DOC_ID.site(siteId))?.data() as P1SiteDoc | undefined;
        const nom = nomSite.get(siteId) ?? siteId;
        const liste: DecompteSaison[] = [];
        for (const libelle of [...new Set(mois.map(m => saisonDe(`${m}-01`)))]) {
            const s = saisons.find(x => x.siteId === siteId && x.saison === libelle);
            if (!s) { erreurs.push(`Site ${nom} : décompte de la saison ${libelle} impossible, dates d'allumage et d'arrêt non renseignées.`); continue; }
            if (!s.arret) { erreurs.push(`Site ${nom} : saison ${libelle} en cours (arrêt non renseigné), décompte après l'arrêt.`); continue; }
            // DJU de chaque mois, bornés par l'allumage et l'arrêt.
            const djuParMois: Record<string, number> = {};
            let probleme: string | null = null;
            for (let m = s.allumage.slice(0, 7); m <= s.arret.slice(0, 7); ) {
                const finMois = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
                const part = partieChauffee([s], `${m}-01`, finMois);
                if (part && typeof part !== 'string') {
                    const d = releves.dju!(siteId, part.debut, part.fin);
                    if (typeof d === 'string') { probleme = d; break; }
                    djuParMois[m] = d;
                }
                const [y, mo] = m.split('-').map(Number);
                m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
            }
            if (probleme) { erreurs.push(`Site ${nom} : ${probleme}.`); continue; }
            const jour = s.allumage;
            const energies = [...new Set(meters.filter(m => m.get('siteId') === siteId).map(m => valeurAu<Energie>(meterDocs.get(P1_DOC_ID.meter(m.id))?.params, 'energie', jour)).filter((e): e is Energie => !!e))];
            const f = formuleAu(contractDoc ?? null, siteId, energies, 'chauffage', jour);
            if (!f) { erreurs.push(`Site ${nom} : aucune formule de révision P1 chauffage en vigueur au ${jour.split('-').reverse().join('/')}.`); continue; }
            const coef = f.version.prixFixe ? { coefficient: 1 } : coefficientSaison(f.version, djuParMois, series);
            if ('causes' in coef) { erreurs.push(`Site ${nom} : C/C0 de la saison ${libelle} : ${coef.causes.join(' ; ')}.`); continue; }
            const postes = Object.values(site?.postes ?? {}).filter(p => !p.retireLe);
            const quantite = valeurAu<number>(site?.params, 'quantiteAcompte', jour)
                ?? postes.reduce((t, p) => t + (valeurAu<string>(p.params, 'cibleNbUnite', jour) === 'MWh' && valeurAu<TermeNc[]>(p.params, 'formuleNc', jour) ? valeurAu<number>(p.params, 'cibleNb', jour) ?? 0 : 0), 0);
            const djuReference = postes.map(p => valeurAu<number>(p.params, 'djuReference', jour)).find((v): v is number => !!v) ?? 0;
            const d = decompteSaison({ saison: libelle, quantite, prixBase: valeurAu<number>(site?.params, 'prixBase', jour) ?? 0, coefficient: coef.coefficient, djuReference, djuParMois });
            if (typeof d === 'string') { erreurs.push(`Site ${nom} : décompte ${libelle} : ${d}.`); continue; }
            liste.push(d);
        }
        if (liste.length) decomptes.set(siteId, liste);
    }
    return { decomptes, erreurs };
}

/**
 * Prix annuel des sites facturés « MTI au DJU » dont la formule P1 chauffage est à périodicité annuelle : pour chaque
 * exercice (année civile ou saison de chauffe, selon la période de référence du site) **entièrement compris** dans la
 * période et clos, le P1 dû au C/C0 de l'exercice, à comparer aux mois facturés au prix du mois. Un exercice que la
 * période ne fait que commencer est laissé (il n'est pas clos) ; un exercice dont elle ne couvre que la fin est refusé.
 */
async function prixAnnuelsDju(contractId: string, mois: string[], p1Services: FirebaseFirestore.QueryDocumentSnapshot[], invoices: Awaited<ReturnType<typeof getInvoicesByContract>>):
    Promise<{ prix: Map<string, PrixAnnuel[]>; erreurs: string[] }> {
    const prix = new Map<string, PrixAnnuel[]>();
    const erreurs: string[] = [];
    const sitesDju = [...new Set(p1Services.filter(d => d.get('p1Mode') === 'dju' && d.get('p1Type') !== 'ECS').map(d => String(d.get('siteId'))))];
    if (!sitesDju.length) return { prix, erreurs };
    const contractDoc = (await adminDb.collection('p1Parametrage').doc(P1_DOC_ID.contract(contractId)).get()).data() as P1ContractDoc | undefined;
    // Rien à lire de plus si aucune formule chauffage du contrat n'est à prix annuel.
    const annuelle = Object.values(contractDoc?.formules ?? {}).some(f => !f.retireLe && f.usage === 'chauffage' && Object.values(f.versions ?? {}).some(v => (v as { valeur?: { periodicite?: string } }).valeur?.periodicite?.startsWith('annuel')));
    if (!annuelle) return { prix, erreurs };
    const [siteSnaps, meters, { series }, noms] = await Promise.all([
        adminDb.getAll(...sitesDju.map(id => adminDb.collection('p1Parametrage').doc(P1_DOC_ID.site(id)))),
        Promise.all(chunks(sitesDju).map(c => adminDb.collection('meters').where('siteId', 'in', c).get())).then(x => x.flatMap(y => y.docs)),
        loadSeries(),
        Promise.all(chunks(sitesDju).map(c => adminDb.collection('sites').where(FieldPath.documentId(), 'in', c).get())).then(x => new Map(x.flatMap(y => y.docs).map(d => [d.id, String(d.get('name') ?? d.id)]))),
    ]);
    const meterDocs = meters.length ? new Map((await adminDb.getAll(...meters.map(m => adminDb.collection('p1Parametrage').doc(P1_DOC_ID.meter(m.id))))).filter(d => d.exists).map(d => [d.id, d.data() as P1MeterDoc])) : new Map<string, P1MeterDoc>();
    const frMois = (m: string) => `${m.slice(5)}/${m.slice(0, 4)}`;
    const courant = toDay(new Date())!.slice(0, 7);
    const debut = mois[0], fin = mois[mois.length - 1];
    for (const siteId of sitesDju) {
        const nom = noms.get(siteId) ?? siteId;
        const site = siteSnaps.find(d => d.id === P1_DOC_ID.site(siteId))?.data() as P1SiteDoc | undefined;
        // Parties facturées au DJU (factures valides), tous exercices confondus.
        const parties: PartieFacturee[] = [];
        for (const i of invoices) {
            if (i.status === 'cancelled' || i.status === 'proforma' || i.cancelledByCreditNoteId) continue;
            for (const l of i.lineItems ?? []) if (l.p1Dju?.siteId === siteId) for (const m of l.p1Dju.mois) parties.push({ mois: m.mois, debut: m.debut, fin: m.fin, dju: m.dju, base: l.p1Dju.base, djuReference: l.p1Dju.djuReference, montant: m.montant });
        }
        const liste: PrixAnnuel[] = [];
        const vus = new Set<string>();
        for (const p of parties.filter(x => x.mois >= debut && x.mois <= fin).sort((a, b) => a.mois.localeCompare(b.mois))) {
            const jour = `${p.mois}-01`;
            const ex = exerciceDe(p.mois, valeurAu<PeriodeReference>(site?.params, 'periodeReference', jour) ?? 'saison_de_chauffe');
            if (vus.has(ex.libelle)) continue;
            vus.add(ex.libelle);
            const duSite = parties.filter(x => x.mois >= ex.debut && x.mois <= ex.fin).sort((a, b) => a.mois.localeCompare(b.mois));
            const energies = [...new Set(meters.filter(m => m.get('siteId') === siteId).map(m => valeurAu<Energie>(meterDocs.get(P1_DOC_ID.meter(m.id))?.params, 'energie', jour)).filter((e): e is Energie => !!e))];
            const f = formuleAu(contractDoc ?? null, siteId, energies, 'chauffage', `${duSite[0].mois}-01`);
            if (!f || f.version.prixFixe || f.version.periodicite === 'mensuel') continue;
            if (fin < ex.fin) continue;   // exercice non clos sur cette période : rien à régulariser encore
            if (debut > duSite[0].mois) { erreurs.push(`Site ${nom} : prix annuel de l'exercice ${ex.libelle}, régularisez l'exercice entier (de ${frMois(ex.debut)} à ${frMois(ex.fin)}).`); continue; }
            if (ex.fin >= courant) { erreurs.push(`Site ${nom} : exercice ${ex.libelle} en cours, le prix annuel se calcule après sa clôture (${frMois(ex.fin)}).`); continue; }
            const r = prixAnnuel({ exercice: ex, version: f.version, series, parties: duSite });
            if (typeof r === 'string') { erreurs.push(`Site ${nom} : prix annuel de l'exercice ${ex.libelle} : ${r}.`); continue; }
            liste.push(r);
        }
        if (liste.length) prix.set(siteId, liste);
    }
    return { prix, erreurs };
}

/** Émet la régularisation : avoir (lignes négatives) puis facture (lignes positives). */
export async function emitP1Regularisation(contractId: string, debut: string, fin: string, date: string): Promise<{ invoice?: { id: string; number?: string }; creditNote?: { id: string; number: string } }> {
    const prep = await prepareP1Regularisation(contractId, debut, fin);
    if (prep.errors.length) throw new Error(`Régularisation impossible : ${prep.errors.join(' ')}`);
    if (prep.lines.length === 0) throw new Error('Rien à régulariser sur cette période.');
    const { contract } = prep;
    const client = await getClient(contract.clientId);
    if (!client) throw new Error('Client non trouvé.');
    const company = await resolveIssuingCompany(contract, client);
    const day = toDay(date) ?? toDay(new Date())!;
    // Analytique figée sur chaque ligne (prestation P1 du site, sinon contrat + activité).
    const analytique = await figerAnalytique(contract.id);
    const lignes = avecAnalytique(analytique, prep.lines);
    const negatives = lignes.filter(l => l.total < 0);
    const positives = lignes.filter(l => l.total > 0);
    let version = prep.billingVersion;
    const out: { invoice?: { id: string; number?: string }; creditNote?: { id: string; number: string } } = {};
    const periode = `Régularisation P1 de ${debut} à ${fin}`;
    if (negatives.length) {
        const totals = vatTotals(negatives);
        const cn = await createRegularisationCreditNote({
            originalInvoiceIds: prep.acompteInvoiceIds, contractId: contract.id, clientId: contract.clientId, clientName: contract.clientName,
            date: day, status: 'finalized', lineItems: negatives, subtotal: totals.subtotal, tax: totals.tax, total: totals.total,
            vatBreakdown: totals.vatBreakdown, reason: periode,
        }, company, { contractId: contract.id, billingVersion: version });
        version++;
        await archiveDocumentSafely('creditNote', cn.id);
        out.creditNote = { id: cn.id, number: cn.creditNoteNumber };
    }
    if (positives.length) {
        const term = await resolvePaymentTerm(contract, client);
        const starts = positives.map(l => l.periodStartDate).filter((x): x is string => !!x).sort();
        const ends = positives.map(l => l.periodEndDate).filter((x): x is string => !!x).sort();
        const inv = await createInvoice({
            contractId: contract.id, clientId: contract.clientId, clientName: contract.clientName, date: day, dueDate: dueDateFor(day, term),
            ...(starts.length && { periodStartDate: starts[0], periodEndDate: ends[ends.length - 1] }),
            status: 'due', lineItems: positives, ...vatTotals(positives),
        }, company, { contractId: contract.id, billingVersion: version });
        await archiveDocumentSafely('invoice', inv.id);
        out.invoice = { id: inv.id, number: inv.invoiceNumber };
    }
    return out;
}
