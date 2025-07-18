'use server';
import { db } from '@/lib/firebase';
import { collection, getDocs, getDoc, doc, addDoc, serverTimestamp } from 'firebase/firestore';
import type { Contract, Invoice, MeterReading, Company, Agency, Sector, Activity } from '@/lib/types';
import { format } from 'date-fns';

// Helper to convert Firestore docs to plain objects
function docToItem<T>(d: any): T {
    const data = d.data();
    return {
        ...data,
        id: d.id,
    };
}

// --- Firestore Functions ---

// Contracts
export async function getContracts(): Promise<Contract[]> {
    try {
        const contractsCol = collection(db, 'contracts');
        const contractSnapshot = await getDocs(contractsCol);
        const contractList = contractSnapshot.docs.map(d => docToItem<Contract>(d));
        return contractList;
    } catch (error) {
        console.error("Error getting contracts:", error);
        // On permission errors, it's better to return an empty array than to crash
        return [];
    }
}

export async function getContract(id: string): Promise<Contract | null> {
    try {
        const contractRef = doc(db, 'contracts', id);
        const contractSnap = await getDoc(contractRef);
        if (contractSnap.exists()) {
            return docToItem<Contract>(contractSnap);
        } else {
            return null;
        }
    } catch (error) {
        console.error(`Error getting contract ${id}:`, error);
        return null;
    }
}

export async function createContract(data: Omit<Contract, 'id' | 'status' | 'clientId'> & { startDate: Date; endDate: Date }) {
    try {
        const contractsCol = collection(db, 'contracts');
        await addDoc(contractsCol, {
            ...data,
            startDate: format(data.startDate, 'yyyy-MM-dd'),
            endDate: format(data.endDate, 'yyyy-MM-dd'),
            status: 'pending',
            clientId: `client-${Date.now()}`, // Placeholder client ID
            createdAt: serverTimestamp(),
        });
    } catch (error) {
        console.error("Error creating contract:", error);
        throw new Error('Failed to create contract');
    }
}

// Invoices
export async function getInvoices(): Promise<Invoice[]> {
    try {
        const invoicesCol = collection(db, 'invoices');
        const invoiceSnapshot = await getDocs(invoicesCol);
        return invoiceSnapshot.docs.map(d => docToItem<Invoice>(d));
    } catch (error) {
        console.error("Error getting invoices:", error);
        return [];
    }
}

export async function getInvoice(id: string): Promise<Invoice | null> {
    try {
        const invoiceRef = doc(db, 'invoices', id);
        const invoiceSnap = await getDoc(invoiceRef);
        if (invoiceSnap.exists()) {
            return docToItem<Invoice>(invoiceSnap);
        } else {
            return null;
        }
    } catch (error) {
        console.error(`Error getting invoice ${id}:`, error);
        return null;
    }
}

export async function getInvoicesByContract(contractId: string): Promise<Invoice[]> {
    // This is a simplified version. A real implementation would use a query.
    try {
        const allInvoices = await getInvoices();
        return allInvoices.filter(invoice => invoice.contractId === contractId);
    } catch (error) {
        console.error(`Error getting invoices for contract ${contractId}:`, error);
        return [];
    }
}

// Meter Readings
export async function getMeterReadingsByContract(contractId: string): Promise<MeterReading[]> {
    // This is a simplified version. A real implementation would use a query.
     try {
        const allReadings = await getDocs(collection(db, 'meterReadings'));
        const readingsList = allReadings.docs.map(d => docToItem<MeterReading>(d));
        return readingsList.filter(reading => reading.contractId === contractId);
    } catch (error) {
        console.error(`Error getting meter readings for contract ${contractId}:`, error);
        return [];
    }
}

// --- Settings Functions ---
type SettingItem = { id: string; name: string };

const createSetting = (collectionName: string) => async (name: string): Promise<void> => {
    try {
        await addDoc(collection(db, collectionName), { name, createdAt: serverTimestamp() });
    } catch (error) {
        console.error(`Error creating item in ${collectionName}:`, error);
        throw new Error(`Failed to create item in ${collectionName}`);
    }
};

const getSettings = <T extends SettingItem>(collectionName: string) => async (): Promise<T[]> => {
    try {
        const col = collection(db, collectionName);
        const snapshot = await getDocs(col);
        return snapshot.docs.map(d => docToItem<T>(d));
    } catch (error) {
        console.error(`Error getting items from ${collectionName}:`, error);
        return [];
    }
};


export const createCompany = createSetting('companies');
export const getCompanies = getSettings<Company>('companies');

export const createAgency = createSetting('agencies');
export const getAgencies = getSettings<Agency>('agencies');

export const createSector = createSetting('sectors');
export const getSectors = getSettings<Sector>('sectors');

export const createActivity = createSetting('activities');
export const getActivities = getSettings<Activity>('activities');
