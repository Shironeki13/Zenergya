'use client';

import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ControleDocument } from '@/components/contracts/validation/controle-document';
import { useData } from '@/context/data-context';
import { useToast } from '@/hooks/use-toast';
import type { ElementAValider, TypeValidation } from '@/lib/validations';
import { fileValidationAction } from '@/lib/validations-actions';

/**
 * Valider ou refuser un document là où on le regarde (contrathèque, fiche du contrat, vie du contrat) : ouvre l'écran
 * de contrôle du document désigné. Réservé à ceux qui valident (contrathèque et administrateurs).
 */

export type CibleValidation = { type: TypeValidation; id: string };

/** Écran de contrôle ouvert sur une cible (null : fermé). Le document est relu au serveur à l'ouverture. */
export function ControleCible({ cible, onClose, onTraite }: { cible: CibleValidation | null; onClose: () => void; onTraite: () => Promise<void> | void }) {
    const { toast } = useToast();
    const [element, setElement] = useState<ElementAValider | null>(null);
    const fermer = useCallback(() => { setElement(null); onClose(); }, [onClose]);
    useEffect(() => {
        if (!cible) { setElement(null); return; }
        let actif = true;
        (async () => {
            const r = await fileValidationAction();
            if (!actif) return;
            const e = r.success ? r.data.find(x => x.type === cible.type && x.id === cible.id) : undefined;
            if (e) setElement(e);
            else { toast({ title: 'Document introuvable', description: r.success ? "Il n'est plus en attente : il a déjà été validé ou refusé." : r.error, variant: 'destructive' }); onClose(); }
        })();
        return () => { actif = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cible?.type, cible?.id]);
    return <ControleDocument element={element} onClose={fermer} onTraite={onTraite} />;
}

/** Bouton « Contrôler » d'un document en attente ; rien pour qui ne valide pas. */
export function BoutonValidation({ cible, onTraite, libelle = 'Contrôler', className }: { cible: CibleValidation; onTraite: () => Promise<void> | void; libelle?: string; className?: string }) {
    const { isContratheque } = useData();
    const [ouvert, setOuvert] = useState<CibleValidation | null>(null);
    if (!isContratheque) return null;
    return (
        <>
            <Button type="button" size="sm" variant="outline" className={className ?? 'h-8 shrink-0 gap-1'} onClick={() => setOuvert(cible)} disabled={!!ouvert}>
                {ouvert ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}{libelle}
            </Button>
            <ControleCible cible={ouvert} onClose={() => setOuvert(null)} onTraite={onTraite} />
        </>
    );
}
