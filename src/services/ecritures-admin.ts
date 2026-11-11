import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { CHAMPS_VALIDATION, valeursDocument } from '@/lib/validations';
import { adminBucket } from '@/lib/firebase-admin';
import { PerimetreError, gardePerimetre, type GardePerimetre, type ObjetPerimetre } from '@/lib/auth/perimetre-server';
import type { SessionUser } from '@/lib/auth/server';
import {
    addDoc, collection, db, deleteDoc, doc, getDoc, getDocs, query, runTransaction, updateDoc, where, writeBatch, Timestamp, type DocumentData,
} from '@/lib/firestore-compat-admin';
import { planSiteSync } from '@/lib/contracts/site-sync';
import { amountsDiffer, computeSiteAmounts, todayInParis } from '@/lib/services/site-amounts';
import { addDays, computeQuoteTotals, quoteCounterKey, quoteNumber } from '@/lib/quotes/pricing';
import type { Quote } from '@/lib/quotes/types';
import type { NewQuoteInput, QuoteDraftPatch } from '@/services/quotes';
import type { Amendment, BeChange, Client, Company, Contact, Contract, Interest, Invoice, InvoiceStatus, Meter, Renewal, Service, ServiceSettlement, Site, Termination, TrusteeChange } from '@/lib/types';

/**
 * Écritures des collections à périmètre (clients, contrats, sites, compteurs, prestations, intéressements, documents de
 * contrat, statut des factures, devis en brouillon), exécutées par le serveur à la demande du navigateur.
 *
 * - La logique (numérotation, cascades, synchronisations) est celle qui tournait dans le navigateur, reprise telle
 *   quelle grâce à la couche de compatibilité (lib/firestore-compat-admin).
 * - Chaque écriture est nommée et **contrôlée avant exécution** : périmètre de l'utilisateur (client de l'objet), et
 *   les garde-fous que portaient les règles Firestore (codes immuables, validation des contrats réservée à la
 *   contrathèque, statut des factures, brouillons de devis, documents de contrat créés « en attente »).
 */

// --- Garde-fous repris des règles Firestore ---

/** Code Zenergya (CLI-, CTN-, SIT-, CPT-) : immuable une fois attribué. */
async function codeInchange(coll: string, champ: string, id: string, data: DocumentData | undefined): Promise<void> {
    if (!data || !(champ in data)) return;
    const actuel = (await getDoc(doc(db, coll, id))).get(champ);
    if (actuel !== undefined && actuel !== null && actuel !== '' && data[champ] !== actuel) throw new Error(`Le code ${actuel} est attribué une fois pour toutes : il ne se modifie pas.`);
}

/** Utilisateur de l'écriture en cours (les fonctions reprises du navigateur ne le reçoivent pas en paramètre). */
const contexte = new AsyncLocalStorage<{ user: SessionUser }>();

/** Champs contractuels contrôlés par la contrathèque à la validation (le client ne se change pas ici). */
const CHAMPS_CONTRAT = CHAMPS_VALIDATION.contrat.filter(c => !c.fige);

/**
 * Contrat : la validation appartient à la contrathèque.
 * - **Non validé** (en attente, refusé) : il se corrige librement et peut être remis « en attente de validation », jamais
 *   marqué validé depuis l'écran ; son statut ne change pas.
 * - **Validé** (ou antérieur à la validation) : ses champs contractuels (libellé, dates, type de marché, bases marché,
 *   reconduction, préavis) ne se modifient que par la contrathèque — directement, sans nouvelle validation, puisque
 *   c'est elle qui valide — ou par un avenant ; son statut change par un document validé (résiliation) ou, à la main,
 *   par la contrathèque ou un administrateur. Ces modifications sont tracées sur le contrat.
 * - La trace de validation (qui, quand) est intouchable.
 * Renvoie les champs de trace à enregistrer avec la modification.
 */
