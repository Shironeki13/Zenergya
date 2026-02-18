import { db } from '@/lib/firebase';
import type { Client, Site, Contract, Invoice, CreditNote, MeterReading, Company, Agency, Sector, Activity, User, Role, Schedule, Term, Typology, VatRate, RevisionFormula, PaymentTerm, PricingRule, Market, Meter, MeterType, Index, IndexValue, RevisionRule, Service, InvoiceStatus, Amendment, Termination, Renewal, TrusteeChange, BeChange, Interest, Dju, SettlementRule, ServiceSettlement, SettlementMethodType, SettlementTargetType } from '@/lib/types';
import { collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, where, DocumentData, writeBatch, runTransaction, Timestamp } from 'firebase/firestore';
import { deleteFileFromUrl } from './storage';


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

// --- Sequence Generation ---

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

export function formatId(prefix: string, number: number): string {
    return `${prefix}-${number.toString().padStart(5, '0')}`;
}


// --- Fonctions de Service (Firestore) ---

// Clients
export async function getClients(): Promise<Client[]> {
    return getCollection<Client>(collection(db, 'clients'));
}

export async function getClient(id: string): Promise<Client | null> {
    return getDocument<Client>(doc(db, 'clients', id));
}

export async function createClient(data: Omit<Client, 'id'>): Promise<any> {
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


export async function updateClient(id: string, data: Partial<Omit<Client, 'id'>>) {
    const clientDoc = doc(db, 'clients', id);
    await updateDoc(clientDoc, data);
}

export async function deleteClient(id: string) {
    // 1. Get all associated sites
    const sites = await getSitesByClient(id);
    // 2. Delete all sites
    for (const site of sites) {
        await deleteSite(site.id);
    }

    // 3. Get all associated contracts
    const contracts = await getContractsByClient(id);
    // 4. Delete all contracts
    for (const contract of contracts) {
        await deleteContract(contract.id);
    }

    // 5. Delete the client
    const clientDoc = doc(db, 'clients', id);
    await deleteDoc(clientDoc);
}


// Sites
export async function getSites(): Promise<Site[]> {
    return getCollection<Site>(collection(db, 'sites'));
}


export async function getSitesByClient(clientId: string): Promise<Site[]> {
    const q = query(collection(db, 'sites'), where("clientId", "==", clientId));
    return getCollection<Site>(q);
}
export async function getSitesByContract(contractId: string): Promise<Site[]> {
    const q = query(collection(db, 'sites'), where("contractId", "==", contractId));
    return getCollection<Site>(q);
}

export async function createSite(data: Omit<Site, 'id'>) {
    const sitesCollection = collection(db, 'sites');
    const docRef = await addDoc(sitesCollection, data);
    return { id: docRef.id, ...data };
}

export async function updateSite(id: string, data: Partial<Omit<Site, 'id'>>) {
    const siteDoc = doc(db, 'sites', id);
    await updateDoc(siteDoc, data);
}

export async function deleteSite(id: string) {
    const siteDoc = doc(db, 'sites', id);
    await deleteDoc(siteDoc);
}


// Contrats
export async function getContracts(): Promise<Contract[]> {
    return getCollection<Contract>(collection(db, 'contracts'));
}

export async function getContractsByClient(clientId: string): Promise<Contract[]> {
    const q = query(collection(db, 'contracts'), where("clientId", "==", clientId));
    return getCollection<Contract>(q);
}


export async function getContract(id: string): Promise<Contract | null> {
    return getDocument<Contract>(doc(db, 'contracts', id));
}

export async function createContract(data: Omit<Contract, 'id' | 'status' | 'validationStatus'>) {
    // Generate incremental Contract Number (CTN-XXXXX)
    const seq = await getNextSequence('contract');
    const contractNumber = formatId('CTN', seq);

    const newContractData: DocumentData = {
        ...data,
        contractNumber: contractNumber, // Force the generated ID
        status: 'Brouillon',
        validationStatus: 'pending_validation',
    };

    // Remove undefined values
    Object.keys(newContractData).forEach(key => newContractData[key] === undefined && delete newContractData[key]);
    // Convert all date strings to Date objects for Firestore
    if (data.startDate) newContractData.startDate = new Date(data.startDate);
    if (data.endDate) newContractData.endDate = new Date(data.endDate);
    if (data.revisionP1?.date) newContractData.revisionP1.date = new Date(data.revisionP1.date);
    if (data.revisionP2?.date) newContractData.revisionP2.date = new Date(data.revisionP2.date);
    if (data.revisionP3?.date) newContractData.revisionP3.date = new Date(data.revisionP3.date);

    const contractsCollection = collection(db, 'contracts');
    const docRef = await addDoc(contractsCollection, newContractData);
    return { id: docRef.id, ...newContractData };
}

export async function updateContract(id: string, data: Partial<Omit<Contract, 'id' | 'clientName'>>) {
    const contractDoc = doc(db, 'contracts', id);
    const updateData: { [key: string]: any } = { ...data };
    const revisionFields: ('revisionP1' | 'revisionP2' | 'revisionP3')[] = ['revisionP1', 'revisionP2', 'revisionP3'];
    for (const field of revisionFields) {
        if (data[field] && data[field]?.date && typeof data[field]!.date === 'string') {
            if (!updateData[field]) updateData[field] = {};
            updateData[field]!.date = new Date(data[field]!.date!);
        }
    }

    await updateDoc(contractDoc, updateData);
}

export async function deleteContract(id: string) {
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



// Factures
export async function getInvoices(): Promise<Invoice[]> {
    return getCollection<Invoice>(collection(db, 'invoices'));
}

export async function getInvoice(id: string): Promise<Invoice | null> {
    return getDocument<Invoice>(doc(db, 'invoices', id));
}

export async function getInvoicesByIds(ids: string[]): Promise<Invoice[]> {
    if (ids.length === 0) return [];
    const q = query(collection(db, 'invoices'), where('__name__', 'in', ids));
    return getCollection<Invoice>(q);
}


export async function getInvoicesByContract(contractId: string): Promise<Invoice[]> {
    const q = query(collection(db, 'invoices'), where("contractId", "==", contractId));
    return getCollection<Invoice>(q);
}

export async function createInvoice(data: Omit<Invoice, 'id'>) {
    const invoiceData = {
        ...data,
        date: new Date(data.date),
        dueDate: new Date(data.dueDate),
        periodStartDate: data.periodStartDate ? new Date(data.periodStartDate) : undefined,
        periodEndDate: data.periodEndDate ? new Date(data.periodEndDate) : undefined,
    };
    const invoicesCollection = collection(db, 'invoices');
    const docRef = await addDoc(invoicesCollection, invoiceData as any);
    return { id: docRef.id, ...invoiceData };
}

export async function updateInvoiceStatus(id: string, status: InvoiceStatus) {
    const invoiceDoc = doc(db, 'invoices', id);
    await updateDoc(invoiceDoc, { status });
}

export async function deleteInvoice(id: string) {
    const invoiceDoc = doc(db, 'invoices', id);
    await deleteDoc(invoiceDoc);
}


export async function getNextInvoiceNumber(companyCode: string): Promise<string> {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const period = `${year}${month}`;

    const counterRef = doc(db, 'counters', `invoiceCounter_${period}`);

    return runTransaction(db, async (transaction) => {
        const counterDoc = await transaction.get(counterRef);

        let newCount = 1;
        if (counterDoc.exists()) {
            newCount = counterDoc.data().current + 1;
        }

        transaction.set(counterRef, { current: newCount }, { merge: true });

        const countPadded = String(newCount).padStart(4, '0');

        return `${companyCode}-${period}-${countPadded}`;
    });
}


// Avoirs (Credit Notes)
export async function getCreditNotes(): Promise<CreditNote[]> {
    return getCollection<CreditNote>(collection(db, 'creditNotes'));
}

export async function createCreditNote(data: Omit<CreditNote, 'id' | 'creditNoteNumber'>): Promise<CreditNote> {
    const batch = writeBatch(db);

    const creditNoteNumber = await getNextCreditNoteNumber();

    const newCreditNoteData = {
        ...data,
        creditNoteNumber,
        date: new Date(data.date),
    };
    const creditNoteRef = doc(collection(db, 'creditNotes'));
    batch.set(creditNoteRef, newCreditNoteData);

    // Update status of original invoices
    for (const invoiceId of data.originalInvoiceIds) {
        const invoiceRef = doc(db, 'invoices', invoiceId);
        batch.update(invoiceRef, { status: 'cancelled' });
    }

    await batch.commit();
    // Date property in CreditNote type is string (ISO 8601)
    const returnedCreditNote: any = { id: creditNoteRef.id, ...newCreditNoteData };
    returnedCreditNote.date = newCreditNoteData.date.toISOString();

    return returnedCreditNote as CreditNote;
}

export async function getNextCreditNoteNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const counterRef = doc(db, 'counters', `creditNoteCounter_${year}`);

    return runTransaction(db, async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        let newCount = 1;
        if (counterDoc.exists()) {
            newCount = counterDoc.data().current + 1;
        }
        transaction.set(counterRef, { current: newCount }, { merge: true });
        const countPadded = String(newCount).padStart(4, '0');
        return `AV${year}-${countPadded}`;
    });
}



