'use server';
import type { Contract, Invoice, MeterReading, Company, Agency, Sector, Activity } from '@/lib/types';

// --- Données Statiques (simulation de base de données) ---

const MOCK_CONTRACTS: Contract[] = [
  {
    id: 'CTR-001',
    clientId: 'CLI-001',
    clientName: 'Stark Industries',
    startDate: '2023-01-01',
    endDate: '2024-01-01',
    billingSchedule: 'quarterly',
    services: ['hot_water', 'heating'],
    status: 'active',
  },
  {
    id: 'CTR-002',
    clientId: 'CLI-002',
    clientName: 'Wayne Enterprises',
    startDate: '2023-03-15',
    endDate: '2023-09-15',
    billingSchedule: 'end_of_term',
    services: ['fixed_subscription'],
    status: 'expired',
  },
  {
    id: 'CTR-003',
    clientId: 'CLI-003',
    clientName: 'Cyberdyne Systems',
    startDate: '2024-05-01',
    endDate: '2025-05-01',
    billingSchedule: 'annually',
    services: ['hot_water', 'heating', 'fixed_subscription'],
    status: 'pending',
  },
];

const MOCK_INVOICES: Invoice[] = [
  {
    id: 'INV-2023-001',
    contractId: 'CTR-001',
    clientName: 'Stark Industries',
    date: '2023-03-31',
    dueDate: '2023-04-30',
    status: 'paid',
    lineItems: [
      { description: 'Eau Chaude - T1 2023', quantity: 1200, unitPrice: 0.15, total: 180 },
      { description: 'Chauffage - T1 2023', quantity: 3500, unitPrice: 0.12, total: 420 },
    ],
    subtotal: 600,
    tax: 60,
    total: 660,
  },
   {
    id: 'INV-2023-002',
    contractId: 'CTR-001',
    clientName: 'Stark Industries',
    date: '2023-06-30',
    dueDate: '2023-07-30',
    status: 'paid',
    lineItems: [
      { description: 'Eau Chaude - T2 2023', quantity: 800, unitPrice: 0.15, total: 120 },
      { description: 'Chauffage - T2 2023', quantity: 1500, unitPrice: 0.12, total: 180 },
    ],
    subtotal: 300,
    tax: 30,
    total: 330,
  },
  {
    id: 'INV-2023-003',
    contractId: 'CTR-002',
    clientName: 'Wayne Enterprises',
    date: '2023-09-15',
    dueDate: '2023-10-15',
    status: 'due',
    lineItems: [{ description: 'Abonnement Fixe', quantity: 1, unitPrice: 1200, total: 1200 }],
    subtotal: 1200,
    tax: 120,
    total: 1320,
  },
  {
    id: 'INV-2022-004',
    contractId: 'CTR-001',
    clientName: 'Stark Industries',
    date: '2022-12-31',
    dueDate: '2023-01-30',
    status: 'overdue',
    lineItems: [
        { description: 'Chauffage - T4 2022', quantity: 4000, unitPrice: 0.11, total: 440 }
    ],
    subtotal: 440,
    tax: 44,
    total: 484,
  },
];

const MOCK_METER_READINGS: MeterReading[] = [
    { id: 'MR-001', contractId: 'CTR-001', date: '2023-01-01', reading: 15000, unit: 'kWh', service: 'heating' },
    { id: 'MR-002', contractId: 'CTR-001', date: '2023-03-31', reading: 18500, unit: 'kWh', service: 'heating' },
    { id: 'MR-003', contractId: 'CTR-001', date: '2023-01-01', reading: 8000, unit: 'kWh', service: 'hot_water' },
    { id: 'MR-004', contractId: 'CTR-001', date: '2023-03-31', reading: 9200, unit: 'kWh', service: 'hot_water' },
];

const MOCK_COMPANIES: Company[] = [{ id: '1', name: 'Zenergy Corp' }];
const MOCK_AGENCIES: Agency[] = [{ id: '1', name: 'Agence de Paris' }];
const MOCK_SECTORS: Sector[] = [{ id: '1', name: 'Secteur Alpha' }];
const MOCK_ACTIVITIES: Activity[] = [{ id: '1', name: 'Fourniture Énergie' }];


// --- Fonctions de Service (utilisant les données statiques) ---

// Contrats
export async function getContracts(): Promise<Contract[]> {
    return Promise.resolve(MOCK_CONTRACTS);
}

export async function getContract(id: string): Promise<Contract | null> {
    const contract = MOCK_CONTRACTS.find(c => c.id === id) || null;
    return Promise.resolve(contract);
}

export async function createContract(data: Omit<Contract, 'id' | 'status' | 'clientId' | 'clientName'> & {clientName: string}) {
    const newContract: Contract = {
        id: `CTR-${Date.now()}`,
        clientId: `CLI-${Date.now()}`,
        status: 'pending',
        ...data,
    };
    MOCK_CONTRACTS.push(newContract);
    return Promise.resolve(newContract);
}

// Factures
export async function getInvoices(): Promise<Invoice[]> {
    return Promise.resolve(MOCK_INVOICES);
}

export async function getInvoice(id: string): Promise<Invoice | null> {
    const invoice = MOCK_INVOICES.find(i => i.id === id) || null;
    return Promise.resolve(invoice);
}

export async function getInvoicesByContract(contractId: string): Promise<Invoice[]> {
    const invoices = MOCK_INVOICES.filter(i => i.contractId === contractId);
    return Promise.resolve(invoices);
}

// Relevés de compteur
export async function getMeterReadingsByContract(contractId: string): Promise<MeterReading[]> {
     const readings = MOCK_METER_READINGS.filter(r => r.contractId === contractId);
     return Promise.resolve(readings);
}

// --- Fonctions de Paramétrage (statiques) ---
async function createSettingItem<T extends {id: string, name: string}>(collection: T[], name: string): Promise<void> {
    collection.push({ id: Date.now().toString(), name } as T);
    return Promise.resolve();
}

export async function createCompany(name: string) {
    return createSettingItem(MOCK_COMPANIES, name);
}
export async function getCompanies(): Promise<Company[]> {
    return Promise.resolve(MOCK_COMPANIES);
}

export async function createAgency(name: string) {
    return createSettingItem(MOCK_AGENCIES, name);
}
export async function getAgencies(): Promise<Agency[]> {
    return Promise.resolve(MOCK_AGENCIES);
}

export async function createSector(name: string) {
    return createSettingItem(MOCK_SECTORS, name);
}
export async function getSectors(): Promise<Sector[]> {
    return Promise.resolve(MOCK_SECTORS);
}

export async function createActivity(name: string) {
    return createSettingItem(MOCK_ACTIVITIES, name);
}
export async function getActivities(): Promise<Activity[]> {
    return Promise.resolve(MOCK_ACTIVITIES);
}
