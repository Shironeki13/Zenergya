
'use server';
import { db } from '@/lib/firebase';
import type { Client, Site, Contract, Invoice, MeterReading, Company, Agency, Sector, Activity, User, Role, Schedule, Term, Typology, VatRate, RevisionFormula, PaymentTerm, PricingRule, Market } from '@/lib/types';
import { collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, where, DocumentData, writeBatch, runTransaction, Timestamp } from 'firebase/firestore';

// --- Helper function to convert Firestore Timestamps ---
function convertTimestamps<T extends DocumentData>(data: T): T {
    const newData = { ...data };
    for (const key in newData) {
        if (newData[key] instanceof Timestamp) {
            newData[key] = newData[key].toDate().toISOString();
        } else if (typeof newData[key] === 'object' && newData[key] !== null && !Array.isArray(newData[key])) {
            newData[key] = convertTimestamps(newData[key]);
        } else if (Array.isArray(newData[key])) {
             newData[key] = newData[key].map(item => {
                if (typeof item === 'object' && item !== null) {
                    return convertTimestamps(item);
                }
                return item;
             });
        }
    }
    return newData;
}


// --- Fonctions de Service (Firestore) ---

// Clients
export async function getClients(): Promise<Client[]> {
    const clientsCollection = collection(db, 'clients');
    const clientSnapshot = await getDocs(clientsCollection);
    return clientSnapshot.docs.map(doc => convertTimestamps({ id: doc.id, ...doc.data() } as Client));
}

export async function getClient(id: string): Promise<Client | null> {
    const clientDoc = doc(db, 'clients', id);
    const clientSnapshot = await getDoc(clientDoc);
    if (clientSnapshot.exists()) {
        return convertTimestamps({ id: clientSnapshot.id, ...clientSnapshot.data() } as Client);
    }
    return null;
}

export async function createClient(data: Omit<Client, 'id' | 'typologyName'>) {
    const typologies = await getTypologies();
    const typologyName = typologies.find(t => t.id === data.typologyId)?.name || 'N/A';
    const clientData = { ...data, typologyName };
    const clientsCollection = collection(db, 'clients');
    const docRef = await addDoc(clientsCollection, clientData);
    return { id: docRef.id, ...clientData };
}


export async function updateClient(id: string, data: Partial<Omit<Client, 'id'>>) {
    const clientDoc = doc(db, 'clients', id);
    await updateDoc(clientDoc, data);
}

export async function deleteClient(id: string) {
    // This should also delete associated sites, contracts, invoices etc.
    // For now, simple delete.
    const clientDoc = doc(db, 'clients', id);
    await deleteDoc(clientDoc);
}


// Sites
export async function getSites(): Promise<Site[]> {
    const sitesCollection = collection(db, 'sites');
    const siteSnapshot = await getDocs(sitesCollection);
    const sites = siteSnapshot.docs.map(doc => convertTimestamps({ id: doc.id, ...doc.data() } as Site));
    
    // Pour enrichir avec le nom du client
    if (sites.length > 0) {
        const clientIds = [...new Set(sites.map(s => s.clientId))];
        const clients = await getClients();
        const clientMap = new Map(clients.map(c => [c.id, c.name]));
        return sites.map(site => ({
            ...site,
            clientName: clientMap.get(site.clientId) || 'N/A'
        }));
    }
    return [];
}


export async function getSitesByClient(clientId: string): Promise<Site[]> {
    const sitesCollection = collection(db, 'sites');
    const q = query(sitesCollection, where("clientId", "==", clientId));
    const siteSnapshot = await getDocs(q);
    return siteSnapshot.docs.map(doc => convertTimestamps({ id: doc.id, ...doc.data() } as Site));
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
    const contractsCollection = collection(db, 'contracts');
    const contractSnapshot = await getDocs(contractsCollection);
    return contractSnapshot.docs.map(doc => convertTimestamps({ id: doc.id, ...doc.data() } as Contract));
}

export async function getContractsByClient(clientId: string): Promise<Contract[]> {
    const contractsCollection = collection(db, 'contracts');
    const q = query(contractsCollection, where("clientId", "==", clientId));
    const contractSnapshot = await getDocs(q);
    return contractSnapshot.docs.map(doc => convertTimestamps({ id: doc.id, ...doc.data() } as Contract));
}


export async function getContract(id: string): Promise<Contract | null> {
    const contractDoc = doc(db, 'contracts', id);
    const contractSnapshot = await getDoc(contractDoc);
    if (contractSnapshot.exists()) {
        return convertTimestamps({ id: contractSnapshot.id, ...contractSnapshot.data() } as Contract);
    }
    return null;
}

export async function createContract(data: Omit<Contract, 'id' | 'status'>) {
    const newContractData = {
        ...data,
        status: 'pending',
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        revisionP1: data.revisionP1?.date ? { ...data.revisionP1, date: new Date(data.revisionP1.date) } : undefined,
        revisionP2: data.revisionP2?.date ? { ...data.revisionP2, date: new Date(data.revisionP2.date) } : undefined,
        revisionP3: data.revisionP3?.date ? { ...data.revisionP3, date: new Date(data.revisionP3.date) } : undefined,
    };
    const contractsCollection = collection(db, 'contracts');
    const docRef = await addDoc(contractsCollection, newContractData as any);
    return { id: docRef.id, ...newContractData };
}


// Factures
export async function getInvoices(): Promise<Invoice[]> {
    const invoicesCollection = collection(db, 'invoices');
    const invoiceSnapshot = await getDocs(invoicesCollection);
    return invoiceSnapshot.docs.map(doc => convertTimestamps({ id: doc.id, ...doc.data() } as Invoice));
}