// Indices
export async function createIndex(data: Omit<Index, 'id'>) {
    return createSettingItem('indices', data);
}
export async function getIndices(): Promise<Index[]> {
    return getCollection<Index>(collection(db, 'indices'));
}
export async function updateIndex(id: string, data: Partial<Omit<Index, 'id'>>) {
    return updateSettingItem('indices', id, data);
}
export async function deleteIndex(id: string) {
    // 1. Delete all associated index values
    const q = query(collection(db, 'indexValues'), where("indexId", "==", id));
    const snapshot = await getDocs(q);
    const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
    await Promise.all(deletePromises);

    // 2. Delete the index itself
    return deleteSettingItem('indices', id);
}


// Valeurs d'Indices
export async function createIndexValue(data: Omit<IndexValue, 'id'>) {
    // Check for existing value for this index and period
    const q = query(
        collection(db, 'indexValues'),
        where("indexId", "==", data.indexId),
        where("period", "==", data.period)
    );
    const existingDocs = await getDocs(q);

    if (!existingDocs.empty) {
        throw new Error(`Une valeur existe déjà pour l'indice ${data.indexId} sur la période ${data.period}`);
    }

    const valueData = {
        ...data,
        lastUpdated: new Date().toISOString(),
    };
    return createSettingItem('indexValues', valueData);
}

