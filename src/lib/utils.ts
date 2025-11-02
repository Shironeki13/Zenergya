import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { parse } from 'papaparse';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function downloadCSV<T extends object>(data: T[], filename: string) {
  if (!data || data.length === 0) {
    console.error("No data available to download.");
    return;
  }

  // Flatten nested objects for CSV export
  const flattenedData = data.map(row => {
    const flatRow: {[key: string]: any} = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        for (const [nestedKey, nestedValue] of Object.entries(value)) {
          flatRow[`${key}_${nestedKey}`] = nestedValue;
        }
      } else if (Array.isArray(value)) {
        flatRow[key] = value.join('; ');
      }
      else {
        flatRow[key] = value;
      }
    }
    return flatRow;
  });

  const csv = parse(flattenedData, { header: true });
  
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
