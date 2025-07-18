'use server';
import type { Contract, Invoice, MeterReading, Company, Agency, Sector, Activity } from '@/lib/types';

// --- Données Statiques de Démonstration ---

let mockContracts: Contract[] = [
  {
    id: 'CTR-001',
    clientId: 'CLI-001',
    clientName: 'Stark Industries',
    startDate: '2023-01-01',
    endDate: '2023-12-31',
    billingSchedule: 'quarterly',
    services: ['hot_water', 'heating'],
    status: 'active',
  },
  {
    id: 'CTR-002',
    clientId: 'CLI-002',
    clientName: 'Wayne Enterprises',
    startDate: '2023-03-15',
    endDate: '2024-03-14',
    billingSchedule: 'annually',
    services: ['hot_water', 'heating', 'fixed_subscription'],
    status: 'active',
  },
  {
    id: 'CTR-003',
    clientId: 'CLI-003',
    clientName: 'Cyberdyne Systems',
    startDate: '2022-05-01',
    endDate: '2023-04-30',
    billingSchedule: 'end_of_term',
    services: ['heating'],
    status: 'expired',
  },
  {
    id: 'CTR-004',
    clientId: 'CLI-004',
    clientName: 'Oscorp',
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    billingSchedule: 'quarterly',
    services: ['hot_water'],
    status: 'pending',
  }
];

let mockInvoices: Invoice[] = [
    {
        id: 'INV-2023-001',
        contractId: 'CTR-001',
        clientName: 'Stark Industries',
        date: '2023-03-31',
        dueDate: '2023-04-30',
        status: 'paid',
        lineItems: [
            { description: 'Consommation Eau Chaude T1', quantity: 1200, unitPrice: 0.15, total: 180 },
            { description: 'Consommation Chauffage T1', quantity: 3000, unitPrice: 0.12, total: 360 },
        ],
        subtotal: 540,
        tax: 54,
        total: 594,
    },
    {
        id: 'INV-2023-002',
        contractId: 'CTR-002',
        clientName: 'Wayne Enterprises',
        date: '2023-03-15',
        dueDate: '2024-03-15',
        status: 'due',
        lineItems: [
            { description: 'Abonnement Annuel', quantity: 1, unitPrice: 500, total: 500 },
        ],
        subtotal: 500,
        tax: 50,
        total: 550,
    },
     {
        id: 'INV-2023-003',
        contractId: 'CTR-001',
        clientName: 'Stark Industries',
        date: '2023-06-30',
        dueDate: '2023-07-30',
        status: 'overdue',
        lineItems: [
            { description: 'Consommation Eau Chaude T2', quantity: 1100, unitPrice: 0.15, total: 165 },
            { description: 'Consommation Chauffage T2', quantity: 1500, unitPrice: 0.12, total: 180 },
        ],
        subtotal: 345,
        tax: 34.5,
        total: 379.5,
    }
];

let mockMeterReadings: MeterReading[] = [
    { id: 'MR-001', contractId: 'CTR-001', date: '2023-03-31', reading: 1200, unit: 'kWh', service: 'hot_water' },
    { id: 'MR-002', contractId: 'CTR-001', date: '2023-03-31', reading: 3000, unit: 'kWh', service: 'heating' },
    { id: 'MR-003', contractId: 'CTR-001', date: '2023-06-30', reading: 2300, unit: 'kWh', service: 'hot_water' },
    { id: 'MR-004', contractId: 'CTR-001', date: '2023-06-30', reading: 4500, unit: 'kWh', service: 'heating' },
];

let mockCompanies: Company[] = [{id: '1', name: 'Zenergy Corp'}];
let mockAgencies: Agency[] = [{id: '1', name: 'Agence de Paris'}];
let mockSectors: Sector[] = [{id: '1', name: 'Secteur Alpha'}];
let mockActivities: Activity[] = [{id: '1', name: 'Gestion de compteurs'}];

// --- Fonctions de Service (simulées) ---

// Contrats
export async function getContracts(): Promise<Contract[]> {
    console.log("Mock: Récupération des contrats");
    return Promise.resolve(mockContracts);
}

export async function getContract(id: string): Promise<Contract | null> {
    console.log(`Mock: Récupération du contrat ${id}`);
    const contract = mockContracts.find(c => c.id === id) || null;
    return Promise.resolve(contract);
}

export async function createContract(data: Omit<Contract, 'id' | 'status' | 'clientId'>) {
    console.log("Mock: Création d'un contrat", data);
    const newContract: Contract = {
        id: `CTR-00${mockContracts.length + 1}`,
        clientId: `client-${Date.now()}`,
        status: 'pending',
        ...data,
    };
    mockContracts.push(newContract);
    return Promise.resolve();
}

// Factures
export async function getInvoices(): Promise<Invoice[]> {
    console.log("Mock: Récupération des factures");
    return Promise.resolve(mockInvoices);
}

export async function getInvoice(id: string): Promise<Invoice | null> {
    console.log(`Mock: Récupération de la facture ${id}`);
    const invoice = mockInvoices.find(i => i.id === id) || null;
    return Promise.resolve(invoice);
}

export async function getInvoicesByContract(contractId: string): Promise<Invoice[]> {
    console.log(`Mock: Récupération des factures pour le contrat ${contractId}`);
    const invoices = mockInvoices.filter(i => i.contractId === contractId);
    return Promise.resolve(invoices);
}

// Relevés de compteur
export async function getMeterReadingsByContract(contractId: string): Promise<MeterReading[]> {
     console.log(`Mock: Récupération des relevés pour le contrat ${contractId}`);
     const readings = mockMeterReadings.filter(r => r.contractId === contractId);
     return Promise.resolve(readings);
}

// --- Fonctions de Paramétrage (simulées) ---
async function createSettingItem(collectionName: string, name: string): Promise<void> {
    console.log(`Mock: Création d'un item dans ${collectionName} avec le nom ${name}`);
    const newItem = { id: Date.now().toString(), name };
    if (collectionName === 'companies') mockCompanies.push(newItem);
    if (collectionName === 'agencies') mockAgencies.push(newItem as Agency);
    if (collectionName === 'sectors') mockSectors.push(newItem as Sector);
    if (collectionName === 'activities') mockActivities.push(newItem as Activity);
    return Promise.resolve();
}

async function getSettingItems<T extends {id: string, name: string}>(collectionName: string): Promise<T[]> {
    console.log(`Mock: Récupération des items de ${collectionName}`);
    if (collectionName === 'companies') return Promise.resolve(mockCompanies as T[]);
    if (collectionName === 'agencies') return Promise.resolve(mockAgencies as T[]);
    if (collectionName === 'sectors') return Promise.resolve(mockSectors as T[]);
    if (collectionName === 'activities') return Promise.resolve(mockActivities as T[]);
    return Promise.resolve([]);
}

export async function createCompany(name: string) {
    return createSettingItem('companies', name);
}
export async function getCompanies() {
    return getSettingItems<Company>('companies');
}

export async function createAgency(name: string) {
    return createSettingItem('agencies', name);
}
export async function getAgencies() {
    return getSettingItems<Agency>('agencies');
}

export async function createSector(name: string) {
    return createSettingItem('sectors', name);
}
export async function getSectors() {
    return getSettingItems<Sector>('sectors');
}

export async function createActivity(name: string) {
    return createSettingItem('activities', name);
}
export async function getActivities() {
    return getSettingItems<Activity>('activities');
}
