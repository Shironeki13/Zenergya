

'use server';
import { db } from '@/lib/firebase';
import type { Client, Site, Contract, Invoice, MeterReading, Company, Agency, Sector, Activity, User, Role, Schedule, Term, Typology, VatRate, RevisionFormula, PaymentTerm, PricingRule, Market, Meter } from '@/lib/types';
import { collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, where, DocumentData, writeBatch, runTransaction, Timestamp, deleteField } from 'firebase/firestore';

// --- Helper function to convert Firestore Timestamps ---
function processFirestoreDoc<T>(docData: DocumentData): T {
    // Step 1: Recursively convert Timestamps to ISO strings
    function convert(data: any): any {
        if (data instanceof Timestamp) {
            return data.toDate().toISOString();
        }
        if (Array.isArray(data)) {
            return data.map(convert);
        }
        if (data !== null && typeof data === 'object' && Object.getPrototypeOf(data) === Object.prototype) {
            const newObj: { [key: string]: any } = {};
            for (const key in data) {
                newObj[key] = convert(data[key]);
            }
            return newObj;
        }
        return data;
    }
    const converted = convert(docData);

    // Step 2: Ensure the object is a plain JavaScript object by serializing and deserializing
    // This removes any class instances or complex prototypes.
    return JSON.parse(JSON.stringify(converted));
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
    const updateData = { ...data };
    
    // Ensure typologyName is updated if typologyId changes
    if (data.typologyId) {
        const typologies = await getTypologies();
        updateData.typologyName = typologies.find(t => t.id === data.typologyId)?.name || 'N/A';
    }

    await updateDoc(clientDoc, updateData);
}

export async function deleteClient(id: string) {
    // This should also delete associated sites, contracts, invoices etc.
    // For now, simple delete.
    const clientDoc = doc(db, 'clients', id);
    await deleteDoc(clientDoc);
}


// Sites
export async function getSites(): Promise<Site[]> {
    const sites = await getCollection<Site>(collection(db, 'sites'));
    
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
    const newContractData = {
        ...data,
        status: 'pending',
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        revisionP1: data.revisionP1?.date ? { ...data.revisionP1, date: new Date(data.revisionP1.date) } : data.revisionP1,
        revisionP2: data.revisionP2?.date ? { ...data.revisionP2, date: new Date(data.revisionP2.date) } : data.revisionP2,
        revisionP3: data.revisionP3?.date ? { ...data.revisionP3, date: new Date(data.revisionP3.date) } : data.revisionP3,
    };
    const contractsCollection = collection(db, 'contracts');
    const docRef = await addDoc(contractsCollection, newContractData as any);
    return { id: docRef.id, ...newContractData };
}

export async function updateContract(id: string, data: Partial<Omit<Contract, 'id' | 'clientName' | 'status'>>) {
    const contractDoc = doc(db, 'contracts', id);
    
    // Create a copy to mutate
    const updateData: DocumentData = {
        ...data,
        startDate: new Date(data.startDate as Date),
        endDate: new Date(data.endDate as Date),
    };

    // Handle revision fields to avoid sending `undefined` to Firestore
    const revisionFields: ('revisionP1' | 'revisionP2' | 'revisionP3')[] = ['revisionP1', 'revisionP2', 'revisionP3'];
    for (const field of revisionFields) {
        if (field in data) {
            const revisionData = data[field];
            if (revisionData) {
                 updateData[field] = {
                    ...(revisionData.formulaId && { formulaId: revisionData.formulaId }),
                    ...(revisionData.date && { date: new Date(revisionData.date) }),
                 };
                 // If the object becomes empty, remove it
                 if (Object.keys(updateData[field]).length === 0 || !updateData[field].formulaId) {
                    updateData[field] = deleteField();
                 }
            } else {
                updateData[field] = deleteField();
            }
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

export async function getInvoicesByContract(contractId: string): Promise<Invoice[]> {
    const q = query(collection(db, 'invoices'), where("contractId", "==", contractId));
    return getCollection<Invoice>(q);
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


// Compteurs (Meters)
export async function createMeter(data: Omit<Meter, 'id'>) {
    return createSettingItem('meters', { ...data, lastModified: Timestamp.now() });
}
export async function getMeters(): Promise<Meter[]> {
    const meters = await getSettingItems<Meter>('meters');
    const sites = await getSites();
    const siteMap = new Map(sites.map(s => [s.id, s.name]));
    return meters.map(meter => ({
        ...meter,
        siteName: siteMap.get(meter.siteId) || 'N/A'
    }));
}
export async function updateMeter(id: string, data: Partial<Omit<Meter, 'id'>>) {
    return updateSettingItem('meters', id, { ...data, lastModified: Timestamp.now() });
}
export async function deleteMeter(id: string) {
    return deleteSettingItem('meters', id);
}

// Relevés de compteur
export async function getMeterReadingsByContract(contractId: string): Promise<MeterReading[]> {
    const q = query(collection(db, 'meterReadings'), where("contractId", "==", contractId));
    return getCollection<MeterReading>(q);
}

export async function createMeterReading(data: Omit<MeterReading, 'id'>) {
    const readingData = {
        ...data,
        date: new Date(data.date),
    };
    return createSettingItem('meterReadings', readingData);
}



// --- Fonctions de Paramétrage (Firestore) ---
async function createSettingItem(collectionName: string, data: DocumentData): Promise<any> {
    const collectionRef = collection(db, collectionName);
    const docRef = await addDoc(collectionRef, data);
    return { id: docRef.id, ...data };
}

async function getSettingItems<T extends {id: string}>(collectionName: string): Promise<T[]> {
    const q = collection(db, collectionName);
    return getCollection<T>(q);
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
    const companies = await getCompanies();
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
