import { redirect } from 'next/navigation';

/** Ancien formulaire, remplacé par l'assistant de création de contrat. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const p = new URLSearchParams();
    const clientId = (await searchParams).clientId;
    if (typeof clientId === 'string') p.set('clientId', clientId);
    p.set('source', 'pdf-public');
    redirect(`/contracts/nouveau${p.size ? `?${p}` : ''}`);
}