async function validationContratIntacte(id: string, data: DocumentData | undefined): Promise<DocumentData> {
    if (!data) return {};
    const snap = await getDoc(doc(db, 'contracts', id));
    if (!snap.exists()) return {};
    const avant = snap.data(), apres = { ...avant, ...data };
    const user = contexte.getStore()?.user;
    const v = (o: DocumentData, k: string, d: unknown = null) => (o[k] === undefined ? d : o[k]);
    const memeDate = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    if (v(apres, 'validatedBy') !== v(avant, 'validatedBy') || !memeDate(apres.validatedAt, avant.validatedAt)) throw new Error('La trace de validation d\'un contrat ne se modifie pas.');
    const statutChange = v(apres, 'status') !== v(avant, 'status');
    const valide = v(avant, 'validationStatus', 'validated') === 'validated';

    if (!valide) {
        if (!(v(apres, 'validationStatus') === v(avant, 'validationStatus') || v(apres, 'validationStatus') === 'pending_validation')) throw new Error('La validation d\'un contrat est réservée à la contrathèque.');
        if (statutChange) throw new Error('Le statut d\'un contrat ne change pas tant qu\'il n\'est pas validé par la contrathèque.');
        return {};
    }

    // Contrat validé.
    const contratheque = user?.isContratheque === true;
    if (v(apres, 'validationStatus', 'validated') !== 'validated' && !contratheque) throw new Error('Un contrat validé ne se remet pas en validation : ses données contractuelles se modifient par un avenant, ou par la contrathèque.');
    const [a, b] = [valeursDocument('contrat', avant), valeursDocument('contrat', apres)];
    // Vide, « non » et zéro se valent : un champ jamais renseigné n'est pas « modifié » par un formulaire qui l'envoie vide.
    const neutre = (x: unknown) => (x === null || x === undefined || x === false || x === 0 || x === '' ? '' : JSON.stringify(x));
    const modifies = CHAMPS_CONTRAT.filter(c => c.cle in data && neutre(a[c.cle]) !== neutre(b[c.cle]));
    if (modifies.length && !contratheque) throw new Error(`Contrat validé : ${modifies.map(c => `« ${c.libelle} »`).join(', ')} ne se modifie${modifies.length > 1 ? 'nt' : ''} que par la contrathèque, ou par un avenant.`);
    if (statutChange && !contratheque && user?.isAdmin !== true) throw new Error('Le statut d\'un contrat validé change par un document validé (résiliation) ou, à la main, par la contrathèque ou un administrateur.');
    if (!modifies.length && !statutChange) return {};
    const trace = {
        par: user?.email ?? 'inconnu', le: new Date().toISOString(),
        ...(modifies.length && { champs: Object.fromEntries(modifies.map(c => [c.cle, { libelle: c.libelle, avant: a[c.cle] ?? null, apres: b[c.cle] ?? null }])) }),
        ...(statutChange && { statut: { avant: v(avant, 'status'), apres: v(apres, 'status') } }),
    };
    return { modificationsValidees: [...((avant.modificationsValidees as unknown[] | undefined) ?? []), trace] };
}

/** Supprime un fichier du stockage à partir de son adresse de téléchargement (sans bloquer l'opération en cas d'échec). */
async function deleteFileFromUrl(url: string): Promise<void> {
    try {
        const m = /\/o\/([^?]+)/.exec(String(url ?? ''));
        if (m) await adminBucket().file(decodeURIComponent(m[1])).delete();
    } catch (error) {
        console.error('Suppression du fichier impossible :', error);
    }
}

// --- Lectures internes (le serveur lit directement) ---

const getContract = (id: string) => getDocument<Contract>(doc(db, 'contracts', id));
const getContactsByClient = (clientId: string) => getCollection<Contact>(query(collection(db, 'contacts'), where('clientId', '==', clientId)));
const getContractsByClient = (clientId: string) => getCollection<Contract>(query(collection(db, 'contracts'), where('clientId', '==', clientId)));
const getSitesByClient = (clientId: string) => getCollection<Site>(query(collection(db, 'sites'), where('clientId', '==', clientId)));
const getSitesByContract = (contractId: string) => getCollection<Site>(query(collection(db, 'sites'), where('contractId', '==', contractId)));
const getQuote = (id: string) => getDocument<Quote>(doc(db, QUOTES, id));

// --- Logique d'écriture (reprise de services/firestore.ts) ---

function formatId(prefix: string, number: number): string {
    return `${prefix}-${number.toString().padStart(5, '0')}`;
}

/**
 * Gets the next sequence number for a given counter.
 * format: PREFIX-00000 (e.g., CTN-00123)
 */
async function getNextSequence(counterName: string): Promise<number> {
    const counterRef = doc(db, 'config', 'sequences');

    try {
        const newCount = await runTransaction(db, async (transaction) => {
            const counterDoc = await transaction.get(counterRef);
            let currentCount = 0;

            if (counterDoc.exists()) {
                currentCount = counterDoc.data()[counterName] || 0;
            }

            const nextCount = currentCount + 1;

            transaction.set(counterRef, { [counterName]: nextCount }, { merge: true });

            return nextCount;
        });

        return newCount;
    } catch (e) {
        console.error(`Error getting next sequence for ${counterName}:`, e);
        throw e; // Re-throw to handle in calling function
    }
}

/**
 * Crée un document et lui attribue son code (PREFIX-00001) dans une même transaction :
 * le numéro n'est consommé que si le document est écrit (ni trou, ni doublon).
 * Le code est ensuite immuable (firestore.rules).
 */
async function createWithCode(
    collectionName: string,
    counterName: string,
    prefix: string,
    data: DocumentData,
): Promise<{ id: string; code: string }> {
    const counterRef = doc(db, 'config', 'sequences');
    const docRef = doc(collection(db, collectionName));
    const code = await runTransaction(db, async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        const next = (counterDoc.exists() ? counterDoc.data()[counterName] || 0 : 0) + 1;
        const newCode = formatId(prefix, next);
        transaction.set(counterRef, { [counterName]: next }, { merge: true });
        transaction.set(docRef, { ...data, code: newCode });
        return newCode;
    });
    return { id: docRef.id, code };
}