export async function getIndexValues(): Promise<IndexValue[]> {
    return getCollection<IndexValue>(collection(db, 'indexValues'));
}

export async function getIndexValuesByIndex(indexId: string): Promise<IndexValue[]> {
    const q = query(collection(db, 'indexValues'), where("indexId", "==", indexId));
    return getCollection<IndexValue>(q);
}

export async function updateIndexValue(id: string, data: Partial<Omit<IndexValue, 'id'>>) {
    const updateData = {
        ...data,
        lastUpdated: new Date().toISOString(),
    };
    return updateSettingItem('indexValues', id, updateData);
}

export async function deleteIndexValue(id: string) {
    return deleteSettingItem('indexValues', id);
}


// Compteurs (Meters)
export async function createMeter(data: Omit<Meter, 'id' | 'code'>) {
    const meterData = {
        ...data,
        lastModified: new Date().toISOString(),
    };
    const docRef = await addDoc(collection(db, 'meters'), meterData);
    // Use the document ID as the unique code
    await updateDoc(docRef, { code: docRef.id });
    return { id: docRef.id, code: docRef.id, ...meterData };
}
export async function getMeters(): Promise<Meter[]> {
    return getCollection<Meter>(collection(db, 'meters'));
}
export async function updateMeter(id: string, data: Partial<Omit<Meter, 'id' | 'code'>>) {
    return updateDoc(doc(db, 'meters', id), { ...data, lastModified: new Date().toISOString() });
}
export async function deleteMeter(id: string) {
    return deleteDoc(doc(db, 'meters', id));
}

// Relevés de compteur
export async function getMeterReadings(): Promise<MeterReading[]> {
    return getCollection<MeterReading>(collection(db, 'meterReadings'));
}

export async function getMeterReadingsByContract(contractId: string): Promise<MeterReading[]> {
    const q = query(collection(db, 'meterReadings'), where("contractId", "==", contractId));
    return getCollection<MeterReading>(q);
}

export async function getMeterReadingsByMeter(meterId: string): Promise<MeterReading[]> {
    const q = query(collection(db, 'meterReadings'), where("meterId", "==", meterId));
    return getCollection<MeterReading>(q);
}

export async function createMeterReading(data: Omit<MeterReading, 'id'>) {
    const readingData = {
        ...data,
        date: new Date(data.date),
    };
    const docRef = await addDoc(collection(db, 'meterReadings'), readingData);
    return { id: docRef.id, ...readingData };
}



// --- Fonctions de Paramétrage (Firestore) ---
async function createSettingItem(collectionName: string, data: DocumentData): Promise<any> {
    const collectionRef = collection(db, collectionName);
    try {
        const docRef = await addDoc(collectionRef, data);
        return { id: docRef.id, ...data };
    } catch (e: any) {
        console.error(`Firestore Error in createSettingItem (${collectionName}):`, e);
        console.error('Problematic Data:', JSON.stringify(data, null, 2));
        throw e;
    }
}


