'use server';
import { db } from '@/lib/firebase';
import type { Contract, Invoice, MeterReading, Company, Agency, Sector, Activity } from '@/lib/types';
import { collection, getDocs, doc, getDoc, addDoc, query, where, DocumentData } from 'firebase/firestore';

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

export async function createCompany(name: string) {
    return createSettingItem('companies', { name });
}
export async function getCompanies(): Promise<Company[]> {
    return getSettingItems<Company>('companies');
}

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

export async function createActivity(name: string) {
    return createSettingItem('activities', { name });
}
export async function getActivities(): Promise<Activity[]> {
    return getSettingItems<Activity>('activities');
}