function processFirestoreDoc<T>(docData: DocumentData): T {
    function convert(data: any): any {
        if (data === null || data === undefined) {
            return data;
        }
        if (data instanceof Timestamp) {
            return data.toDate().toISOString();
        }
        if (Array.isArray(data)) {
            return data.map(convert);
        }
        // Ensure it's a plain object before recursing
        if (typeof data === 'object' && Object.prototype.toString.call(data) === '[object Object]' && !('_delegate' in data)) {
            const newObj: { [key: string]: any } = {};
            for (const key in data) {
                if (Object.prototype.hasOwnProperty.call(data, key)) {
                    newObj[key] = convert(data[key]);
                }
            }
            return newObj;
        }
        return data;
    }
    return JSON.parse(JSON.stringify(convert(docData)));
}

async function getDocument<T>(ref: any): Promise<T | null> {
    const docSnap = await getDoc(ref);
    if (!docSnap.exists()) {
        return null;
    }
    const data = { id: docSnap.id, ...docSnap.data() as Record<string, any> };
    return processFirestoreDoc<T>(data);
}

async function getCollection<T>(q: any): Promise<T[]> {
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => processFirestoreDoc<T>({ id: doc.id, ...doc.data() as Record<string, any> }));
}

async function createSettingItem(collectionName: string, data: DocumentData): Promise<any> {
    const collectionRef = collection(db, collectionName);
    const cleanData = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    try {
        const docRef = await addDoc(collectionRef, cleanData);
        return { id: docRef.id, ...data };
    } catch (e: any) {
        console.error(`Firestore Error in createSettingItem (${collectionName}):`, e);
        console.error('Problematic Data:', JSON.stringify(data, null, 2));
        throw e;
    }
}

async function updateSettingItem(collectionName: string, id: string, data: DocumentData): Promise<void> {
    const docRef = doc(db, collectionName, id);
    // Champ non fourni (undefined) : valeur existante conservée (Firestore refuse undefined).
    await updateDoc(docRef, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
}

async function deleteSettingItem(collectionName: string, id: string): Promise<void> {
    const docRef = doc(db, collectionName, id);
    await deleteDoc(docRef);
}

async function createClient(data: Omit<Client, 'id'>): Promise<any> {
    const clientsCollection = collection(db, 'clients');

    // Generate incremental Client Number (CLI-XXXXX)
    const seq = await getNextSequence('client');
    const clientNumber = formatId('CLI', seq);

    const dataWithId = {
        ...data,
        externalCode: clientNumber, // Force the generated ID as externalCode
    };

    // Remove undefined values as Firestore doesn't support them
    const cleanData = Object.fromEntries(
        Object.entries(dataWithId).filter(([_, value]) => value !== undefined)
    );
    const docRef = await addDoc(clientsCollection, cleanData);
    return { id: docRef.id, ...data };
}

async function updateClient(id: string, data: Partial<Omit<Client, 'id'>>) {
    await codeInchange('clients', 'externalCode', id, data);
    const clientDoc = doc(db, 'clients', id);
    const before = data.name !== undefined ? (await getDoc(clientDoc)).get('name') as string | undefined : undefined;
    await updateDoc(clientDoc, data);
    if (data.name && before !== undefined && before !== data.name) await propagateClientName(id, before, data.name);
}

/** Report d'un renommage de client sur les noms recopiés : contrats (nom « client - libellé »), sites, compteurs. */
async function propagateClientName(clientId: string, from: string, to: string) {
    const [contracts, sites] = await Promise.all([
        getDocs(query(collection(db, 'contracts'), where('clientId', '==', clientId))),
        getDocs(query(collection(db, 'sites'), where('clientId', '==', clientId))),
    ]);
    const updates: [ReturnType<typeof doc>, DocumentData][] = [];
    for (const c of contracts.docs) {
        const label = c.get('label');
        const name = String(c.get('name') ?? '');
        updates.push([c.ref, { clientName: to, ...(label ? { name: `${to} - ${label}` } : name.startsWith(from) ? { name: to + name.slice(from.length) } : {}) }]);
    }
    for (const site of sites.docs) updates.push([site.ref, { clientName: to }]);
    const siteIds = sites.docs.map(d => d.id);
    for (let i = 0; i < siteIds.length; i += 30) {
        const meters = await getDocs(query(collection(db, 'meters'), where('siteId', 'in', siteIds.slice(i, i + 30))));
        for (const m of meters.docs) updates.push([m.ref, { clientName: to }]);
    }
    for (let i = 0; i < updates.length; i += 400) {
        const batch = writeBatch(db);
        for (const [ref, values] of updates.slice(i, i + 400)) batch.update(ref, values);
        await batch.commit();
    }
}

async function deleteClient(id: string) {
    // 1. Get all associated contacts and delete them
    const contacts = await getContactsByClient(id);
    for (const contact of contacts) {
        await deleteContact(contact.id);
    }

    // 2. Get all associated sites
    const sites = await getSitesByClient(id);
    // 3. Delete all sites
    for (const site of sites) {
        await deleteSite(site.id);
    }

    // 4. Get all associated contracts
    const contracts = await getContractsByClient(id);
    // 5. Delete all contracts
    for (const contract of contracts) {
        await deleteContract(contract.id);
    }

    // 6. Delete the client
    const clientDoc = doc(db, 'clients', id);
    await deleteDoc(clientDoc);
}

async function createContact(data: Omit<Contact, 'id'>): Promise<Contact> {
    const contactsCollection = collection(db, 'contacts');
    const cleanData = Object.fromEntries(
        Object.entries(data).filter(([_, value]) => value !== undefined)
    );
    const docRef = await addDoc(contactsCollection, cleanData);
    return { id: docRef.id, ...data } as Contact;
}

async function deleteContact(id: string) {
    const contactDoc = doc(db, 'contacts', id);
    await deleteDoc(contactDoc);
}

async function createSite(data: Omit<Site, 'id' | 'code'>) {
    const cleanData = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    // Code Zenergya du site (SIT-XXXXX), attribué avec la création
    const { id, code } = await createWithCode('sites', 'site', 'SIT', cleanData);
    return { id, ...data, code };
}

async function updateSite(id: string, data: Partial<Omit<Site, 'id'>>) {
    await codeInchange('sites', 'code', id, data);
    const siteDoc = doc(db, 'sites', id);
    await updateDoc(siteDoc, data);
}

async function deleteSite(id: string) {
    const siteDoc = doc(db, 'sites', id);
    await deleteDoc(siteDoc);
}

async function batchCreateSites(
    contractId: string,
    clientId: string,
    sitesData: Omit<Site, 'id' | 'contractId' | 'clientId'>[]
): Promise<{ created: number; ids: string[] }> {
    const ids: string[] = [];
    for (const siteData of sitesData) {
        const created = await createSite({
            ...siteData,
            contractId,
            clientId,
        } as Omit<Site, 'id'>);
        ids.push(created.id);
    }
    // Update contract siteIds
    const contractDoc = doc(db, 'contracts', contractId);
    const contractSnap = await getDoc(contractDoc);
    const existingSiteIds = contractSnap.data()?.siteIds || [];
    await updateDoc(contractDoc, { siteIds: [...existingSiteIds, ...ids] });
    return { created: ids.length, ids };
}

async function updateContract(id: string, data: Partial<Omit<Contract, 'id'>>) {
    await codeInchange('contracts', 'contractNumber', id, data);
    const trace = await validationContratIntacte(id, data);
    const contractDoc = doc(db, 'contracts', id);
    const updateData: { [key: string]: any } = { ...data, ...trace };
    const revisionFields: ('revisionP1' | 'revisionP2' | 'revisionP3')[] = ['revisionP1', 'revisionP2', 'revisionP3'];
    for (const field of revisionFields) {
        if (data[field] && data[field]?.date && typeof data[field]!.date === 'string') {
            if (!updateData[field]) updateData[field] = {};
            updateData[field]!.date = new Date(data[field]!.date!);
        }
    }

    Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);
    await updateDoc(contractDoc, updateData);
}

