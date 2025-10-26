
'use server';
import { db } from '@/lib/firebase';
import type { Client, Site, Contract, Invoice, CreditNote, MeterReading, Company, Agency, Sector, Activity, User, Role, Schedule, Term, Typology, VatRate, RevisionFormula, PaymentTerm, PricingRule, Market, Meter, MeterType } from '@/lib/types';
import { collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, where, DocumentData, writeBatch, runTransaction, Timestamp } from 'firebase/firestore';

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
    const data = { id: docSnap.id, ...docSnap.data() };
    return processFirestoreDoc<T>(data);
}

async function getCollection<T>(q: any): Promise<T[]> {
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => processFirestoreDoc<T>({ id: doc.id, ...doc.data() }));
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
    const docRef = await addDoc(clientsCollection, data);
    return { id: docRef.id, ...data };
}


export async function updateClient(id: string, data: Partial<Omit<Client, 'id'>>) {
    const clientDoc = doc(db, 'clients', id);
    await updateDoc(clientDoc, data);
}

export async function deleteClient(id: string) {
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

export async function createContract(data: Omit<Contract, 'id' | 'status'>) {
    const newContractData: DocumentData = {
        ...data,
        status: 'Actif',
    };
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

export async function updateContract(id: string, data: Partial<Omit<Contract, 'id' | 'clientName' | 'status'>>) {
    const contractDoc = doc(db, 'contracts', id);
    const updateData: { [key: string]: any } = { ...data };

    if (data.startDate && typeof data.startDate === 'string') {
        updateData.startDate = new Date(data.startDate);
    } else if (data.startDate) {
        updateData.startDate = data.startDate;
    }
    
    if (data.endDate && typeof data.endDate === 'string') {
        updateData.endDate = new Date(data.endDate);
    } else if (data.endDate) {
        updateData.endDate = data.endDate;
    }

    const revisionFields: ('revisionP1' | 'revisionP2' | 'revisionP3')[] = ['revisionP1', 'revisionP2', 'revisionP3'];
    for (const field of revisionFields) {
        if (data[field] && data[field]?.date && typeof data[field]!.date === 'string') {
             if (!updateData[field]) updateData[field] = {};
             updateData[field]!.date = new Date(data[field]!.date!);
        }
    }
    
    await updateDoc(contractDoc, updateData);
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
    return { id: creditNoteRef.id, ...newCreditNoteData };
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
    const docRef = await addDoc(collectionRef, data);
    return { id: docRef.id, ...data };
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

    
