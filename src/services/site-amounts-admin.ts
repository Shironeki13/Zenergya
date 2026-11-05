import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { amountsDiffer, computeSiteAmounts, todayInParis, type ServiceLike } from '@/lib/services/site-amounts';

/**
 * Recalcul côté serveur des montants des sites à partir de leurs prestations (voir lib/services/site-amounts).
 * Sans liste : tous les sites qui ont des prestations ou qui en ont eu (recalcul quotidien).
 */

export type AmountChange = {
    siteId: string;
    site: string;
    before: { activityId: string; amount: number }[];
    after: { activityId: string; amount: number }[];
    firstTime: boolean;
};

export async function recomputeSiteAmounts(siteIds?: string[], opts: { dryRun?: boolean; day?: string } = {}): Promise<{ checked: number; changes: AmountChange[] }> {
    const day = opts.day ?? todayInParis();
    let sites: FirebaseFirestore.DocumentSnapshot[];
    let services: ServiceLike[];
    if (siteIds) {
        const ids = [...new Set(siteIds.filter(Boolean))];
        sites = await Promise.all(ids.map(id => adminDb.collection('sites').doc(id).get()));
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
        services = (await Promise.all(chunks.map(c => adminDb.collection('services').where('siteId', 'in', c).get())))
            .flatMap(s => s.docs.map(d => ({ id: d.id, ...d.data() }) as ServiceLike));
    } else {
        services = (await adminDb.collection('services').get()).docs.map(d => ({ id: d.id, ...d.data() }) as ServiceLike);
        const driven = (await adminDb.collection('sites').where('amountsSource', '==', 'services').select().get()).docs.map(d => d.id);
        const ids = [...new Set([...services.map(s => s.siteId), ...driven])];
        sites = await Promise.all(ids.map(id => adminDb.collection('sites').doc(id).get()));
    }

    const changes: AmountChange[] = [];
    const writes: [FirebaseFirestore.DocumentReference, Record<string, unknown>][] = [];
    const now = new Date().toISOString();
    for (const snap of sites) {
        if (!snap.exists) continue;
        const site = { id: snap.id, ...snap.data() } as { id: string; contractId?: string; amountsSource?: string; amounts?: { activityId: string; amount: number }[]; activityIds?: string[]; code?: string; name?: string };
        const next = computeSiteAmounts(site, services, day);
        if (!next || !amountsDiffer(site, next)) continue;
        changes.push({ siteId: site.id, site: site.code ?? site.name ?? site.id, before: site.amounts ?? [], after: next.amounts, firstTime: site.amountsSource !== 'services' });
        writes.push([snap.ref, { ...next, amountsComputedAt: now }]);
    }
    if (!opts.dryRun) {
        for (let i = 0; i < writes.length; i += 400) {
            const batch = adminDb.batch();
            for (const [ref, data] of writes.slice(i, i + 400)) batch.update(ref, data as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>);
            await batch.commit();
        }
    }
    return { checked: sites.length, changes };
}