async function deleteContract(id: string) {
    // 1. Get contract to find documents
    const contract = await getContract(id);
    if (contract && contract.documents) {
        // Delete each document
        for (const doc of contract.documents) {
            if (doc.url) {
                await deleteFileFromUrl(doc.url);
            }
        }
    }

    const contractDoc = doc(db, 'contracts', id);
    await deleteDoc(contractDoc);
}

async function updateInvoiceStatus(id: string, status: InvoiceStatus) {
    const invoiceDoc = doc(db, 'invoices', id);
    await updateDoc(invoiceDoc, { status });
}

/**
 * Supprime un proforma (sans numéro, sans valeur comptable).
 * Une facture émise ne se supprime jamais : elle s'annule par un avoir (règles Firestore en appui).
 */
async function deleteProformaInvoice(invoice: Pick<Invoice, 'id' | 'status'>) {
    if (invoice.status !== 'proforma') {
        throw new Error("Seul un proforma peut être supprimé. Une facture émise s'annule par un avoir.");
    }
    await deleteDoc(doc(db, 'invoices', invoice.id));
}

async function createMeter(data: Omit<Meter, 'id' | 'code'>) {
    const meterData = Object.fromEntries(Object.entries({
        ...data,
        lastModified: new Date().toISOString(),
    }).filter(([, v]) => v !== undefined));
    // Code Zenergya du compteur (CPT-XXXXX), attribué avec la création
    const { id, code } = await createWithCode('meters', 'meter', 'CPT', meterData);
    return { id, ...data, lastModified: meterData.lastModified as string, code };
}

async function updateMeter(id: string, data: Partial<Omit<Meter, 'id' | 'code'>>) {
    await codeInchange('meters', 'code', id, data as DocumentData);
    return updateDoc(doc(db, 'meters', id), { ...data, lastModified: new Date().toISOString() });
}

async function deleteMeter(id: string) {
    return deleteDoc(doc(db, 'meters', id));
}

