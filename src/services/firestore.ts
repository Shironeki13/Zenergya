'use server';
import type { Contract, Invoice, MeterReading, Company, Agency, Sector, Activity } from '@/lib/types';
import { format } from 'date-fns';

// --- Static Data ---

const staticContracts: Contract[] = [];
const staticInvoices: Invoice[] = [];
const staticMeterReadings: MeterReading[] = [];
const staticCompanies: Company[] = [];
const staticAgencies: Agency[] = [];
const staticSectors: Sector[] = [];
const staticActivities: Activity[] = [];

let nextContractId = 1;
let nextInvoiceId = 1;
let nextReadingId = 1;

// --- Mock Firestore Functions ---

// Contracts
export async function getContracts(): Promise<Contract[]> {
    return Promise.resolve(staticContracts);
}

export async function getContract(id: string): Promise<Contract | null> {
    const contract = staticContracts.find(c => c.id === id) || null;
    return Promise.resolve(contract);
}

export async function createContract(data: Omit<Contract, 'id' | 'status' | 'clientId'> & { startDate: Date; endDate: Date }) {
    const newContract: Contract = {
        ...data,
        id: `CTR-00${nextContractId++}`,
        startDate: format(data.startDate, 'yyyy-MM-dd'),
        endDate: format(data.endDate, 'yyyy-MM-dd'),
        status: 'pending',
        clientId: `client-${Date.now()}`,
    };
    staticContracts.push(newContract);
    return Promise.resolve();
}

// Invoices
export async function getInvoices(): Promise<Invoice[]> {
    return Promise.resolve(staticInvoices);
}

export async function getInvoice(id: string): Promise<Invoice | null> {
    const invoice = staticInvoices.find(i => i.id === id) || null;
    return Promise.resolve(invoice);
}

export async function getInvoicesByContract(contractId: string): Promise<Invoice[]> {
    const invoices = staticInvoices.filter(invoice => invoice.contractId === contractId);
    return Promise.resolve(invoices);
}

// Meter Readings
export async function getMeterReadingsByContract(contractId: string): Promise<MeterReading[]> {
    const readings = staticMeterReadings.filter(reading => reading.contractId === contractId);
    return Promise.resolve(readings);
}

// --- Settings Functions ---
type SettingItem = { id: string; name: string };

const createSetting = (collection: SettingItem[]) => async (name: string): Promise<void> => {
    const newItem = { id: `${collection.length + 1}`, name };
    collection.push(newItem);
    return Promise.resolve();
};

const getSettings = <T extends SettingItem>(collection: T[]) => async (): Promise<T[]> => {
    return Promise.resolve(collection);
};


export const createCompany = createSetting(staticCompanies);
export const getCompanies = getSettings<Company>(staticCompanies);

export const createAgency = createSetting(staticAgencies);
export const getAgencies = getSettings<Agency>(staticAgencies);

export const createSector = createSetting(staticSectors);
export const getSectors = getSettings<Sector>(staticSectors);

export const createActivity = createSetting(staticActivities);
export const getActivities = getSettings<Activity>(staticActivities);
