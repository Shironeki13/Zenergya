import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { suiviContrat, type EcheanceSuivi } from '@/lib/pilotage/suivi-facturation';
import { alertesCompteur, trierAlertes, type Alerte, type CompteurSuivi, type RelevePilotage } from '@/lib/pilotage/alertes-compteurs';
import { loadBillingInput } from '@/services/contract-billing-admin';
import { getContract, getInvoicesByContract } from '@/services/firestore-admin';
import { P1_DOC_ID, valeurAu, type P1MeterDoc } from '@/lib/p1/stockage';
import { toDay } from '@/lib/services/site-amounts';

/** Vues de pilotage : suivi de la facturation et alertes des compteurs (calculées au serveur). */

const addDays = (day: string, k: number) => new Date(Date.parse(day) + k * 86_400_000).toISOString().slice(0, 10);

export type SuiviFacturation = {
    today: string;
    horizon: string;
    echeances: EcheanceSuivi[];
    /** Contrats dont l'échéancier ne se calcule pas (périodicité, terme, dates…). */
    contratsEnErreur: { contractId: string; contractNumber: string; clientName: string; erreurs: string[] }[];
};

/** Échéances de tous les contrats actifs, du dernier facturé jusqu'à l'horizon (jours). */
export async function suiviFacturation(horizonJours = 60): Promise<SuiviFacturation> {
    const today = toDay(new Date())!;
    const horizon = addDays(today, horizonJours);
    const snap = await adminDb.collection('contracts').where('status', '==', 'Actif').get();
    const echeances: EcheanceSuivi[] = [];
    const contratsEnErreur: SuiviFacturation['contratsEnErreur'] = [];
    for (const c of snap.docs) {
        const contract = await getContract(c.id);
        if (!contract) continue;
        const head = { contractId: contract.id, contractNumber: contract.contractNumber ?? contract.id, clientName: contract.clientName };
        try {
            const [input, invoices] = await Promise.all([loadBillingInput(contract), getInvoicesByContract(contract.id)]);
            const suivi = suiviContrat({ id: head.contractId, contractNumber: head.contractNumber, clientName: head.clientName }, input, invoices, today, horizon);
            if (suivi.erreurs.length) contratsEnErreur.push({ ...head, erreurs: suivi.erreurs });
            echeances.push(...suivi.echeances);
        } catch (e) {
            contratsEnErreur.push({ ...head, erreurs: [(e as Error).message] });
        }
    }
    echeances.sort((a, b) => a.billableOn.localeCompare(b.billableOn) || a.clientName.localeCompare(b.clientName));
    return { today, horizon, echeances, contratsEnErreur };
}

/** Alertes de tous les compteurs. */
export async function alertesCompteurs(): Promise<{ today: string; alertes: Alerte[]; compteurs: number }> {
    const today = toDay(new Date())!;
    const [meters, sites, readings, p1, services] = await Promise.all([
        adminDb.collection('meters').get(),
        adminDb.collection('sites').get(),
        adminDb.collection('meterReadings').get(),
        adminDb.collection('p1Parametrage').where('kind', '==', 'meter').get(),
        adminDb.collection('services').where('p1Mode', '==', 'releve').get(),
    ]);
    const siteById = new Map(sites.docs.map(d => [d.id, d.data()]));
    const usageOf = new Map(p1.docs.map(d => [d.id, valeurAu<string>((d.data() as P1MeterDoc).params, 'usage', today)]));
    // Compteurs des ECS au relevé : celui de la prestation, sinon ceux d'usage ECS du site.
    const releveMeters = new Set(services.docs.filter(d => d.get('isActive') !== false && d.get('meterId')).map(d => String(d.get('meterId'))));
    const releveSites = new Set(services.docs.filter(d => d.get('isActive') !== false && !d.get('meterId')).map(d => String(d.get('siteId'))));
    const byMeter = new Map<string, RelevePilotage[]>();
    for (const r of readings.docs) {
        const id = String(r.get('meterId'));
        if (!byMeter.has(id)) byMeter.set(id, []);
        byMeter.get(id)!.push({ id: r.id, date: toDay(r.get('date'))!, value: Number(r.get('value')), type: r.get('type') ?? undefined });
    }
    const alertes: Alerte[] = [];
    for (const m of meters.docs) {
        const site = siteById.get(String(m.get('siteId')));
        const usage = usageOf.get(P1_DOC_ID.meter(m.id)) ?? null;
        const compteur: CompteurSuivi = {
            id: m.id, code: String(m.get('code') ?? m.id), name: String(m.get('name') ?? ''), siteId: String(m.get('siteId') ?? ''),
            site: String(site?.name ?? m.get('siteName') ?? '—'), client: String(site?.clientName ?? m.get('clientName') ?? '—'),
            unit: m.get('unit') ?? undefined, status: m.get('status') ?? undefined, usage,
            ecsAuReleve: releveMeters.has(m.id) || (releveSites.has(String(m.get('siteId'))) && usage === 'ecs'),
        };
        alertes.push(...alertesCompteur(compteur, byMeter.get(m.id) ?? [], today));
    }
    return { today, alertes: trierAlertes(alertes), compteurs: meters.size };
}