async function updateSettingItem(collectionName: string, id: string, data: DocumentData): Promise<void> {
    const docRef = doc(db, collectionName, id);
    await updateDoc(docRef, data);
}

async function deleteSettingItem(collectionName: string, id: string): Promise<void> {
    const docRef = doc(db, collectionName, id);
    await deleteDoc(docRef);
}

// Sociétés
export async function createCompany(data: Omit<Company, 'id'>) {
    const companyData = {
        ...data,
        logoUrl: data.logoUrl || null,
        siren: data.siret ? data.siret.substring(0, 9) : ''
    };
    return createSettingItem('companies', companyData);
}
export async function getCompanies(): Promise<Company[]> {
    return getCollection<Company>(collection(db, 'companies'));
}
export async function updateCompany(id: string, data: Partial<Omit<Company, 'id'>>) {
    const companyData = { ...data };
    if (data.siret) {
        (companyData as Company).siren = data.siret.substring(0, 9);
    }
    return updateSettingItem('companies', id, companyData);
}
export async function deleteCompany(id: string) {
    const batch = writeBatch(db);
    const companyRef = doc(db, "companies", id);
    batch.delete(companyRef);
    const agenciesQuery = query(collection(db, "agencies"), where("companyId", "==", id));
    const agenciesSnapshot = await getDocs(agenciesQuery);
    for (const agencyDoc of agenciesSnapshot.docs) {
        const sectorsQuery = query(collection(db, "sectors"), where("agencyId", "==", agencyDoc.id));
        const sectorsSnapshot = await getDocs(sectorsQuery);
        sectorsSnapshot.forEach(sectorDoc => batch.delete(sectorDoc.ref));
        batch.delete(agencyDoc.ref);
    }
    await batch.commit();
}


// Agences
export async function createAgency(name: string, companyId: string) {
    return createSettingItem('agencies', { name, companyId });
}
export async function getAgencies(): Promise<Agency[]> {
    return getCollection<Agency>(collection(db, 'agencies'));
}
export async function updateAgency(id: string, name: string, companyId: string) {
    return updateSettingItem('agencies', id, { name, companyId });
}
export async function deleteAgency(id: string) {
    const batch = writeBatch(db);
    const agencyRef = doc(db, "agencies", id);
    batch.delete(agencyRef);
    const sectorsQuery = query(collection(db, "sectors"), where("agencyId", "==", id));
    const sectorsSnapshot = await getDocs(sectorsQuery);
    sectorsSnapshot.forEach(sectorDoc => batch.delete(sectorDoc.ref));
    await batch.commit();
}

// Secteurs
export async function createSector(name: string, agencyId: string) {
    return createSettingItem('sectors', { name, agencyId });
}
export async function getSectors(): Promise<Sector[]> {
    return getCollection<Sector>(collection(db, 'sectors'));
}
export async function updateSector(id: string, name: string, agencyId: string) {
    return updateSettingItem('sectors', id, { name, agencyId });
}
export async function deleteSector(id: string) {
    return deleteSettingItem('sectors', id);
}


// Activités
export async function createActivity(data: Omit<Activity, 'id'>) {
    return createSettingItem('activities', data);
}
export async function getActivities(): Promise<Activity[]> {
    return getCollection<Activity>(collection(db, 'activities'));
}
export async function updateActivity(id: string, data: Partial<Omit<Activity, 'id'>>) {
    return updateSettingItem('activities', id, data);
}
export async function deleteActivity(id: string) {
    return deleteSettingItem('activities', id);
}

// Types de Compteur
export async function createMeterType(data: Omit<MeterType, 'id'>) {
    return createSettingItem('meterTypes', data);
}
export async function getMeterTypes(): Promise<MeterType[]> {
    return getCollection<MeterType>(collection(db, 'meterTypes'));
}
export async function updateMeterType(id: string, data: Partial<Omit<MeterType, 'id'>>) {
    return updateSettingItem('meterTypes', id, data);
}
export async function deleteMeterType(id: string) {
    return deleteSettingItem('meterTypes', id);
}

// Échéanciers
export async function createSchedule(name: string) {
    return createSettingItem('schedules', { name });
}
export async function getSchedules(): Promise<Schedule[]> {
    return getCollection<Schedule>(collection(db, 'schedules'));
}
export async function updateSchedule(id: string, name: string) {
    return updateSettingItem('schedules', id, { name });
}
export async function deleteSchedule(id: string) {
    return deleteSettingItem('schedules', id);
}

