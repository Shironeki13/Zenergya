'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SearchableOption } from '@/components/ui/searchable-select';
import { useData } from '@/context/data-context';
import type { CibleCommande } from '@/lib/commandes';
import type { Project } from '@/lib/projects/types';
import { getProjects } from '@/services/projects';

/** Affectation analytique d'une dépense (commande, heures) : clé de liste ↔ cible. */
export const cleDeCible = (c: CibleCommande) => (c.type === 'affaire' ? `a|${c.projectId}` : `c|${c.contractId}|${c.activityCode ?? ''}`);
export const cibleDeCle = (cle: string): CibleCommande | null => {
    const [t, a, b] = cle.split('|');
    return t === 'a' && a ? { type: 'affaire', projectId: a } : t === 'c' && a ? { type: 'contrat', contractId: a, ...(b && { activityCode: b }) } : null;
};

/** Affectations possibles : affaires de travaux ouvertes ; contrats actifs, par activité. */
export function useCiblesAnalytiques(companyId?: string): SearchableOption[] {
    const { contracts, activities } = useData();
    const [affaires, setAffaires] = useState<Project[]>([]);
    useEffect(() => { getProjects().then(l => setAffaires(l.filter(p => p.status !== 'cloture'))).catch(() => undefined); }, []);
    return useMemo(() => {
        const act = new Map(activities.map(a => [a.id, a]));
        return [
            ...affaires.filter(p => !companyId || p.companyId === companyId).map(p => ({ value: `a|${p.id}`, label: `Affaire ${p.code}`, description: `${p.clientName} — ${p.title}`, keywords: `${p.clientName} ${p.title} travaux` })),
            ...contracts.filter(k => k.status === 'Actif').flatMap(k => (k.activityIds ?? []).map(aid => act.get(aid)).filter(Boolean).map(a => ({
                value: `c|${k.id}|${a!.code}`, label: `Contrat ${k.contractNumber ?? ''} — ${a!.code}`, description: `${k.clientName}${k.label ? ` — ${k.label}` : ''} — ${a!.label}`, keywords: `${k.clientName} ${k.label ?? ''} ${a!.label}`,
            }))),
        ];
    }, [affaires, contracts, activities, companyId]);
}
