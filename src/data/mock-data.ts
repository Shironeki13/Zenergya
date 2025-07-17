import type { Client, Contract, Invoice, MeterReading } from "@/lib/types";

export const clients: Client[] = [
  { id: "cli-001", name: "Stark Industries" },
  { id: "cli-002", name: "Wayne Enterprises" },
  { id: "cli-003", name: "Cyberdyne Systems" },
  { id: "cli-004", name: "Ollivanders Wand Shop" },
];

export const contracts: Contract[] = [
  {
    id: "con-001",
    clientId: "cli-001",
    clientName: "Stark Industries",
    startDate: "2023-01-15",
    endDate: "2025-01-14",
    billingSchedule: "quarterly",
    services: ["heating", "fixed_subscription"],
    status: "active",
  },
  {
    id: "con-002",
    clientId: "cli-002",
    clientName: "Wayne Enterprises",
    startDate: "2023-03-01",
    endDate: "2024-02-28",
    billingSchedule: "annually",
    services: ["hot_water", "heating"],
    status: "active",
  },
  {
    id: "con-003",
    clientId: "cli-003",
    clientName: "Cyberdyne Systems",
    startDate: "2022-06-10",
    endDate: "2023-06-09",
    billingSchedule: "end_of_term",
    services: ["fixed_subscription"],
    status: "expired",
  },
  {
    id: "con-004",
    clientId: "cli-004",
    clientName: "Ollivanders Wand Shop",
    startDate: "2024-08-01",
    endDate: "2026-07-31",
    billingSchedule: "quarterly",
    services: ["hot_water", "heating", "fixed_subscription"],
    status: "pending",
  },
];

export const meterReadings: MeterReading[] = [
  { id: "mr-001", contractId: "con-001", date: "2024-03-31", reading: 15000, unit: "kWh", service: "heating" },
  { id: "mr-002", contractId: "con-002", date: "2024-02-28", reading: 8000, unit: "kWh", service: "hot_water" },
  { id: "mr-003", contractId: "con-002", date: "2024-02-28", reading: 12000, unit: "kWh", service: "heating" },
  { id: "mr-004", contractId: "con-001", date: "2024-06-30", reading: 15800, unit: "kWh", service: "heating" },
];

export const invoices: Invoice[] = [
  {
    id: "inv-2024-001",
    contractId: "con-001",
    clientName: "Stark Industries",
    date: "2024-04-05",
    dueDate: "2024-05-05",
    status: "paid",
    lineItems: [
      { description: "Heating (Q1 2024)", quantity: 500, unitPrice: 0.15, total: 75.00 },
      { description: "Fixed Subscription (Q1 2024)", quantity: 1, unitPrice: 200.00, total: 200.00 },
    ],
    subtotal: 275.00,
    tax: 27.50,
    total: 302.50,
  },
  {
    id: "inv-2024-002",
    contractId: "con-002",
    clientName: "Wayne Enterprises",
    date: "2024-03-01",
    dueDate: "2024-04-01",
    status: "paid",
    lineItems: [
      { description: "Hot Water (Annual)", quantity: 8000, unitPrice: 0.12, total: 960.00 },
      { description: "Heating (Annual)", quantity: 12000, unitPrice: 0.15, total: 1800.00 },
    ],
    subtotal: 2760.00,
    tax: 276.00,
    total: 3036.00,
  },
  {
    id: "inv-2024-003",
    contractId: "con-001",
    clientName: "Stark Industries",
    date: "2024-07-05",
    dueDate: "2024-08-05",
    status: "due",
    lineItems: [
      { description: "Heating (Q2 2024)", quantity: 800, unitPrice: 0.15, total: 120.00 },
      { description: "Fixed Subscription (Q2 2024)", quantity: 1, unitPrice: 200.00, total: 200.00 },
    ],
    subtotal: 320.00,
    tax: 32.00,
    total: 352.00,
  },
  {
    id: "inv-2023-010",
    contractId: "con-003",
    clientName: "Cyberdyne Systems",
    date: "2023-06-10",
    dueDate: "2023-07-10",
    status: "overdue",
    lineItems: [
      { description: "Fixed Subscription (Final)", quantity: 1, unitPrice: 1500.00, total: 1500.00 },
    ],
    subtotal: 1500.00,
    tax: 150.00,
    total: 1650.00,
  },
];
