export type Client = {
  id: string;
  name: string;
};

export type BillingSchedule = "quarterly" | "annually" | "end_of_term";

export type ContractService = "hot_water" | "heating" | "fixed_subscription";

export type Contract = {
  id: string;
  clientId: string;
  clientName: string;
  startDate: string;
  endDate: string;
  billingSchedule: BillingSchedule;
  activities: string[]; // Remplacement de 'services' par 'activities'
  status: "active" | "expired" | "pending";
};

export type MeterReading = {
  id: string;
  contractId: string;
  date: string;
  reading: number;
  unit: "kWh";
  service: "hot_water" | "heating";
};

export type InvoiceStatus = "paid" | "due" | "overdue";

export type InvoiceLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type Invoice = {
  id: string;
  contractId: string;
  clientName: string;
  date: string;
  dueDate: string;
  status: InvoiceStatus;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  tax: number;
  total: number;
};

// Settings Types
export type Company = {
    id: string;
    name: string;
    logoUrl?: string;
}

export type Agency = {
    id: string;
    name: string;
    companyId: string;
    companyName?: string; // Optional for display
}

export type Sector = {
    id: string;
    name: string;
    agencyId: string;
    agencyName?: string; // Optional for display
}

export type Activity = {
    id: string;
    name: string;
}

export type Schedule = {
    id: string;
    name: string;
}

export type Term = {
    id: string;
    name: string;
}

// User Management Types
export type Role = {
    id: string;
    name: string;
    // permissions: string[]; // Future use
}

export type User = {
    id: string;
    name: string;
    email: string;
    roleId: string;
    roleName?: string; // Optional for display
}