export async function getInvoice(id: string): Promise<Invoice | null> {
    const invoiceDoc = doc(db, 'invoices', id);
    const invoiceSnapshot = await getDoc(invoiceDoc);
    if (invoiceSnapshot.exists()) {
        return convertTimestamps({ id: invoiceSnapshot.id, ...invoiceSnapshot.data() } as Invoice);
    }
    return null;
}

export async function getInvoicesByContract(contractId: string): Promise<Invoice[]> {
    const invoicesCollection = collection(db, 'invoices');
    const q = query(invoicesCollection, where("contractId", "==", contractId));
    const invoiceSnapshot = await getDocs(q);
    return invoiceSnapshot.docs.map(doc => convertTimestamps({ id: doc.id, ...doc.data() } as Invoice));
}

export async function createInvoice(data: Omit<Invoice, 'id'>) {
    const invoiceData = {
        ...data,
        date: new Date(data.date),
        dueDate: new Date(data.dueDate),
    };
    const invoicesCollection = collection(db, 'invoices');
    const docRef = await addDoc(invoicesCollection, invoiceData as any);
    return { id: docRef.id, ...invoiceData };
}

export async function getNextInvoiceNumber(): Promise<string> {
    const counterRef = doc(db, 'counters', 'invoiceCounter');

    return runTransaction(db, async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        
        let newCount = 1;
        if (counterDoc.exists()) {
            newCount = counterDoc.data().current + 1;
        }
        
        transaction.set(counterRef, { current: newCount }, { merge: true });
        
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const countPadded = String(newCount).padStart(4, '0');
        
        return `${year}${month}-${countPadded}`;
    });
}


// Relevés de compteur
export async function getMeterReadingsByContract(contractId: string): Promise<MeterReading[]> {
    const readingsCollection = collection(db, 'meterReadings');
     const q = query(readingsCollection, where("contractId", "==", contractId));
    const readingSnapshot = await getDocs(q);
    return readingSnapshot.docs.map(doc => convertTimestamps({ id: doc.id, ...doc.data() } as MeterReading));
}

// --- Fonctions de Paramétrage (Firestore) ---
async function createSettingItem(collectionName: string, data: DocumentData): Promise<any> {
    const collectionRef = collection(db, collectionName);
    const docRef = await addDoc(collectionRef, data);
    return { id: docRef.id, ...data };
}

async function getSettingItems<T extends {id: string}>(collectionName: string): Promise<T[]> {
    const collectionRef = collection(db, collectionName);
    const snapshot = await getDocs(collectionRef);
    return snapshot.docs.map(doc => convertTimestamps({ id: doc.id, ...doc.data() } as T));
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
export async function getCompany(): Promise<Company[]> {
    return getSettingItems<Company>('companies');
}
export async function updateCompany(id: string, data: Partial<Omit<Company, 'id'>>) {
     const companyData = {
        ...data,
        siren: data.siret ? data.siret.substring(0, 9) : ''
    };
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
    const agencies = await getSettingItems<Agency>('agencies');
    const companies = await getCompany();
    const companyMap = new Map(companies.map(c => [c.id, c.name]));
    return agencies.map(agency => ({
        ...agency,
        companyName: companyMap.get(agency.companyId) || 'N/A'
    }));
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
    const sectors = await getSettingItems<Sector>('sectors');
    const agencies = await getAgencies();
    const agencyMap = new Map(agencies.map(a => [a.id, a.name]));
     return sectors.map(sector => ({
        ...sector,
        agencyName: agencyMap.get(sector.agencyId) || 'N/A'
    }));
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
    return getSettingItems<Activity>('activities');
}
export async function updateActivity(id: string, data: Partial<Omit<Activity, 'id'>>) {
    return updateSettingItem('activities', id, data);
}
export async function deleteActivity(id: string) {
    return deleteSettingItem('activities', id);
}

// Échéanciers
export async function createSchedule(name: string) {
    return createSettingItem('schedules', { name });
}
export async function getSchedules(): Promise<Schedule[]> {
    return getSettingItems<Schedule>('schedules');
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
    return getSettingItems<Term>('terms');
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
    return getSettingItems<Typology>('typologies');
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
    return getSettingItems<VatRate>('vatRates');
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
    const formulas = await getSettingItems<RevisionFormula>('revisionFormulas');
    const activities = await getActivities();
    const activityMap = new Map(activities.map(a => [a.id, { code: a.code, label: a.label }]));
    return formulas.map(formula => ({
        ...formula,
        activityCode: activityMap.get(formula.activityId)?.code || 'N/A',
        activityLabel: activityMap.get(formula.activityId)?.label || 'N/A',
    }));
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
    return getSettingItems<PaymentTerm>('paymentTerms');
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
    const rules = await getSettingItems<PricingRule>('pricingRules');
    const activities = await getActivities();
    const activityMap = new Map(activities.map(a => [a.id, {code: a.code, label: a.label}]));
    return rules.map(rule => ({
        ...rule,
        activityCode: activityMap.get(rule.activityId)?.code || 'N/A',
        activityLabel: activityMap.get(rule.activityId)?.label || 'N/A',
    }));
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
    return getSettingItems<Market>('markets');
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
    return getSettingItems<Role>('roles');
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
    const users = await getSettingItems<User>('users');
    const roles = await getRoles();
    const roleMap = new Map(roles.map(r => [r.id, r.name]));
    return users.map(user => ({
        ...user,
        roleName: roleMap.get(user.roleId) || 'N/A'
    }));
}
export async function updateUser(id: string, data: Partial<Omit<User, 'id'>>) {
    return updateSettingItem('users', id, data);
}
export async function deleteUser(id: string) {
    return deleteSettingItem('users', id);
}