/** Montants du site recalculés à partir de ses prestations (source unique de ce qui est facturé). */
async function refreshSiteAmounts(siteId?: string) {
    if (!siteId) return;
    const siteRef = doc(db, 'sites', siteId);
    const [siteSnap, servicesSnap] = await Promise.all([getDoc(siteRef), getDocs(query(collection(db, 'services'), where('siteId', '==', siteId)))]);
    if (!siteSnap.exists()) return;
    const site = { id: siteSnap.id, ...siteSnap.data() } as Site;
    const next = computeSiteAmounts(site, servicesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Service), todayInParis());
    if (next && amountsDiffer(site, next)) await updateDoc(siteRef, { ...next, amountsComputedAt: new Date().toISOString() });
}

async function createService(data: Omit<Service, 'id'>) {
    const created = await createSettingItem('services', data);
    await refreshSiteAmounts(data.siteId);
    return created;
}

async function updateService(id: string, data: Partial<Omit<Service, 'id'>>) {
    const before = (await getDoc(doc(db, 'services', id))).get('siteId') as string | undefined;
    await updateSettingItem('services', id, data);
    await refreshSiteAmounts(data.siteId ?? before);
    if (data.siteId && before && before !== data.siteId) await refreshSiteAmounts(before);
}

async function deleteService(id: string) {
    const siteId = (await getDoc(doc(db, 'services', id))).get('siteId') as string | undefined;
    await deleteSettingItem('services', id);
    await refreshSiteAmounts(siteId);
}

async function createAmendment(data: Omit<Amendment, 'id'>) {
    return createSettingItem('amendments', data);
}

async function createTermination(data: Omit<Termination, 'id'>) {
    return createSettingItem('terminations', data);
}

async function createRenewal(data: Omit<Renewal, 'id'>) {
    return createSettingItem('renewals', data);
}

async function createTrusteeChange(data: Omit<TrusteeChange, 'id'>) {
    return createSettingItem('trusteeChanges', data);
}

async function createBeChange(data: Omit<BeChange, 'id'>) {
    return createSettingItem('beChanges', data);
}

async function createInterest(data: Omit<Interest, 'id'>): Promise<any> {
    const docRef = await addDoc(collection(db, 'interests'), data);
    return { id: docRef.id, ...data };
}

async function updateInterest(id: string, data: Partial<Omit<Interest, 'id'>>) {
    await updateDoc(doc(db, 'interests', id), data);
}

async function deleteInterest(id: string) {
    await deleteDoc(doc(db, 'interests', id));
}

