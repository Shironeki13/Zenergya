
export type Client = {
  id: string;
  name: string;
  billingAddress?: string;
  contactEmail?: string;
};

export type Site = {
    id: string;
    clientId: string;
    name: string;
    address: string;
    meterReference?: string;
}

export type Contract = {
  id: string;
  clientId: string;
  clientName: string; // Denormalized for easy display
  siteIds: string[];
  startDate: string;
  endDate: string;
  billingSchedule: string;
  term: string;
  activities: string[];
  status: "active" | "expired" | "pending";
};

export type MeterReading = {
  id: string;
  siteId: string;
  contractId: string; // To know which contract the reading applies to for billing
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
  siteId?: string; // Optional: for detailed billing per site
};

export type Invoice = {
  id: string;
  contractId: string;
  clientId: string;
  clientName: string; // Denormalized
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

export type Typology = {
    id: string;
    name: string;
}

export type VatRate = {
    id: string;
    name: string;
    rate: number;
}

export type RevisionFormula = {
    id: string;
    code: string;
    formula: string;
}

export type PaymentTerm = {
    id: string;
    code: string;
    deadline: string;
}


// User Management Types
export type Role = {
    id: string;
    name: string;
}

export type User = {
    id: string;
    name: string;
    email: string;
    roleId: string;
    roleName?: string; // Optional for display
}