// Termes
export async function createTerm(name: string) {
    return createSettingItem('terms', { name });
}
export async function getTerms(): Promise<Term[]> {
    return getCollection<Term>(collection(db, 'terms'));
}
export async function updateTerm(id: string, name: string) {
    return updateSettingItem('terms', id, { name });
}
export async function deleteTerm(id: string) {
    return deleteSettingItem('terms', id);
}

// Typologies
export async function createTypology(name: string) {
    return createSettingItem('typologies', { name });
}
export async function getTypologies(): Promise<Typology[]> {
    return getCollection<Typology>(collection(db, 'typologies'));
}
export async function updateTypology(id: string, name: string) {
    return updateSettingItem('typologies', id, { name });
}
export async function deleteTypology(id: string) {
    return deleteSettingItem('typologies', id);
}

// Taux TVA
export async function createVatRate(code: string, rate: number) {
    return createSettingItem('vatRates', { code, rate });
}
export async function getVatRates(): Promise<VatRate[]> {
    return getCollection<VatRate>(collection(db, 'vatRates'));
}
export async function updateVatRate(id: string, data: { code: string, rate: number }) {
    return updateSettingItem('vatRates', id, data);
}
export async function deleteVatRate(id: string) {
    return deleteSettingItem('vatRates', id);
}

// Formules de Révision
export async function createRevisionFormula(data: Omit<RevisionFormula, 'id' | 'activityCode' | 'activityLabel'>) {
    return createSettingItem('revisionFormulas', data);
}
export async function getRevisionFormulas(): Promise<RevisionFormula[]> {
    return getCollection<RevisionFormula>(collection(db, 'revisionFormulas'));
}
export async function updateRevisionFormula(id: string, data: Partial<Omit<RevisionFormula, 'id' | 'activityCode' | 'activityLabel'>>) {
    return updateSettingItem('revisionFormulas', id, data);
}
export async function deleteRevisionFormula(id: string) {
    return deleteSettingItem('revisionFormulas', id);
}

// Règlements
export async function createPaymentTerm(data: Omit<PaymentTerm, 'id'>) {
    return createSettingItem('paymentTerms', data);
}
export async function getPaymentTerms(): Promise<PaymentTerm[]> {
    return getCollection<PaymentTerm>(collection(db, 'paymentTerms'));
}
export async function updatePaymentTerm(id: string, data: Partial<Omit<PaymentTerm, 'id'>>) {
    return updateSettingItem('paymentTerms', id, data);
}
export async function deletePaymentTerm(id: string) {
    return deleteSettingItem('paymentTerms', id);
}

// Règles de prix
export async function createPricingRule(data: Omit<PricingRule, 'id' | 'activityCode' | 'activityLabel'>) {
    return createSettingItem('pricingRules', data);
}
export async function getPricingRules(): Promise<PricingRule[]> {
    return getCollection<PricingRule>(collection(db, 'pricingRules'));
}
export async function updatePricingRule(id: string, data: Partial<Omit<PricingRule, 'id' | 'activityCode' | 'activityLabel'>>) {
    return updateSettingItem('pricingRules', id, data);
}
export async function deletePricingRule(id: string) {
    return deleteSettingItem('pricingRules', id);
}

// Marchés
export async function createMarket(data: Omit<Market, 'id'>) {
    return createSettingItem('markets', data);
}
export async function getMarkets(): Promise<Market[]> {
    return getCollection<Market>(collection(db, 'markets'));
}
export async function updateMarket(id: string, data: Partial<Omit<Market, 'id'>>) {
    return updateSettingItem('markets', id, data);
}
export async function deleteMarket(id: string) {
    return deleteSettingItem('markets', id);
}



// Règles de révision
export async function createRevisionRule(data: Omit<RevisionRule, 'id'>) {
    return createSettingItem('revisionRules', data);
}
export async function getRevisionRules(): Promise<RevisionRule[]> {
    return getCollection<RevisionRule>(collection(db, 'revisionRules'));
}
export async function updateRevisionRule(id: string, data: Partial<Omit<RevisionRule, 'id'>>) {
    return updateSettingItem('revisionRules', id, data);
}
export async function deleteRevisionRule(id: string) {
    return deleteSettingItem('revisionRules', id);
}

