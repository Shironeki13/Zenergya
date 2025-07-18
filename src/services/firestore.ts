'use server';
import { db } from '@/lib/firebase';
import type { Contract, Invoice, MeterReading, Company, Agency, Sector, Activity, User, Role, Schedule, Term } from '@/lib/types';
import { collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, where, DocumentData, writeBatch } from 'firebase/firestore';

// --- Fonctions de Service (Firestore) ---

// Contrats
export async function getContracts(): Promise<Contract[]> {
    const contractsCollection = collection(db, 'contracts');
    const contractSnapshot = await getDocs(contractsCollection);
    const contractList = contractSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contract));
    return contractList;
}

export async function getContract(id: string): Promise<Contract | null> {
    const contractDoc = doc(db, 'contracts', id);
    const contractSnapshot = await getDoc(contractDoc);
    if (contractSnapshot.exists()) {
        return { id: contractSnapshot.id, ...contractSnapshot.data() } as Contract;
    }
    return null;
}

export async function createContract(data: Omit<Contract, 'id' | 'status' | 'clientId'>) {
    const newContractData = {
        ...data,
        clientId: `CLI-${Date.now()}`, // Placeholder for client management
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
    // Advanced delete: also delete related agencies and sectors
    const batch = writeBatch(db);

    // Delete company
    const companyRef = doc(db, "companies", id);
    batch.delete(companyRef);

    // Find and delete agencies of this company
    const agenciesQuery = query(collection(db, "agencies"), where("companyId", "==", id));
    const agenciesSnapshot = await getDocs(agenciesQuery);
    
    for (const agencyDoc of agenciesSnapshot.docs) {
        // Find and delete sectors of this agency
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
    // Optional: Add logic to handle users with this role
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
