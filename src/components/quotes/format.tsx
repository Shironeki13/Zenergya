import { Badge } from '@/components/ui/badge';
import { QUOTE_STATUS_LABELS, type QuoteStatus } from '@/lib/quotes/types';

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

export const formatEur = (v: number | null | undefined) => (v === null || v === undefined ? '—' : EUR.format(v));
export const formatPct = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : `${(v * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;

const VARIANTS: Record<QuoteStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    brouillon: 'outline',
    envoye: 'secondary',
    accepte: 'default',
    refuse: 'destructive',
    expire: 'outline',
    annule: 'outline',
};

export function StatusBadge({ status }: { status: QuoteStatus }) {
    return <Badge variant={VARIANTS[status]}>{QUOTE_STATUS_LABELS[status]}</Badge>;
}
