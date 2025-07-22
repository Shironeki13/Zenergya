
'use server';
import { db } from '@/lib/firebase';
import type { Client, Site, Contract, Invoice, MeterReading, Company, Agency, Sector, Activity, User, Role, Schedule, Term, Typology, VatRate, RevisionFormula, PaymentTerm } from '@/lib/types';
import { collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, where, DocumentData, writeBatch } from 'firebase/firestore';

// --- Fonctions de Service (Firestore) ---

// Clients
export async function getClients(): Promise<Client[]> {
    const clientsCollection = collection(db, 'clients');
    const clientSnapshot = await getDocs(clientsCollection);
    return clientSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client));
}

export async function getClient(id: string): Promise<Client | null> {
    const clientDoc = doc(db, 'clients', id);
    const clientSnapshot = await getDoc(clientDoc);
    if (clientSnapshot.exists()) {
        return { id: clientSnapshot.id, ...clientSnapshot.data() } as Client;
    }
    return null;
}

export async function createClient(data: Omit<Client, 'id'>) {
    const clientsCollection = collection(db, 'clients');
    const docRef = await addDoc(clientsCollection, data);
    return { id: docRef.id, ...data };
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
export async function getSitesByClient(clientId: string): Promise<Site[]> {
    const sitesCollection = collection(db, 'sites');
    const q = query(sitesCollection, where("clientId", "==", clientId));
    const siteSnapshot = await getDocs(q);
    return siteSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Site));
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
    return contractSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contract));
}

export async function getContract(id: string): Promise<Contract | null> {
    const contractDoc = doc(db, 'contracts', id);
    const contractSnapshot = await getDoc(contractDoc);
    if (contractSnapshot.exists()) {
        return { id: contractSnapshot.id, ...contractSnapshot.data() } as Contract;
    }
    return null;
}

export async function createContract(data: Omit<Contract, 'id' | 'status'>) {
    const newContractData = {
        ...data,
        status: 'pending',
    };
    const contractsCollection = collection(db, 'contracts');
    const docRef = await addDoc(contractsCollection, newContractData);
    return { id: docRef.id, ...newContractData };
}


// Factures
export async function getInvoices(): Promise<Invoice[]> {
    const invoicesCollection = collection(db, 'invoices');
    const invoiceSnapshot = await getDocs(invoicesCollection);
    return invoiceSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Invoice));
}

export async function getInvoice(id: string): Promise<Invoice | null> {
    const invoiceDoc = doc(db, 'invoices', id);
    const invoiceSnapshot = await getDoc(invoiceDoc);
    if (invoiceSnapshot.exists()) {
        return { id: invoiceSnapshot.id, ...invoiceSnapshot.data() } as Invoice;
    }
    return null;
}

export async function getInvoicesByContract(contractId: string): Promise<Invoice[]> {
    const invoicesCollection = collection(db, 'invoices');
    const q = query(invoicesCollection, where("contractId", "==", contractId));
    const invoiceSnapshot = await getDocs(q);
    return invoiceSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Invoice));
}

// Relevés de compteur
export async function getMeterReadingsByContract(contractId: string): Promise<MeterReading[]> {
    const readingsCollection = collection(db, 'meterReadings');
     const q = query(readingsCollection, where("contractId", "==", contractId));
    const readingSnapshot = await getDocs(q);
    return readingSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MeterReading));
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
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as T));
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
export async function createCompany(name: string, logoUrl?: string) {
    return createSettingItem('companies', { name, logoUrl: logoUrl || null });
}
export async function getCompanies(): Promise<Company[]> {
    return getSettingItems<Company>('companies');
}
export async function updateCompany(id: string, name: string, logoUrl?: string) {
    const data: {name: string, logoUrl?: string} = { name };
    if (logoUrl) data.logoUrl = logoUrl;
    return updateSettingItem('companies', id, data);
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
export async function createActivity(name: string) {
    return createSettingItem('activities', { name });
}
export async function getActivities(): Promise<Activity[]> {
    return getSettingItems<Activity>('activities');
}
export async function updateActivity(id: string, name: string) {
    return updateSettingItem('activities', id, { name });
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
export async function createVatRate(name: string, rate: number) {
    return createSettingItem('vatRates', { name, rate });
}
export async function getVatRates(): Promise<VatRate[]> {
    return getSettingItems<VatRate>('vatRates');
}
export async function updateVatRate(id: string, data: { name: string, rate: number }) {
    return updateSettingItem('vatRates', id, data);
}
export async function deleteVatRate(id: string) {
    return deleteSettingItem('vatRates', id);
}

// Formules de Révision
export async function createRevisionFormula(data: Omit<RevisionFormula, 'id'>) {
    return createSettingItem('revisionFormulas', data);
}
export async function getRevisionFormulas(): Promise<RevisionFormula[]> {
    return getSettingItems<RevisionFormula>('revisionFormulas');
}
export async function updateRevisionFormula(id: string, data: Partial<Omit<RevisionFormula, 'id'>>) {
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
