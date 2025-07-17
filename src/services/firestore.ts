'use server';
import type { Contract, Invoice, MeterReading } from '@/lib/types';
import { format } from 'date-fns';

const MOCK_CONTRACTS: Contract[] = [
  {
    id: 'contract-1',
    clientName: 'Stark Industries',
    startDate: '2023-01-15',
    endDate: '2024-01-14',
    billingSchedule: 'quarterly',
    services: ['hot_water', 'heating'],
    status: 'active',
    clientId: 'client-1',
  },
  {
    id: 'contract-2',
    clientName: 'Wayne Enterprises',
    startDate: '2023-03-01',
    endDate: '2025-02-28',
    billingSchedule: 'annually',
    services: ['hot_water', 'heating', 'fixed_subscription'],
    status: 'active',
    clientId: 'client-2',
  },
  {
    id: 'contract-3',
    clientName: 'Oscorp',
    startDate: '2024-05-20',
    endDate: '2024-11-20',
    billingSchedule: 'end_of_term',
    services: ['heating'],
    status: 'pending',
    clientId: 'client-3',
  },
  {
    id: 'contract-4',
    clientName: 'Cyberdyne Systems',
    startDate: '2022-01-01',
    endDate: '2023-12-31',
    billingSchedule: 'annually',
    services: ['fixed_subscription'],
    status: 'expired',
    clientId: 'client-4',
  },
];

const MOCK_INVOICES: Invoice[] = [
  {
    id: 'invoice-001',
    contractId: 'contract-1',
    clientName: 'Stark Industries',
    date: '2023-10-15',
    dueDate: '2023-11-14',
    status: 'paid',
    lineItems: [
      { description: 'Hot Water Usage (Q3)', quantity: 500, unitPrice: 0.15, total: 75.0 },
      { description: 'Heating Usage (Q3)', quantity: 800, unitPrice: 0.12, total: 96.0 },
    ],
    subtotal: 171.0,
    tax: 17.1,
    total: 188.1,
  },
  {
    id: 'invoice-002',
    contractId: 'contract-2',
    clientName: 'Wayne Enterprises',
    date: '2024-03-01',
    dueDate: '2024-03-31',
    status: 'due',
    lineItems: [
        { description: 'Annual Subscription', quantity: 1, unitPrice: 1200, total: 1200.0 },
    ],
    subtotal: 1200.0,
    tax: 120.0,
    total: 1320.0,
  },
   {
    id: 'invoice-003',
    contractId: 'contract-1',
    clientName: 'Stark Industries',
    date: '2024-01-15',
    dueDate: '2024-02-14',
    status: 'overdue',
    lineItems: [
      { description: 'Hot Water Usage (Q4)', quantity: 550, unitPrice: 0.15, total: 82.5 },
      { description: 'Heating Usage (Q4)', quantity: 900, unitPrice: 0.12, total: 108.0 },
    ],
    subtotal: 190.5,
    tax: 19.05,
    total: 209.55,
  },
];

const MOCK_METER_READINGS: MeterReading[] = [
    { id: 'mr-1', contractId: 'contract-1', date: '2023-07-15', reading: 12500, unit: 'kWh', service: 'hot_water'},
    { id: 'mr-2', contractId: 'contract-1', date: '2023-07-15', reading: 34000, unit: 'kWh', service: 'heating'},
    { id: 'mr-3', contractId: 'contract-1', date: '2023-10-15', reading: 13000, unit: 'kWh', service: 'hot_water'},
    { id: 'mr-4', contractId: 'contract-1', date: '2023-10-15', reading: 34800, unit: 'kWh', service: 'heating'},
]

// Contracts
export async function getContracts(): Promise<Contract[]> {
  console.log("Firestore Service: Faking getting contracts");
  return Promise.resolve(MOCK_CONTRACTS);
}

export async function getContract(id: string): Promise<Contract | null> {
  console.log(`Firestore Service: Faking getting contract ${id}`);
  const contract = MOCK_CONTRACTS.find(c => c.id === id) || null;
  return Promise.resolve(contract);
}

export async function createContract(contract: Omit<Contract, 'id' | 'status' | 'clientId' | 'startDate' | 'endDate'> & { clientName: string; startDate: Date; endDate: Date; }) {
    console.log("Firestore Service: Faking creating contract", contract);
    const newId = `contract-${MOCK_CONTRACTS.length + 1}`;
    const newContract: Contract = {
      ...contract,
      id: newId,
      clientId: `client-${MOCK_CONTRACTS.length + 1}`,
      status: 'pending',
      startDate: format(contract.startDate, 'yyyy-MM-dd'),
      endDate: format(contract.endDate, 'yyyy-MM-dd'),
    };
    MOCK_CONTRACTS.push(newContract);
    return Promise.resolve(newId);
}


// Invoices
export async function getInvoices(): Promise<Invoice[]> {
  console.log("Firestore Service: Faking getting invoices");
  return Promise.resolve(MOCK_INVOICES);
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  console.log(`Firestore Service: Faking getting invoice ${id}`);
  const invoice = MOCK_INVOICES.find(i => i.id === id) || null;
  return Promise.resolve(invoice);
}

export async function getInvoicesByContract(contractId: string): Promise<Invoice[]> {
  console.log(`Firestore Service: Faking getting invoices for contract ${contractId}`);
  const invoices = MOCK_INVOICES.filter(i => i.contractId === contractId);
  return Promise.resolve(invoices);
}

// Meter Readings
export async function getMeterReadingsByContract(contractId: string): Promise<MeterReading[]> {
    console.log(`Firestore Service: Faking getting meter readings for contract ${contractId}`);
    const readings = MOCK_METER_READINGS.filter(r => r.contractId === contractId);
    return Promise.resolve(readings);
}