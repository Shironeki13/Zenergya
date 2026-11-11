import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { toDay } from '@/lib/services/site-amounts';
import type { MeterReading } from '@/lib/types';

/**
 * Relevés de compteurs écrits par le serveur seulement (écran de saisie, import, API) : un relevé repris dans une
 * facture (ECS au relevé), un intéressement ou une régularisation est **figé** (index, date et type ; le commentaire
 * reste modifiable, la suppression est refusée) ; un nouveau relevé ne se date pas avant le dernier relevé facturé
 * du compteur (période déjà facturée).
 */

export type ReadingLocks = {
    /** Relevé figé → ce qui l'a repris. */
    locked: Record<string, string>;
    /** Dernier relevé facturé du compteur (ECS au relevé). */
    lastBilled: { date: string; readingId: string; invoice: string } | null;
};

/** Ce qui fige les relevés d'un compteur. */
export async function readingLocks(meterId: string): Promise<ReadingLocks> {
    const meter = await adminDb.collection('meters').doc(meterId).get();
    if (!meter.exists) throw new Error('Compteur introuvable.');
    const siteId = String(meter.get('siteId') ?? '');
    const site = siteId ? await adminDb.collection('sites').doc(siteId).get() : null;
    const [interests, settlements, contracts] = await Promise.all([
        adminDb.collection('interests').where('meterId', '==', meterId).get(),
        adminDb.collection('service_settlements').where('p1Detail.meterId', '==', meterId).get(),
        siteId ? adminDb.collection('contracts').where('siteIds', 'array-contains', siteId).select().get() : Promise.resolve(null),
    ]);
    const contractIds = [...new Set([...(contracts?.docs.map(d => d.id) ?? []), ...(site?.get('contractId') ? [String(site.get('contractId'))] : [])])];
    const invoices = (await Promise.all(Array.from({ length: Math.ceil(contractIds.length / 30) }, (_, i) =>
        adminDb.collection('invoices').where('contractId', 'in', contractIds.slice(i * 30, i * 30 + 30)).get()))).flatMap(s => s.docs);

    const locked: Record<string, string> = {};
    for (const i of interests.docs) for (const id of [i.get('startReadingId'), i.get('endReadingId')]) if (id) locked[id] = `l'intéressement ${i.get('seasonLabel') ?? i.id}`;
    for (const s of settlements.docs) for (const id of [s.get('p1Detail.startReadingId'), s.get('p1Detail.endReadingId')]) if (id) locked[id] = 'une régularisation';
    let lastBilled: ReadingLocks['lastBilled'] = null;
    for (const inv of invoices) {
        if (inv.get('status') === 'cancelled' || inv.get('cancelledByCreditNoteId')) continue;
        const number = String(inv.get('invoiceNumber') ?? (inv.get('status') === 'proforma' ? 'proforma' : inv.id));
        for (const l of (inv.get('lineItems') ?? []) as { p1Releve?: { compteurs: { meterId: string; debut: { readingId: string }; fin: { readingId: string; date: string } }[] } }[]) {
            for (const c of l.p1Releve?.compteurs ?? []) {
                if (c.meterId !== meterId) continue;
                locked[c.debut.readingId] = locked[c.fin.readingId] = `la facture ${number}`;
                if (!lastBilled || c.fin.date > lastBilled.date) lastBilled = { date: c.fin.date, readingId: c.fin.readingId, invoice: number };
            }
        }
    }
    return { locked, lastBilled };
}

export type ReadingInput = { id?: string; meterId: string; date: string; value: number; type: MeterReading['type']; comment?: string };

const TYPES: MeterReading['type'][] = ['REEL', 'ESTIME', 'CORRIGE', 'AUTO'];
const fr = (d: string) => d.split('-').reverse().join('/');

/** Dernier relevé d'une liste (le plus récent ; à date égale, le dernier enregistré) : jour, index, type. */
export function dernierReleve(releves: { date: unknown; value: unknown; type?: unknown }[]): { lastReadingDate: string | null; lastReadingValue: number | null; lastReadingType: string | null } {
    let meilleur: { jour: string; t: number; value: number; type: string | null } | null = null;
    for (const r of releves) {
        const jour = toDay(r.date as never);
        if (!jour) continue;
        const t = typeof (r.date as { toMillis?: () => number })?.toMillis === 'function' ? (r.date as { toMillis: () => number }).toMillis() : Date.parse(String(r.date));
        if (!meilleur || t >= meilleur.t) meilleur = { jour, t, value: Number(r.value), type: r.type ? String(r.type) : null };
    }
    return { lastReadingDate: meilleur?.jour ?? null, lastReadingValue: meilleur ? meilleur.value : null, lastReadingType: meilleur?.type ?? null };
}

