'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

/** Recopie un paramètre d'adresse (ex. « ?q= » posé par la recherche globale) dans l'état d'une page. */
function Sync({ name, onValue }: { name: string; onValue: (v: string) => void }) {
    const params = useSearchParams();
    const value = params.get(name);
    useEffect(() => { if (value !== null) onValue(value); }, [value, onValue]);
    return null;
}

export function SearchParamSync(props: { name: string; onValue: (v: string) => void }) {
    return <Suspense fallback={null}><Sync {...props} /></Suspense>;
}
