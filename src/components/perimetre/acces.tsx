'use client';

import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useData } from '@/context/data-context';

/** Écran affiché à la place d'une page ou d'une fiche à laquelle l'utilisateur n'a pas accès (module ou périmètre). */
export function AccesRefuse({ motif = 'perimetre', objet }: { motif?: 'perimetre' | 'module'; objet?: string }) {
    return (
        <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-3 text-center" role="alert">
            <ShieldAlert className="h-10 w-10 text-muted-foreground" />
            <h1 className="text-xl font-semibold">{motif === 'module' ? 'Accès non autorisé' : 'Hors de votre périmètre'}</h1>
            <p className="text-sm text-muted-foreground">
                {motif === 'module'
                    ? 'Cette page ne fait pas partie de vos modules. Un administrateur peut vous y donner accès (Utilisateurs).'
                    : `${objet ?? 'Cet élément'} est rattaché à une société, une agence ou un secteur qui ne fait pas partie de votre périmètre. Un administrateur peut l'élargir (Utilisateurs).`}
            </p>
            <Button asChild variant="outline"><Link href="/dashboard">Retour au tableau de bord</Link></Button>
        </div>
    );
}

/**
 * Garde d'une fiche : `true` quand le client de l'objet est hors du périmètre de l'utilisateur. Tant que le client
 * n'est pas connu (fiche en cours de chargement), rien n'est refusé.
 *   const hors = useHorsPerimetre(contract?.clientId);
 *   if (hors) return <AccesRefuse objet="Ce contrat" />;
 */
export function useHorsPerimetre(clientId: string | null | undefined): boolean {
    const { voitClient, isLoading } = useData();
    return !isLoading && !!clientId && !voitClient(clientId);
}