async function updateClientAndContract(contractId: string, clientId: string, data: any) {
    // 1. Update client fields
    await updateClient(clientId, {
        name: data.name,
        address: data.address,
        postalCode: data.postalCode,
        city: data.city,
        clientType: data.clientType,
        typologyId: data.typologyId,
        representedBy: data.representedBy,
        isBe: data.isBe,
        beName: data.beName,
        beEmail: data.beEmail,
        bePhone: data.bePhone,
        useChorus: data.useChorus,
        siret: data.siret,
        chorusServiceCode: data.chorusServiceCode,
        chorusLegalCommitmentNumber: data.chorusLegalCommitmentNumber,
        chorusMarketNumber: data.chorusMarketNumber,
        companyId: data.companyId,
        agencyId: data.agencyId,
        sectorId: data.sectorId,
    });

    // 2. Contacts technique et facturation : mis à jour en place (les autres contacts du client sont conservés).
    const existingContacts = await getContactsByClient(clientId);
    for (const [type, prefix] of [['technique', 'technicalContact'], ['facturation', 'billingContact']] as const) {
        const values = {
            name: data[`${prefix}Name`] || '',
            email: data[`${prefix}Email`] || '',
            phone: data[`${prefix}Phone`] || '',
            role: data[`${prefix}Role`] || '',
        };
        if (!values.name && !values.email && !values.phone) continue;
        const current = existingContacts.find(c => c.type === type);
        if (current) await updateDoc(doc(db, 'contacts', current.id), values);
        else await createContact({ clientId, type, ...values } as Omit<Contact, 'id'>);
    }

    // 3. Sites : mis à jour en place (même code SIT, compteurs et prestations conservés), nouveaux créés ;
    // un site retiré du formulaire n'est supprimé que s'il n'a ni compteur ni prestation.
    const existingSites = await getSitesByContract(contractId);
    const formSites: any[] = data.sites && data.sites.length > 0 ? data.sites : [];
    const sync = planSiteSync(existingSites.map(s => s.id), formSites);
    const blocked: string[] = [];
    for (const id of sync.remove) {
        const [meters, services] = await Promise.all([
            getDocs(query(collection(db, 'meters'), where('siteId', '==', id))),
            getDocs(query(collection(db, 'services'), where('siteId', '==', id))),
        ]);
        if (!meters.empty || !services.empty) {
            const site = existingSites.find(s => s.id === id);
            blocked.push(`${site?.code ?? ''} ${site?.name ?? id}`.trim());
        }
    }
    if (blocked.length) {
        throw new Error(`Site(s) retiré(s) mais encore équipé(s) de compteurs ou de prestations : ${blocked.join(', ')}. `
            + "Rattachez-les à un autre contrat ou retirez d'abord leurs compteurs et prestations.");
    }
    const siteValues = (site: any) => Object.fromEntries(Object.entries({
        clientId,
        clientName: data.name,
        name: site.name || data.name,
        address: site.address || data.address || '',
        postalCode: site.postalCode || data.postalCode,
        city: site.city || data.city,
        billingSchedule: site.billingSchedule || 'Mensuel',
        termId: site.term,
        revisionP1: site.revisionP1 ? { formula: site.revisionP1 } : undefined,
        revisionP2: site.revisionP2 ? { formula: site.revisionP2 } : undefined,
        revisionP3: site.revisionP3 ? { formula: site.revisionP3 } : undefined,
        hasHeating: site.hasHeating || false,
        hasECS: site.hasECS || false,
        hasInterest: site.hasInterest || false,
        heatingReferenceDju: site.heatingReferenceDju,
        heatingWeatherStation: site.heatingWeatherStation,
        contractualNB: site.contractualNB,
        smallQ: site.smallQ,
    }).filter(([, v]) => v !== undefined));
    const newSiteIds: string[] = [];
    for (const { id, values } of sync.update) {
        await updateSite(id, siteValues(values));
        newSiteIds.push(id);
    }
    for (const values of sync.create) {
        const created = await createSite({ contractId, ...siteValues(values) } as Omit<Site, 'id' | 'code'>);
        newSiteIds.push(created.id);
    }
    for (const id of sync.remove) await deleteSite(id);

    // 4. Update contract + reset validation status
    const etat = (await getDoc(doc(db, 'contracts', contractId))).get('validationStatus');
    const dejaValide = (etat ?? 'validated') === 'validated';
    await updateContract(contractId, {
        clientName: data.name,
        name: data.contractName,
        label: data.label,
        startDate: data.startDate instanceof Date ? data.startDate.toISOString() : data.startDate,
        endDate: data.endDate instanceof Date ? data.endDate.toISOString() : data.endDate,
        baseAmountP1: data.baseAmountP1,
        baseAmountP2: data.baseAmountP2,
        baseAmountP3: data.baseAmountP3,
        baseAmountP3R: data.baseAmountP3R,
        renewal: data.renewal,
        tacitRenewal: data.tacitRenewal,
        renewalDuration: data.renewalDuration,
        noticePeriod: data.noticePeriod,
        siteIds: newSiteIds,
        // Contrat en attente ou refusé : la correction le renvoie en validation. Contrat validé : il le reste (ses champs
        // contractuels ne changent que par la contrathèque, contrôlé dans updateContract).
        ...(dejaValide ? {} : { validationStatus: 'pending_validation', refusalReason: '' }),
    });
}

async function createSettlement(data: Omit<ServiceSettlement, 'id'>): Promise<any> {
    const docRef = await addDoc(collection(db, 'service_settlements'), data);
    return { id: docRef.id, ...data };
}

async function updateSettlement(id: string, data: Partial<Omit<ServiceSettlement, 'id'>>) {
    await updateDoc(doc(db, 'service_settlements', id), data);
}

async function deleteSettlement(id: string): Promise<void> {
    await deleteDoc(doc(db, 'service_settlements', id));
}

// --- Devis en brouillon (repris de services/quotes.ts) ---

const QUOTES = 'quotes';
const sequencesRef = () => doc(db, 'config', 'sequences');

function clean<T>(value: T): T {
    if (Array.isArray(value)) return value.map(clean) as T;
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).map(([k, v]) => [k, clean(v)]),
        ) as T;
    }
    return value;
}

async function createQuote(input: NewQuoteInput, company: Pick<Company, 'code' | 'name'>): Promise<Quote> {
    const code = company.code?.trim();
    if (!code) throw new Error(`La société « ${company.name} » n'a pas de code : il est nécessaire pour numéroter ses devis.`);
    const year = Number(input.date.slice(0, 4));
    const counter = quoteCounterKey(code, year);
    const ref = doc(collection(db, QUOTES));
    const now = new Date().toISOString();

    return runTransaction(db, async (tx) => {
        const seq = await tx.get(sequencesRef());
        const next = (seq.exists() ? seq.data()[counter] || 0 : 0) + 1;
        const quote: Omit<Quote, 'id'> = {
            ...input,
            number: quoteNumber(code, year, next),
            status: 'brouillon',
            version: 1,
            validUntil: addDays(input.date, input.validityDays),
            totals: computeQuoteTotals(input.lines, input.pricing),
            createdAt: now,
            updatedAt: now,
        };
        tx.set(sequencesRef(), { [counter]: next }, { merge: true });
        tx.set(ref, clean(quote));
        return { id: ref.id, ...quote };
    });
}

