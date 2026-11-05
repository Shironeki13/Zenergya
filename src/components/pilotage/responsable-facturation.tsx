'use client';

import { useState } from 'react';
import { UserCheck } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useData } from '@/context/data-context';
import { useToast } from '@/hooks/use-toast';
import { definirResponsableAction } from '@/lib/pilotage/actions';

const AUCUN = '__aucun__';

/** Responsable facturation (utilisateur ADV) d'un contrat : son portefeuille dans le pilotage de la facturation. */
export function ResponsableFacturation({ contractId, value, onChange }: { contractId: string; value?: string | null; onChange?: (id: string | null) => void }) {
    const { users } = useData();
    const { toast } = useToast();
    const [courant, setCourant] = useState<string | null>(value ?? null);
    const [envoi, setEnvoi] = useState(false);
    const nom = (u: { firstName?: string; name: string; email: string }) => [u.firstName, u.name].filter(Boolean).join(' ') || u.email;
    const changer = async (v: string) => {
        const id = v === AUCUN ? null : v;
        setEnvoi(true);
        const r = await definirResponsableAction(contractId, id);
        setEnvoi(false);
        if (!r.success) { toast({ title: 'Modification refusée', description: r.error, variant: 'destructive' }); return; }
        setCourant(id);
        onChange?.(id);
        toast({ title: 'Responsable facturation', description: id ? `Affecté à ${nom(users.find(u => u.id === id)!)}.` : 'Retiré.' });
    };
    return (
        <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="shrink-0">Responsable facturation :</span>
            <Select value={courant ?? AUCUN} onValueChange={changer} disabled={envoi}>
                <SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem value={AUCUN}>Aucun</SelectItem>
                    {[...users].sort((a, b) => nom(a).localeCompare(nom(b), 'fr')).map(u => <SelectItem key={u.id} value={u.id}>{nom(u)}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>
    );
}
