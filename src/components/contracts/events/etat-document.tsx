'use client';

import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ValidationDocument } from '@/lib/types';

/** État de validation d'un document de contrat (historique du contrat). Absent : antérieur à la validation. */
export function EtatValidation({ doc }: { doc: ValidationDocument }) {
    if (doc.validationStatus === 'pending_validation') return <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800">En attente</Badge>;
    if (doc.validationStatus === 'refused') return <Badge variant="destructive" title={doc.refusalReason}>Refusé{doc.refusalReason ? ` : ${doc.refusalReason}` : ''}</Badge>;
    if (doc.validationStatus === 'validated') {
        const corr = doc.corrections ?? [];
        const quand = doc.validatedAt ? ` le ${new Date(doc.validatedAt).toLocaleDateString('fr-FR')}` : '';
        return (
            <span className="inline-flex flex-wrap items-center gap-1">
                <Badge variant="secondary" title={doc.validatedBy ? `par ${doc.validatedBy}${quand}` : undefined}>Validé</Badge>
                {corr.length > 0 && (
                    <Badge variant="outline" className="border-amber-400 text-amber-800"
                        title={corr.map(c => `${c.libelle} : ${c.avant} → ${c.apres} (${c.par})`).join('\n')}>
                        {corr.length} correction{corr.length > 1 ? 's' : ''}
                    </Badge>
                )}
            </span>
        );
    }
    return <span className="text-xs text-muted-foreground">—</span>;
}

/** Lien vers la pièce justificative. */
export function LienPiece({ doc }: { doc: { documentUrl?: string; documentName?: string } }) {
    if (!doc.documentUrl) return <span className="text-xs text-muted-foreground">Aucun</span>;
    return (
        <a href={doc.documentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-[160px] items-center gap-1 text-sm text-primary underline">
            <FileText className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{doc.documentName ?? 'Ouvrir'}</span>
        </a>
    );
}