// Prestations (Services)
export async function createService(data: Omit<Service, 'id'>) {
    return createSettingItem('services', data);
}
export async function getServices(): Promise<Service[]> {
    return getCollection<Service>(collection(db, 'services'));
}
export async function getServicesBySite(siteId: string): Promise<Service[]> {
    const q = query(collection(db, 'services'), where("siteId", "==", siteId));
    return getCollection<Service>(q);
}
export async function getServicesByContract(contractId: string): Promise<Service[]> {
    const q = query(collection(db, 'services'), where("contractId", "==", contractId));
    return getCollection<Service>(q);
}
export async function updateService(id: string, data: Partial<Omit<Service, 'id'>>) {
    return updateSettingItem('services', id, data);
}
export async function deleteService(id: string) {
    return deleteSettingItem('services', id);
}

// --- Fonctions de Gestion des Utilisateurs (Firestore) ---

// Rôles
export async function createRole(name: string) {
    return createSettingItem('roles', { name });
}
export async function getRoles(): Promise<Role[]> {
    return getCollection<Role>(collection(db, 'roles'));
}
export async function updateRole(id: string, name: string) {
    return updateSettingItem('roles', id, { name });
}
export async function deleteRole(id: string) {
    return deleteSettingItem('roles', id);
}

// Utilisateurs
export async function createUser(data: Omit<User, 'id'>) {
    return createSettingItem('users', data);
}
export async function getUsers(): Promise<User[]> {
    return getCollection<User>(collection(db, 'users'));
}
export async function updateUser(id: string, data: Partial<Omit<User, 'id'>>) {
    return updateSettingItem('users', id, data);
}
export async function deleteUser(id: string) {
    return deleteSettingItem('users', id);
}





// Avenants
export async function createAmendment(data: Omit<Amendment, 'id'>) {
    return createSettingItem('amendments', data);
}
export async function getAmendments(): Promise<Amendment[]> {
    return getCollection<Amendment>(collection(db, 'amendments'));
}
export async function getAmendmentsByContract(contractId: string): Promise<Amendment[]> {
    const q = query(collection(db, 'amendments'), where("contractId", "==", contractId));
    return getCollection<Amendment>(q);
}
export async function updateAmendment(id: string, data: Partial<Omit<Amendment, 'id'>>) {
    return updateSettingItem('amendments', id, data);
}
export async function deleteAmendment(id: string) {
    return deleteSettingItem('amendments', id);
}

// Résiliations
export async function createTermination(data: Omit<Termination, 'id'>) {
    return createSettingItem('terminations', data);
}
export async function getTerminations(): Promise<Termination[]> {
    return getCollection<Termination>(collection(db, 'terminations'));
}
export async function getTerminationsByContract(contractId: string): Promise<Termination[]> {
    const q = query(collection(db, 'terminations'), where("contractId", "==", contractId));
    return getCollection<Termination>(q);
}
export async function updateTermination(id: string, data: Partial<Omit<Termination, 'id'>>) {
    return updateSettingItem('terminations', id, data);
}
export async function deleteTermination(id: string) {
    return deleteSettingItem('terminations', id);
}

// Reconductions
export async function createRenewal(data: Omit<Renewal, 'id'>) {
    return createSettingItem('renewals', data);
}
export async function getRenewals(): Promise<Renewal[]> {
    return getCollection<Renewal>(collection(db, 'renewals'));
}
export async function getRenewalsByContract(contractId: string): Promise<Renewal[]> {
    const q = query(collection(db, 'renewals'), where("contractId", "==", contractId));
    return getCollection<Renewal>(q);
}
export async function updateRenewal(id: string, data: Partial<Omit<Renewal, 'id'>>) {
    return updateSettingItem('renewals', id, data);
}
export async function deleteRenewal(id: string) {
    return deleteSettingItem('renewals', id);
}

// Changements de Syndic
export async function createTrusteeChange(data: Omit<TrusteeChange, 'id'>) {
    return createSettingItem('trusteeChanges', data);
}
export async function getTrusteeChanges(): Promise<TrusteeChange[]> {
    return getCollection<TrusteeChange>(collection(db, 'trusteeChanges'));
}
export async function getTrusteeChangesByContract(contractId: string): Promise<TrusteeChange[]> {
    const q = query(collection(db, 'trusteeChanges'), where("contractId", "==", contractId));
    return getCollection<TrusteeChange>(q);
}
export async function updateTrusteeChange(id: string, data: Partial<Omit<TrusteeChange, 'id'>>) {
    return updateSettingItem('trusteeChanges', id, data);
}
export async function deleteTrusteeChange(id: string) {
    return deleteSettingItem('trusteeChanges', id);
}

