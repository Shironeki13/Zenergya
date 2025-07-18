'use server';
import type { Contract, Invoice, MeterReading, Company, Agency, Sector, Activity } from '@/lib/types';
import { Timestamp } from 'firebase/firestore';

// --- Static Data for Demonstration ---

const contracts: Contract[] = [
  {
    id: 'contract-1',
    clientId: 'client-1',
    clientName: 'Stark Industries',
    startDate: '2023-01-01T00:00:00.000Z',
    endDate: '2023-12-31T00:00:00.000Z',
    billingSchedule: 'quarterly',
    services: ['hot_water', 'heating'],
    status: 'active',
  },
  {
    id: 'contract-2',
    clientId: 'client-2',
    clientName: 'Wayne Enterprises',
    startDate: '2024-03-15T00:00:00.000Z',
    endDate: '2025-03-14T00:00:00.000Z',
    billingSchedule: 'annually',
    services: ['hot_water', 'heating', 'fixed_subscription'],
    status: 'pending',
  },
  {
    id: 'contract-3',
    clientId: 'client-3',
    clientName: 'Oscorp',
    startDate: '2022-06-01T00:00:00.000Z',
    endDate: '2023-05-31T00:00:00.000Z',
    billingSchedule: 'end_of_term',
    services: ['heating'],
    status: 'expired',
  },
];

const invoices: Invoice[] = [
  {
    id: 'invoice-1',
    contractId: 'contract-1',
    clientName: 'Stark Industries',
    date: '2023-03-31T00:00:00.000Z',
    dueDate: '2023-04-30T00:00:00.000Z',
    status: 'paid',
    lineItems: [
      { description: 'Hot Water Usage (Q1)', quantity: 300, unitPrice: 0.5, total: 150 },
      { description: 'Heating Usage (Q1)', quantity: 500, unitPrice: 0.4, total: 200 },
    ],
    subtotal: 350,
    tax: 35,
    total: 385,
  },
  {
    id: 'invoice-2',
    contractId: 'contract-1',
    clientName: 'Stark Industries',
    date: '2023-06-30T00:00:00.000Z',
    dueDate: '2023-07-30T00:00:00.000Z',
    status: 'due',
    lineItems: [
      { description: 'Hot Water Usage (Q2)', quantity: 320, unitPrice: 0.5, total: 160 },
      { description: 'Heating Usage (Q2)', quantity: 100, unitPrice: 0.4, total: 40 },
    ],
    subtotal: 200,
    tax: 20,
    total: 220,
  },
    {
    id: 'invoice-3',
    contractId: 'contract-2',
    clientName: 'Wayne Enterprises',
    date: '2024-04-01T00:00:00.000Z',
    dueDate: '2024-05-01T00:00:00.000Z',
    status: 'overdue',
    lineItems: [
      { description: 'Annual Subscription', quantity: 1, unitPrice: 1200, total: 1200 },
    ],
    subtotal: 1200,
    tax: 120,
    total: 1320,
  },
];

const meterReadings: MeterReading[] = [
    { id: 'reading-1', contractId: 'contract-1', date: '2023-01-01T00:00:00.000Z', reading: 1000, unit: 'kWh', service: 'hot_water' },
    { id: 'reading-2', contractId: 'contract-1', date: '2023-03-31T00:00:00.000Z', reading: 1300, unit: 'kWh', service: 'hot_water' },
    { id: 'reading-3', contractId: 'contract-1', date: '2023-01-01T00:00:00.000Z', reading: 5000, unit: 'kWh', service: 'heating' },
    { id: 'reading-4', contractId: 'contract-1', date: '2023-03-31T00:00:00.000Z', reading: 5500, unit: 'kWh', service: 'heating' },
];

let companies: Company[] = [{id: '1', name: 'Zenergy Corp'}];
let agencies: Agency[] = [{id: '1', name: 'Main Agency'}];
let sectors: Sector[] = [{id: '1', name: 'North Sector'}];
let activities: Activity[] = [{id: '1', name: 'Energy Distribution'}];


// --- Mock Firestore Functions ---

// Contracts
export async function getContracts(): Promise<Contract[]> {
  return Promise.resolve(contracts);
}

export async function getContract(id: string): Promise<Contract | null> {
    const contract = contracts.find(c => c.id === id) || null;
    return Promise.resolve(contract);
}

export async function createContract(contract: Omit<Contract, 'id' | 'status' | 'clientId'> & { clientName: string; startDate: Date; endDate: Date; }) {
    console.log("Creating contract (static):", contract);
    const newContract: Contract = {
        id: `contract-${Date.now()}`,
        clientId: `client-${Date.now()}`,
        status: 'pending',
        ...contract,
        startDate: contract.startDate.toISOString(),
        endDate: contract.endDate.toISOString(),
    };
    contracts.push(newContract);
    return Promise.resolve(newContract.id);
}


// Invoices
export async function getInvoices(): Promise<Invoice[]> {
  return Promise.resolve(invoices);
}

export async function getInvoice(id: string): Promise<Invoice | null> {
    const invoice = invoices.find(i => i.id === id) || null;
    return Promise.resolve(invoice);
}

export async function getInvoicesByContract(contractId: string): Promise<Invoice[]> {
  const contractInvoices = invoices.filter(i => i.contractId === contractId);
  return Promise.resolve(contractInvoices);
}

// Meter Readings
export async function getMeterReadingsByContract(contractId: string): Promise<MeterReading[]> {
    const readings = meterReadings.filter(r => r.contractId === contractId);
    return Promise.resolve(readings);
}

// Settings
const createSetting = (collection: SettingItem[]) => async (name: string) => {
    const newItem = { id: Date.now().toString(), name };
    collection.push(newItem);
    console.log(`Created in ${collection}:`, newItem);
    return Promise.resolve();
};

type SettingItem = { id: string; name: string };

const getSettings = (collection: SettingItem[]) => async () => {
    return Promise.resolve(collection);
};

export const createCompany = createSetting(companies);
export const getCompanies = getSettings(companies);

export const createAgency = createSetting(agencies);
export const getAgencies = getSettings(agencies);

export const createSector = createSetting(sectors);
export const getSectors = getSettings(sectors);

export const createActivity = createSetting(activities);
export const getActivities = getSettings(activities);