async function updateQuoteDraft(id: string, patch: QuoteDraftPatch, user?: string): Promise<Quote> {
    const ref = doc(db, QUOTES, id);
    return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Devis introuvable.');
        const current = { id: snap.id, ...snap.data() } as Quote;
        if (current.status !== 'brouillon') throw new Error("Ce devis n'est plus un brouillon : il ne peut plus être modifié.");
        const merged = { ...current, ...patch };
        const updated: Quote = {
            ...merged,
            validUntil: addDays(merged.date, merged.validityDays),
            totals: computeQuoteTotals(merged.lines, merged.pricing),
            updatedAt: new Date().toISOString(),
            ...(user && { updatedBy: user }),
        };
        const { id: _id, ...data } = updated;
        tx.set(ref, clean(data));
        return updated;
    });
}

async function deleteQuoteDraft(id: string): Promise<void> {
    const quote = await getQuote(id);
    if (!quote) return;
    if (quote.status !== 'brouillon') throw new Error("Seul un brouillon peut être supprimé ; un devis envoyé s'annule.");
    if (quote.version > 1) throw new Error("Ce devis a déjà été envoyé (version précédente archivée) : annulez-le plutôt.");
    await deleteDoc(doc(db, QUOTES, id));
}

async function createProspect(data: Omit<Client, 'id' | 'relation'>): Promise<Client> {
    const created = await createClient({ ...data, relation: 'prospect' });
    return { ...data, relation: 'prospect', id: created.id } as Client;
}

// --- Écritures nommées : contrôle (périmètre, garde-fous), puis exécution ---

type Ctx = { garde: GardePerimetre; user: SessionUser };
/* eslint-disable @typescript-eslint/no-explicit-any */
type Ecriture = { avant: (a: any[], c: Ctx) => Promise<void> | void; faire: (a: any[], c: Ctx) => Promise<unknown> };

const sur = (type: ObjetPerimetre, pos = 0) => (a: any[], c: Ctx) => c.garde.exiger(type, String(a[pos] ?? ''));
const champDe = async (coll: string, id: string, champ: string): Promise<string> => String((await getDoc(doc(db, coll, String(id ?? '-') || '-'))).get(champ) ?? '');
const NOUVEAU_CLIENT = 'Ce client (société, agence, secteur choisis)';

/** Document de contrat (avenant, OS, reconduction, résiliation, syndic, BE) : créé « en attente de validation », avec sa pièce. */
const evenement = (creer: (data: any) => Promise<unknown>): Ecriture => ({
    avant: async ([data], c) => {
        if (data?.validationStatus !== 'pending_validation') throw new Error('Un document de contrat se crée « en attente de validation » : la validation est réservée à la contrathèque.');
        if (typeof data?.documentUrl !== 'string' || !data.documentUrl) throw new Error('Pièce justificative obligatoire.');
        await c.garde.exiger('contrat', String(data?.contractId ?? ''));
    },
    faire: ([data]) => creer(data),
});
/** Intéressement ou régularisation d'une prestation : la prestation doit être dans le périmètre. */
const dePrestation = (coll: string, creer: (d: any) => Promise<unknown>, modifier: (id: string, d: any) => Promise<unknown>, supprimer: (id: string) => Promise<unknown>): [Ecriture, Ecriture, Ecriture] => [
    { avant: ([data], c) => c.garde.exiger('prestation', String(data?.serviceId ?? '')), faire: ([data]) => creer(data) },
    { avant: async ([id], c) => c.garde.exiger('prestation', await champDe(coll, id, 'serviceId')), faire: ([id, data]) => modifier(id, data) },
    { avant: async ([id], c) => c.garde.exiger('prestation', await champDe(coll, id, 'serviceId')), faire: ([id]) => supprimer(id) },
];
const [creerInteret, modifierInteret, supprimerInteret] = dePrestation('interests', createInterest, updateInterest, deleteInterest);
const [creerReglement, modifierReglement, supprimerReglement] = dePrestation('service_settlements', createSettlement, updateSettlement, deleteSettlement);
const STATUTS_ENCAISSEMENT = ['due', 'overdue', 'paid'];