// Changements de BE
export async function createBeChange(data: Omit<BeChange, 'id'>) {
    return createSettingItem('beChanges', data);
}
export async function getBeChanges(): Promise<BeChange[]> {
    return getCollection<BeChange>(collection(db, 'beChanges'));
}
export async function getBeChangesByContract(contractId: string): Promise<BeChange[]> {
    const q = query(collection(db, 'beChanges'), where("contractId", "==", contractId));
    return getCollection<BeChange>(q);
}

// Interest
export async function getInterests(): Promise<Interest[]> {
    return getCollection<Interest>(collection(db, 'interests'));
}

export async function getInterestsByService(serviceId: string): Promise<Interest[]> {
    const q = query(collection(db, 'interests'), where("serviceId", "==", serviceId));
    return getCollection<Interest>(q);
}

export async function createInterest(data: Omit<Interest, 'id'>): Promise<any> {
    const docRef = await addDoc(collection(db, 'interests'), data);
    return { id: docRef.id, ...data };
}

export async function updateInterest(id: string, data: Partial<Omit<Interest, 'id'>>) {
    await updateDoc(doc(db, 'interests', id), data);
}

export async function deleteInterest(id: string) {
    await deleteDoc(doc(db, 'interests', id));
}

// DJU
export async function getDjus(): Promise<Dju[]> {
    return getCollection<Dju>(collection(db, 'djus'));
}

export async function getWeatherStations(): Promise<{ code: string, name: string }[]> {
    const djus = await getDjus();
    const stations = new Map<string, string>(); // code -> name
    djus.forEach(d => {
        if (!stations.has(d.stationCode)) {
            stations.set(d.stationCode, d.stationName);
        }
    });
    return Array.from(stations.entries()).map(([code, name]) => ({ code, name }));
}

export async function getDjuTotal(stationCode: string, startDate: string, endDate: string): Promise<number> {
    const q = query(
        collection(db, 'djus'),
        where("stationCode", "==", stationCode),
        where("date", ">=", startDate),
        where("date", "<=", endDate)
    );
    // Note: This query assumes simple date string comparison works (true for YYYY-MM-DD)
    const snapshot = await getDocs(q);
    let total = 0;
    snapshot.forEach(doc => {
        const d = processFirestoreDoc<Dju>(doc.data());
        total += d.value;
    });
    return total;
}

export async function createDju(data: Omit<Dju, 'id'>): Promise<any> {
    const docRef = await addDoc(collection(db, 'djus'), data);
    return { id: docRef.id, ...data };
}

// Relevés de Compteurs (Suite)
export async function updateBeChange(id: string, data: Partial<Omit<BeChange, 'id'>>) {
    return updateSettingItem('beChanges', id, data);
}
export async function deleteBeChange(id: string) {
    return deleteSettingItem('beChanges', id);
}

