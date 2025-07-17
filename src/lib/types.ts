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
  services: ContractService[];
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
