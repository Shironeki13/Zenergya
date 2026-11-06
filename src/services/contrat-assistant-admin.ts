import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { ETAPES, LIBELLES_ETAPES, brouillonFinal, erreursBrouillon, montantNombre, type Brouillon } from '@/lib/contracts/assistant';
import { reserveCodes } from '@/services/imports-admin';
import { recomputeSiteAmounts } from '@/services/site-amounts-admin';
import type { SessionUser } from '@/lib/auth/server';

/**
 * Création d'un contrat par l'assistant, au serveur et en une écriture groupée : client (nouveau, avec son contact de
 * facturation), contrat (« Brouillon », en attente de validation), sites (nouveaux, ou existants du client rattachés),
 * prestations saisies. Codes CLI, CTN, SIT attribués ici (compteur partagé avec les imports : pas de doublon).
 */

export type ContratCree = { contractId: string; contractNumber: string; clientId: string; siteIds: string[] };

export async function creerContratAssistant(brouillon: Brouillon, user: SessionUser): Promise<ContratCree> {
    const b = brouillonFinal(brouillon);
    // Mêmes contrôles qu'à l'écran (le navigateur n'est pas une garantie).
    const erreurs = erreursBrouillon(b);
    const bloquantes = ETAPES.flatMap(e => erreurs[e].map(m => `${LIBELLES_ETAPES[e]} : ${m}`));
    if (bloquantes.length) throw new Error(bloquantes.join(' '));

    const [activitesSnap, schedules, terms, vatRates] = await Promise.all([
        adminDb.collection('activities').get(), adminDb.collection('schedules').get(), adminDb.collection('terms').get(), adminDb.collection('vatRates').get(),
    ]);
    const activites = new Map(activitesSnap.docs.map(d => [d.id, d.data()]));
    const inconnues = b.contrat.activityIds.filter(id => !activites.has(id));
    if (inconnues.length) throw new Error('Activité inconnue : rechargez la page.');
    const existe = (snap: FirebaseFirestore.QuerySnapshot, id: string) => !id || snap.docs.some(d => d.id === id);
    if (b.contrat.billingManagerId && !(await adminDb.collection('users').doc(b.contrat.billingManagerId).get()).exists) throw new Error('Responsable facturation inconnu.');

    // Client : existant (vérifié) ou nouveau (refusé si le SIRET est déjà celui d'un client).
    let clientId: string;
    let clientName: string;
    let clientDoc: Record<string, unknown> | null = null;
    if (b.client.mode === 'existant') {
        const c = await adminDb.collection('clients').doc(b.client.clientId).get();
        if (!c.exists) throw new Error('Client introuvable.');
        clientId = c.id;
        clientName = String(c.get('name'));
    } else {
        const n = b.client.nouveau;
        const siret = n.siret.replace(/\s/g, '');
        if (siret) {
            const meme = await adminDb.collection('clients').where('siret', '==', siret).limit(1).get();
            if (!meme.empty) throw new Error(`Un client a déjà le SIRET ${siret} : ${meme.docs[0].get('name')} (${meme.docs[0].get('externalCode') ?? meme.docs[0].id}). Choisissez-le à l'étape Client.`);
        }
        const [code] = await reserveCodes('clients', 1);
        clientId = adminDb.collection('clients').doc().id;
        clientName = n.name.trim();
        clientDoc = {
            name: clientName, externalCode: code, clientType: n.clientType, relation: 'client', typologyId: n.typologyId,
            companyId: n.companyId, agencyId: n.agencyId, sectorId: n.sectorId,
            address: n.address.trim(), postalCode: n.postalCode.trim(), city: n.city.trim(),
            ...(siret && { siret }), ...(n.representedBy.trim() && { representedBy: n.representedBy.trim() }),
            useChorus: n.clientType === 'public',
            createdAt: new Date().toISOString(), createdBy: user.email,
        };
    }

    // Sites existants : du client et sans contrat (un site ne change pas de contrat ici).
    const existants = b.sites.existants.length ? await adminDb.getAll(...b.sites.existants.map(id => adminDb.collection('sites').doc(id))) : [];
    for (const s of existants) {
        if (!s.exists || s.get('clientId') !== clientId) throw new Error('Un site choisi n\'appartient pas au client.');
        if (s.get('contractId')) throw new Error(`Le site ${s.get('name')} est déjà rattaché à un contrat.`);
    }

    const contractRef = adminDb.collection('contracts').doc();
    const [contractNumber] = await reserveCodes('contracts', 1);
    const codesSites = await reserveCodes('sites', b.sites.nouveaux.length);
    const nouveauxSites = b.sites.nouveaux.map((s, i) => ({ cle: s.cle, ref: adminDb.collection('sites').doc(), code: codesSites[i], s }));
    const siteIdDe = (cle: string) => nouveauxSites.find(x => x.cle === cle)?.ref.id ?? cle;
    const siteIds = [...b.sites.existants, ...nouveauxSites.map(x => x.ref.id)];
    const c = b.contrat;
    const maintenant = new Date().toISOString();

    const batch = adminDb.batch();
    if (clientDoc) {
        batch.set(adminDb.collection('clients').doc(clientId), clientDoc);
        const cf = b.client.nouveau.contactFacturation;
        if (cf.name.trim() || cf.email.trim()) {
            batch.set(adminDb.collection('contacts').doc(), {
                clientId, type: 'facturation', name: cf.name.trim() || cf.email.trim(),
                ...(cf.email.trim() && { email: cf.email.trim() }), ...(cf.phone.trim() && { phone: cf.phone.trim() }),
            });
        }
    }
    batch.set(contractRef, {
        contractNumber, clientId, clientName, label: c.label.trim(), name: `${clientName} - ${c.label.trim()}`,
        startDate: Timestamp.fromDate(new Date(c.startDate)), endDate: Timestamp.fromDate(new Date(c.endDate)),
        activityIds: c.activityIds, siteIds, invoicingType: c.invoicingType,
        ...(c.marketType && { marketType: c.marketType }),
        ...(c.scheduleId && existe(schedules, c.scheduleId) && { billingSchedule: schedules.docs.find(d => d.id === c.scheduleId)!.get('name') }),
        renewal: c.renewal, tacitRenewal: c.tacitRenewal,
        ...(c.renewalDuration.trim() && { renewalDuration: c.renewalDuration.trim() }), ...(c.noticePeriod.trim() && { noticePeriod: c.noticePeriod.trim() }),
        ...(c.billingManagerId && { billingManagerId: c.billingManagerId }),
        ...(b.document?.url && /^https:\/\//.test(b.document.url) && { documents: [{ name: b.document.name, type: 'Contrat signé', url: b.document.url }] }),
        status: 'Brouillon', validationStatus: 'pending_validation',
        createdAt: maintenant, createdBy: user.email, requesterEmail: user.email, source: b.source === 'saisie' ? 'assistant' : `assistant (${b.source})`,
    });
    for (const { ref, code, s } of nouveauxSites) {
        batch.set(ref, {
            code, name: s.name.trim(), address: s.address.trim(), postalCode: s.postalCode.trim(), city: s.city.trim(),
            clientId, clientName, contractId: contractRef.id, createdAt: maintenant,
        });
    }
    for (const s of existants) batch.update(s.ref, { contractId: contractRef.id, clientName });

    // Prestations renseignées (montant) : site × activité du contrat.
    const sitesAvecPrestation = new Set<string>();
    if (b.prestations.saisir) {
        for (const l of b.prestations.lignes) {
            if (!l.montant.trim()) continue;
            const siteId = siteIdDe(l.site);
            const activite = activites.get(l.activityId);
            if (!siteIds.includes(siteId) || !activite || !c.activityIds.includes(l.activityId)) throw new Error('Prestation sur un site ou une activité hors du contrat.');
            if (!existe(schedules, l.scheduleId) || !existe(terms, l.termId) || !existe(vatRates, l.vatRateId)) throw new Error('Périodicité, terme ou TVA inconnu : rechargez la page.');
            batch.set(adminDb.collection('services').doc(), {
                contractId: contractRef.id, siteId, activityId: l.activityId, type: activite.type, label: activite.label ?? activite.code,
                price: montantNombre(l.montant), startDate: l.startDate, scheduleId: l.scheduleId, billingTermId: l.termId, vatRateId: l.vatRateId,
                isActive: true, createdAt: maintenant,
            });
            sitesAvecPrestation.add(siteId);
        }
    }
    await batch.commit();
    // Montants des sites calculés à partir de leurs prestations (source unique de la facturation).
    if (sitesAvecPrestation.size) await recomputeSiteAmounts([...sitesAvecPrestation]);
    return { contractId: contractRef.id, contractNumber, clientId, siteIds };
}