// Orchestration
export async function createClientAndContract(data: any) {

    // 1. Separate Client and Contract data
    const clientData: Omit<Client, 'id'> = {
        name: data.name,
        address: data.address,
        postalCode: data.postalCode,
        city: data.city,
        clientType: data.clientType,
        typologyId: data.typologyId,
        representedBy: data.representedBy,
        externalCode: data.externalCode,
        isBe: data.isBe,
        beName: data.beName,
        beEmail: data.beEmail,
        bePhone: data.bePhone,
        useChorus: data.useChorus,
        siret: data.siret,
        chorusServiceCode: data.chorusServiceCode,
        chorusLegalCommitmentNumber: data.chorusLegalCommitmentNumber,
        chorusMarketNumber: data.chorusMarketNumber,
        // invoicingType moved to Contract
        // documents moved to Contract

        // Hierarchy
        companyId: data.companyId,
        agencyId: data.agencyId,
        sectorId: data.sectorId,
        // Contacts
        technicalContactName: data.technicalContactName,
        technicalContactEmail: data.technicalContactEmail,
        technicalContactPhone: data.technicalContactPhone,
        billingContactName: data.billingContactName,
        billingContactEmail: data.billingContactEmail,
        billingContactPhone: data.billingContactPhone,
        renewal: data.renewal,
        tacitRenewal: data.tacitRenewal,
        renewalDuration: data.renewalDuration,
        noticePeriod: data.noticePeriod,
    };

    // 2. Create Client
    const newClient = await createClient(clientData);

    // 3. Prepare Contract data
    const contractData: Omit<Contract, 'id' | 'status' | 'validationStatus'> = {
        clientId: newClient.id,
        clientName: newClient.name,
        siteIds: [], // Initial empty list
        startDate: data.startDate,
        endDate: data.endDate,
        billingSchedule: 'Mensuel', // Default
        term: data.term || 'Echu',
        activityIds: data.activityIds || [],
        activitiesDetails: data.activitiesDetails || [],
        invoicingType: data.invoicingType || 'multi-site',

        // New Contract Fields
        name: data.contractName, // Contract Name
        label: data.label,
        contractNumber: data.contractNumber,
        baseAmountP1: data.baseAmountP1,
        baseAmountP2: data.baseAmountP2,
        baseAmountP3: data.baseAmountP3,
        baseAmountP3R: data.baseAmountP3R,
        revisionP1: data.revisionP1 ? { formula: data.revisionP1 } : undefined,
        revisionP2: data.revisionP2 ? { formula: data.revisionP2 } : undefined,
        revisionP3: data.revisionP3 ? { formula: data.revisionP3 } : undefined,
        heatingReferenceDju: data.heatingReferenceDju,
        heatingWeatherStation: data.heatingWeatherStation,
        hasInterest: data.hasInterest || false,
        hasHeating: data.hasHeating || false,
        hasECS: data.hasECS || false,
        contractualNB: data.contractualNB,
        smallQ: data.smallQ,

        // Renewal (also on Client, but good to have on Contract if needed in future)
        renewal: data.renewal || false,
        tacitRenewal: data.tacitRenewal || false,
        renewalDuration: data.renewalDuration,
        noticePeriod: data.noticePeriod,

        documents: data.documents || [],
    };

    // 4. Create Contract
    const newContract = await createContract(contractData);

    return { client: newClient, contract: newContract };
}

// Relevés de Compteurs (Suite)
export async function updateMeterReading(id: string, data: Partial<Omit<MeterReading, 'id'>>) {
    return updateSettingItem('meterReadings', id, data);
}
export async function deleteMeterReading(id: string) {
    return deleteSettingItem('meterReadings', id);
}

// --- Settlement System Functions ---

export async function getSettlementRules(): Promise<SettlementRule[]> {
    return getCollection<SettlementRule>(collection(db, 'settlement_rules'));
}

export async function createSettlementRule(data: Omit<SettlementRule, 'id'>): Promise<any> {
    const docRef = await addDoc(collection(db, 'settlement_rules'), data);
    return { id: docRef.id, ...data };
}

export async function getSettlementsByService(serviceId: string): Promise<ServiceSettlement[]> {
    const q = query(collection(db, 'service_settlements'), where("serviceId", "==", serviceId));
    // Since service_settlements can be complex, ensure processFirestoreDoc handles strictly
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => processFirestoreDoc<ServiceSettlement>({ id: doc.id, ...doc.data() as Record<string, any> }));
}

export async function createSettlement(data: Omit<ServiceSettlement, 'id'>): Promise<any> {
    const docRef = await addDoc(collection(db, 'service_settlements'), data);
    return { id: docRef.id, ...data };
}

export async function updateSettlement(id: string, data: Partial<Omit<ServiceSettlement, 'id'>>) {
    await updateDoc(doc(db, 'service_settlements', id), data);
}

export async function deleteSettlement(id: string): Promise<void> {
    await deleteDoc(doc(db, 'service_settlements', id));
}

export async function initializeSettlementRules() {
    const existing = await getSettlementRules();
    if (existing.length > 0) return;

    const defaults: Omit<SettlementRule, 'id'>[] = [
        { code: 'CONSO_REELLE', label: 'Consommation Réelle (P1)', description: 'Basé sur index compteur début/fin x Coeff en vigueur. Facture = (Conso x PU).', targetType: 'P1', isActive: true },
        { code: 'PRORATA_JOURS', label: 'Prorata Temporis (Jours)', description: 'Montant Ref x (Jours Période / Jours Année)', targetType: null, isActive: true },
        { code: 'PRORATA_MOIS', label: 'Prorata Temporis (Mois)', description: 'Montant Ref x (Mois Période / 12)', targetType: null, isActive: true },
        { code: 'FORFAIT_FIXE', label: 'Forfait Fixe / Solde', description: 'Montant libre saisi manuellement à la fin.', targetType: null, isActive: true },
        { code: 'ECHEANCIER', label: 'Solde Echéancier', description: 'Total Annuel - Somme des échéances facturées', targetType: 'P3', isActive: true },
    ];

    for (const d of defaults) {
        await createSettlementRule(d);
    }
}
