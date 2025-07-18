'use server';
import type { Contract, Invoice, MeterReading, Company, Agency, Sector, Activity } from '@/lib/types';
import { format } from 'date-fns';

// --- Static Data for Demonstration ---

let contracts: Contract[] = [
  {
    id: 'contract-1',
    clientId: 'client-1',
    clientName: 'Stark Industries',
    startDate: '2023-01-01',
    endDate: '2023-12-31',
    billingSchedule: 'quarterly',
    services: ['hot_water', 'heating'],
    status: 'active',
  },
  {
    id: 'contract-2',
    clientId: 'client-2',
    clientName: 'Wayne Enterprises',
    startDate: '2024-03-15',
    endDate: '2025-03-14',
    billingSchedule: 'annually',
    services: ['hot_water', 'heating', 'fixed_subscription'],
    status: 'pending',
  },
  {
    id: 'contract-3',
    clientId: 'client-3',
    clientName: 'Oscorp',
    startDate: '2022-06-01',
    endDate: '2023-05-31',
    billingSchedule: 'end_of_term',
    services: ['heating'],
    status: 'expired',
  },
];

let invoices: Invoice[] = [
  {
    id: 'invoice-1',
    contractId: 'contract-1',
    clientName: 'Stark Industries',
    date: '2023-03-31',
    dueDate: '2023-04-30',
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
    date: '2023-06-30',
    dueDate: '2023-07-30',
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
    date: '2024-04-01',
    dueDate: '2024-05-01',
    status: 'overdue',
    lineItems: [
      { description: 'Annual Subscription', quantity: 1, unitPrice: 1200, total: 1200 },
    ],
    subtotal: 1200,
    tax: 120,
    total: 1320,
  },
];

let meterReadings: MeterReading[] = [
    { id: 'reading-1', contractId: 'contract-1', date: '2023-01-01', reading: 1000, unit: 'kWh', service: 'hot_water' },
    { id: 'reading-2', contractId: 'contract-1', date: '2023-03-31', reading: 1300, unit: 'kWh', service: 'hot_water' },
    { id: 'reading-3', contractId: 'contract-1', date: '2023-01-01', reading: 5000, unit: 'kWh', service: 'heating' },
    { id: 'reading-4', contractId: 'contract-1', date: '2023-03-31', reading: 5500, unit: 'kWh', service: 'heating' },
];

let companies: Company[] = [{id: '1', name: 'Zenergy Corp'}];
let agencies: Agency[] = [{id: '1', name: 'Main Agency'}];
let sectors: Sector[] = [{id: '1', name: 'North Sector'}];
let activities: Activity[] = [{id: '1', name: 'Energy Distribution'}];


// --- Mock Firestore Functions ---

// Contracts
export async function getContracts(): Promise<Contract[]> {
  console.log("getContracts called (static)");
  return Promise.resolve(JSON.parse(JSON.stringify(contracts)));
}

export async function getContract(id: string): Promise<Contract | null> {
    console.log(`getContract called for id: ${id} (static)`);
    const contract = contracts.find(c => c.id === id) || null;
    return Promise.resolve(contract ? JSON.parse(JSON.stringify(contract)) : null);
}

export async function createContract(data: Omit<Contract, 'id' | 'status' | 'clientId'> & { startDate: Date; endDate: Date }) {
    console.log("Creating contract (static):", data);
    const newContract: Contract = {
        id: `contract-${Date.now()}`,
        clientId: `client-${Date.now()}`,
        status: 'pending',
        ...data,
        startDate: format(data.startDate, 'yyyy-MM-dd'),
        endDate: format(data.endDate, 'yyyy-MM-dd'),
    };
    contracts.push(newContract);
    return Promise.resolve(newContract.id);
}


// Invoices
export async function getInvoices(): Promise<Invoice[]> {
  return Promise.resolve(JSON.parse(JSON.stringify(invoices)));
}

export async function getInvoice(id: string): Promise<Invoice | null> {
    const invoice = invoices.find(i => i.id === id) || null;
    return Promise.resolve(invoice ? JSON.parse(JSON.stringify(invoice)) : null);
}

export async function getInvoicesByContract(contractId: string): Promise<Invoice[]> {
  const contractInvoices = invoices.filter(i => i.contractId === contractId);
  return Promise.resolve(JSON.parse(JSON.stringify(contractInvoices)));
}

// Meter Readings
export async function getMeterReadingsByContract(contractId: string): Promise<MeterReading[]> {
    const readings = meterReadings.filter(r => r.contractId === contractId);
    return Promise.resolve(JSON.parse(JSON.stringify(readings)));
}

// Settings
type SettingItem = { id: string; name: string };
const createSetting = (collection: SettingItem[], type: string) => async (name: string): Promise<SettingItem> => {
    const newItem = { id: `${type}-${Date.now()}`, name };
    collection.push(newItem);
    console.log(`Created ${type} (static):`, newItem);
    return Promise.resolve(newItem);
};

const getSettings = (collection: SettingItem[]) => async (): Promise<SettingItem[]> => {
    return Promise.resolve(JSON.parse(JSON.stringify(collection)));
};

export const createCompany = createSetting(companies, 'company');
export const getCompanies = getSettings(companies);

export const createAgency = createSetting(agencies, 'agency');
export const getAgencies = getSettings(agencies);

export const createSector = createSetting(sectors, 'sector');
export const getSectors = getSettings(sectors);

export const createActivity = createSetting(activities, 'activity');
export const getActivities = getSettings(activities);