export const ECRITURES = {
    createClient: { avant: ([data], c) => c.garde.exigerRattachement(data ?? {}, NOUVEAU_CLIENT), faire: ([data]) => createClient(data) },
    createProspect: { avant: ([data], c) => c.garde.exigerRattachement(data ?? {}, NOUVEAU_CLIENT), faire: ([data]) => createProspect(data) },
    updateClient: {
        avant: async ([id, data], c) => {
            await c.garde.exiger('client', String(id ?? ''));
            // Changement de société, d'agence ou de secteur : le nouveau rattachement doit rester dans le périmètre.
            if (data && ['companyId', 'agencyId', 'sectorId'].some(k => k in data)) c.garde.exigerRattachement({ ...(await getDoc(doc(db, 'clients', id))).data(), ...data }, NOUVEAU_CLIENT);
        },
        faire: ([id, data]) => updateClient(id, data),
    },
    deleteClient: { avant: sur('client'), faire: ([id]) => deleteClient(id) },
    createSite: {
        avant: ([data], c) => (data?.clientId ? c.garde.exiger('client', String(data.clientId)) : c.garde.exiger('contrat', String(data?.contractId ?? ''))),
        faire: ([data]) => createSite(data),
    },
    updateSite: { avant: sur('site'), faire: ([id, data]) => updateSite(id, data) },
    deleteSite: { avant: sur('site'), faire: ([id]) => deleteSite(id) },
    batchCreateSites: { avant: async (a, c) => { await sur('contrat', 0)(a, c); await sur('client', 1)(a, c); }, faire: ([contractId, clientId, sites]) => batchCreateSites(contractId, clientId, sites) },
    updateContract: {
        avant: async ([id, data], c) => { await c.garde.exiger('contrat', String(id ?? '')); if (data?.clientId) await c.garde.exiger('client', String(data.clientId)); },
        faire: ([id, data]) => updateContract(id, data),
    },
    updateClientAndContract: { avant: async (a, c) => { await sur('contrat', 0)(a, c); await sur('client', 1)(a, c); }, faire: ([contractId, clientId, data]) => updateClientAndContract(contractId, clientId, data) },
    /** Suivi des encaissements : seul le statut d'une facture émise et non annulée change, entre ces valeurs. */
    updateInvoiceStatus: {
        avant: async ([id, status], c) => {
            await c.garde.exiger('facture', String(id ?? ''));
            if (!STATUTS_ENCAISSEMENT.includes(status) || !STATUTS_ENCAISSEMENT.includes(await champDe('invoices', id, 'status'))) throw new Error('Seul le suivi d\'encaissement (à payer, en retard, payée) d\'une facture émise se modifie.');
        },
        faire: ([id, status]) => updateInvoiceStatus(id, status),
    },
    /** Le statut « proforma » est relu dans la base, pas celui annoncé par l'écran. */
    deleteProformaInvoice: { avant: ([invoice], c) => c.garde.exiger('facture', String(invoice?.id ?? '')), faire: async ([invoice]) => deleteProformaInvoice({ id: String(invoice.id), status: (await champDe('invoices', invoice.id, 'status')) as InvoiceStatus }) },
    createMeter: { avant: ([data], c) => c.garde.exiger('site', String(data?.siteId ?? '')), faire: ([data]) => createMeter(data) },
    updateMeter: { avant: async ([id, data], c) => { await c.garde.exiger('compteur', String(id ?? '')); if (data?.siteId) await c.garde.exiger('site', String(data.siteId)); }, faire: ([id, data]) => updateMeter(id, data) },
    deleteMeter: { avant: sur('compteur'), faire: ([id]) => deleteMeter(id) },
    createService: {
        avant: ([data], c) => (data?.contractId ? c.garde.exiger('contrat', String(data.contractId)) : c.garde.exiger('site', String(data?.siteId ?? ''))),
        faire: ([data]) => createService(data),
    },
    updateService: { avant: sur('prestation'), faire: ([id, data]) => updateService(id, data) },
    deleteService: { avant: sur('prestation'), faire: ([id]) => deleteService(id) },
    createAmendment: evenement(createAmendment), createTermination: evenement(createTermination), createRenewal: evenement(createRenewal),
    createTrusteeChange: evenement(createTrusteeChange), createBeChange: evenement(createBeChange),
    createInterest: creerInteret, updateInterest: modifierInteret, deleteInterest: supprimerInteret,
    createSettlement: creerReglement, updateSettlement: modifierReglement, deleteSettlement: supprimerReglement,
    createQuote: { avant: ([input], c) => c.garde.exiger('client', String(input?.clientId ?? '')), faire: ([input, company]) => createQuote(input, company) },
    // L'auteur de la modification est l'utilisateur connecté, pas celui annoncé par l'écran.
    updateQuoteDraft: { avant: sur('devis'), faire: ([id, patch], c) => updateQuoteDraft(id, patch, c.user.email) },
    deleteQuoteDraft: { avant: sur('devis'), faire: ([id]) => deleteQuoteDraft(id) },
} satisfies Record<string, Ecriture>;

export type NomEcriture = keyof typeof ECRITURES;

/** Dates transmises par le navigateur : `{ __date: ISO }` redevient une date (enregistrée comme avant en horodatage). */
function ranimer(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(ranimer);
    if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (typeof o.__date === 'string' && Object.keys(o).length === 1) return new Date(o.__date);
        return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, ranimer(x)]));
    }
    return v;
}

export async function ecrire(nom: string, args: unknown[], user: SessionUser): Promise<unknown> {
    if (!Object.prototype.hasOwnProperty.call(ECRITURES, nom)) throw new Error('Écriture inconnue.');
    const e: Ecriture = ECRITURES[nom as NomEcriture];
    const a = ranimer(Array.isArray(args) ? args : []) as unknown[];
    const c: Ctx = { garde: gardePerimetre(user), user };
    await e.avant(a, c);
    const r = await contexte.run({ user }, () => e.faire(a, c));
    return r === undefined ? null : processFirestoreDoc(r as DocumentData);
}

export { PerimetreError };