/**
 * Tient à jour, sur chaque compteur, son dernier relevé (date, index, type) : la liste des compteurs l'affiche sans
 * charger les relevés. À appeler après toute écriture de relevés (saisie, suppression, import, API).
 */
export async function majDerniersReleves(meterIds: string[]): Promise<void> {
    for (const id of [...new Set(meterIds.filter(Boolean))]) {
        const ref = adminDb.collection('meters').doc(id);
        const [compteur, releves] = await Promise.all([ref.get(), adminDb.collection('meterReadings').where('meterId', '==', id).get()]);
        if (!compteur.exists) continue;
        const d = dernierReleve(releves.docs.map(x => ({ date: x.get('date'), value: x.get('value'), type: x.get('type') })));
        if (compteur.get('lastReadingDate') !== d.lastReadingDate || compteur.get('lastReadingValue') !== d.lastReadingValue || compteur.get('lastReadingType') !== d.lastReadingType) await ref.update(d);
    }
}

/** Crée ou modifie un relevé saisi à l'écran (source MANUEL à la création). */
export async function saveReading(input: ReadingInput, by: string): Promise<string> {
    const at = new Date(input.date);
    if (Number.isNaN(at.getTime())) throw new Error('Date du relevé invalide.');
    if (at.getTime() > Date.now() + 3600_000) throw new Error('Date du relevé dans le futur.');
    if (!Number.isFinite(input.value) || input.value < 0) throw new Error('Index : nombre positif ou nul.');
    if (!TYPES.includes(input.type)) throw new Error('Type de relevé inconnu.');
    const meter = await adminDb.collection('meters').doc(input.meterId).get();
    if (!meter.exists) throw new Error('Compteur introuvable.');
    const { locked, lastBilled } = await readingLocks(input.meterId);
    const day = toDay(at)!;
    const comment = input.comment?.trim() ?? '';

    if (input.id) {
        const ref = adminDb.collection('meterReadings').doc(input.id);
        const snap = await ref.get();
        if (!snap.exists || snap.get('meterId') !== input.meterId) throw new Error('Relevé introuvable.');
        const sameDate = toDay(snap.get('date')) === day;
        const changes = !sameDate || Number(snap.get('value')) !== input.value || snap.get('type') !== input.type;
        if (locked[input.id] && changes) throw new Error(`Relevé repris dans ${locked[input.id]} : index, date et type ne se modifient plus (le commentaire, si). Une correction passe par un avoir.`);
        if (!sameDate && lastBilled && day <= lastBilled.date) throw new Error(`Période déjà facturée jusqu'au ${fr(lastBilled.date)} (facture ${lastBilled.invoice}) : ce relevé ne peut pas y être déplacé.`);
        await ref.update({ date: Timestamp.fromDate(at), value: input.value, type: input.type, comment, modifiedBy: by, modifiedAt: new Date().toISOString() });
        await majDerniersReleves([input.meterId]);
        return input.id;
    }
    if (lastBilled && day <= lastBilled.date) throw new Error(`Période déjà facturée jusqu'au ${fr(lastBilled.date)} (facture ${lastBilled.invoice}) : un relevé antérieur ne s'ajoute plus.`);
    const siteId = String(meter.get('siteId') ?? '');
    const site = siteId ? await adminDb.collection('sites').doc(siteId).get() : null;
    let contractId: string | null = site?.get('contractId') || null;
    if (!contractId && siteId) contractId = (await adminDb.collection('contracts').where('siteIds', 'array-contains', siteId).limit(1).get()).docs[0]?.id ?? null;
    const ref = await adminDb.collection('meterReadings').add({
        meterId: input.meterId, date: Timestamp.fromDate(at), value: input.value, type: input.type, source: 'MANUEL', comment,
        unit: meter.get('unit') ?? null, ...(contractId && { contractId }), createdBy: by, createdAt: new Date().toISOString(),
    });
    await majDerniersReleves([input.meterId]);
    return ref.id;
}

/** Supprime un relevé, sauf s'il est figé. */
export async function deleteReading(id: string): Promise<void> {
    const snap = await adminDb.collection('meterReadings').doc(id).get();
    if (!snap.exists) throw new Error('Relevé introuvable.');
    const { locked } = await readingLocks(String(snap.get('meterId')));
    if (locked[id]) throw new Error(`Relevé repris dans ${locked[id]} : il ne se supprime pas.`);
    await snap.ref.delete();
    await majDerniersReleves([String(snap.get('meterId'))]);
}
