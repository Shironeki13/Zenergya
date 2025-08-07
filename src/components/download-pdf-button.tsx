'use client';

import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import type { generatePdfAction } from "@/app/(app)/invoices/[id]/actions";

interface DownloadPdfButtonProps {
    invoiceId: string;
    clientId: string;
    companyId: string;
    generatePdfAction: typeof generatePdfAction;
}

export function DownloadPdfButton({ invoiceId, clientId, companyId, generatePdfAction: formAction }: DownloadPdfButtonProps) {
    return (
        <form>
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="companyId" value={companyId} />
            <Button size="sm" type="submit" formAction={formAction}>
                <Printer className="h-4 w-4 mr-2" />
                Télécharger en PDF
            </Button>
        </form>
    );
}
