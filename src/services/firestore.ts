'use server';
import { db } from '@/lib/firebase';
import type { Contract, Invoice, MeterReading } from '@/lib/types';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  query,
  where,
} from 'firebase/firestore';
import { format } from 'date-fns';

// Contracts
export async function getContracts(): Promise<Contract[]> {
  const contractsCol = collection(db, 'contracts');
  const contractSnapshot = await getDocs(contractsCol);
  const contractList = contractSnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as Contract[];
  return contractList;
}

export async function getContract(id: string): Promise<Contract | null> {
  const contractDocRef = doc(db, 'contracts', id);
  const contractSnapshot = await getDoc(contractDocRef);
  if (contractSnapshot.exists()) {
    return { id: contractSnapshot.id, ...contractSnapshot.data() } as Contract;
  } else {
    return null;
  }
}

export async function createContract(contract: Omit<Contract, 'id' | 'status' | 'clientName' | 'startDate' | 'endDate'> & { clientName: string; startDate: Date; endDate: Date; }) {
    const newContract = {
      ...contract,
      status: 'pending',
      startDate: format(contract.startDate, 'yyyy-MM-dd'),
      endDate: format(contract.endDate, 'yyyy-MM-dd'),
    };
    const docRef = await addDoc(collection(db, "contracts"), newContract);
    return docRef.id;
}


// Invoices
export async function getInvoices(): Promise<Invoice[]> {
  const invoicesCol = collection(db, 'invoices');
  const invoiceSnapshot = await getDocs(invoicesCol);
  const invoiceList = invoiceSnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as Invoice[];
  return invoiceList;
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  const invoiceDocRef = doc(db, 'invoices', id);
  const invoiceSnapshot = await getDoc(invoiceDocRef);
  if (invoiceSnapshot.exists()) {
    return { id: invoiceSnapshot.id, ...invoiceSnapshot.data() } as Invoice;
  } else {
    return null;
  }
}

export async function getInvoicesByContract(contractId: string): Promise<Invoice[]> {
  const invoicesCol = collection(db, 'invoices');
  const q = query(invoicesCol, where('contractId', '==', contractId));
  const invoiceSnapshot = await getDocs(q);
  const invoiceList = invoiceSnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as Invoice[];
  return invoiceList;
}

// Meter Readings
export async function getMeterReadingsByContract(contractId: string): Promise<MeterReading[]> {
    const readingsCol = collection(db, 'meterReadings');
    const q = query(readingsCol, where('contractId', '==', contractId));
    const readingSnapshot = await getDocs(q);
    const readingList = readingSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    })) as MeterReading[];
    return readingList;
}
