'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronLeft, ChevronRight, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import { useConfirm } from '@/components/confirm-provider';
import { cn } from '@/lib/utils';
import {
    ETAPES, LIBELLES_ETAPES, brouillonEntame, brouillonFinal, brouillonVide, depuisExtraction, erreursBrouillon, erreursEtape, lignesPrestations, montantNombre,
    type Brouillon, type Etape,
} from '@/lib/contracts/assistant';
import { PROMPT_MARCHE_PRIVE, PROMPT_MARCHE_PUBLIC } from '@/lib/contracts/prompts-extraction';
import { extractContractInfo } from '@/ai/flows/extract-contract-info-flow';
import { creerContratAction } from '@/lib/contracts/assistant-actions';
import { EtapeClient, EtapeContrat, EtapePrestations, EtapeSites, EtapeSource, type Refs } from '@/components/contracts/assistant/etapes';

/**
 * Assistant de création de contrat : Source (saisie ou PDF) → Client → Contrat → Sites → Prestations → Récapitulatif.
 * Le brouillon est enregistré dans le navigateur à chaque saisie et proposé à la reprise. Le contrat est créé au serveur
 * en une fois, « Brouillon » en attente de validation.
 */

const CLE_BROUILLON = 'zenergya.assistant-contrat';
type Sauvegarde = { b: Brouillon; etape: Etape; le: string };

export default function NouveauContratPage() {
    const router = useRouter();
    const { toast } = useToast();
    const confirmer = useConfirm();
    const { clients, sites, activities, typologies, companies, agencies, sectors, schedules, terms, vatRates, users, reloadData } = useData();
    const refs: Refs = useMemo(() => ({ clients, sites, activities, typologies, companies, agencies, sectors, schedules, terms, vatRates, users }),
        [clients, sites, activities, typologies, companies, agencies, sectors, schedules, terms, vatRates, users]);

    const [b, setB] = useState<Brouillon>(brouillonVide());
    const [etape, setEtape] = useState<Etape>('source');
    const [vues, setVues] = useState<Set<Etape>>(new Set(['source']));
    const [montrerErreurs, setMontrerErreurs] = useState(false);
    const [reprise, setReprise] = useState<Sauvegarde | null>(null);
    const [analyse, setAnalyse] = useState(false);
    const [consignes, setConsignes] = useState(PROMPT_MARCHE_PRIVE);
    const [creation, setCreation] = useState(false);
    const pret = useRef(false);

    // Démarrage : client imposé (?clientId=, depuis une fiche client) ou brouillon précédent à reprendre.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const clientId = params.get('clientId');
        const source = params.get('source');
        let sauvegarde: Sauvegarde | null = null;
        try { sauvegarde = JSON.parse(localStorage.getItem(CLE_BROUILLON) ?? 'null'); } catch { /* stockage indisponible */ }
        if (clientId) setB(brouillonVide(clientId));
        else if (sauvegarde && brouillonEntame(sauvegarde.b)) setReprise(sauvegarde);
        if (source === 'pdf-prive' || source === 'pdf-public') setB(x => ({ ...x, source, contrat: { ...x.contrat, marketType: source === 'pdf-public' ? 'Marché Public' : 'Marché Privé' } }));
        pret.current = true;
    }, []);
    useEffect(() => { setConsignes(b.source === 'pdf-public' ? PROMPT_MARCHE_PUBLIC : PROMPT_MARCHE_PRIVE); }, [b.source]);

    // Enregistrement du brouillon à chaque saisie (navigateur de l'utilisateur).
    useEffect(() => {
        // Rien à enregistrer tant que rien n'est saisi (ne pas écraser un brouillon proposé à la reprise).
        if (!pret.current || reprise || !brouillonEntame(b)) return;
        try { localStorage.setItem(CLE_BROUILLON, JSON.stringify({ b, etape, le: new Date().toISOString() } satisfies Sauvegarde)); } catch { /* stockage indisponible */ }
    }, [b, etape, reprise]);

    const maj = useCallback((f: (x: Brouillon) => Brouillon) => setB(f), []);
    const index = ETAPES.indexOf(etape);
    const erreurs = erreursEtape(etape, b);
    const toutes = useMemo(() => erreursBrouillon(b), [b]);

    const aller = (e: Etape) => { setEtape(e); setVues(v => new Set([...v, e])); setMontrerErreurs(false); window.scrollTo({ top: 0 }); };
    const suivant = () => {
        if (erreurs.length) { setMontrerErreurs(true); return; }
        aller(ETAPES[index + 1]);
    };

    const analyser = async (fichier: File) => {
        setAnalyse(true);
        try {
            const documentDataUri = await new Promise<string>((ok, ko) => {
                const r = new FileReader();
                r.onload = () => ok(String(r.result));
                r.onerror = () => ko(new Error('Lecture du fichier impossible.'));
                r.readAsDataURL(fichier);
            });
            const x = await extractContractInfo({
                documentDataUri, prompt: consignes,
                activities: activities.map(a => ({ id: a.id, code: a.code, label: a.label })),
                typologies: typologies.map(t => ({ id: t.id, name: t.name })),
                terms: terms.map(t => ({ id: t.id, name: t.name })), schedules: schedules.map(s => ({ id: s.id, name: s.name })),
            });
            const suite = depuisExtraction(b, x, { typologies, clients });
            setB(suite);
            toast({ title: 'PDF analysé', description: `${suite.lusDansPdf.length} information(s) lue(s), à vérifier.${suite.client.mode === 'existant' ? ' Client déjà connu : sélectionné.' : ''}` });
            aller('client');
        } catch (e) {
            toast({ title: 'Analyse impossible', description: e instanceof Error ? e.message : 'Réessayez ou passez en saisie.', variant: 'destructive' });
        } finally {
            setAnalyse(false);
        }
    };

    const creer = async () => {
        const final = brouillonFinal(b);
        const bloquantes = ETAPES.filter(e => erreursEtape(e, final).length);
        if (bloquantes.length) { aller(bloquantes[0]); setMontrerErreurs(true); return; }
        setCreation(true);
        const r = await creerContratAction(final);
        setCreation(false);
        if (!r.success) { toast({ title: 'Création impossible', description: r.error, variant: 'destructive' }); return; }
        try { localStorage.removeItem(CLE_BROUILLON); } catch { /* stockage indisponible */ }
        await reloadData();
        toast({ title: `Contrat ${r.data.contractNumber} créé`, description: 'En attente de validation. Complétez au besoin le paramétrage P1 sur ses sites.' });
        router.push(`/contracts/${r.data.contractId}`);
    };

    const recommencer = async () => {
        if (brouillonEntame(b) && !(await confirmer({ title: 'Effacer la saisie en cours ?', description: 'Le brouillon sera perdu.', confirmLabel: 'Effacer', destructive: true }))) return;
        try { localStorage.removeItem(CLE_BROUILLON); } catch { /* stockage indisponible */ }
        setB(brouillonVide()); setReprise(null); aller('source'); setVues(new Set(['source']));
    };

    return (
        <div className="mx-auto max-w-5xl space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Nouveau contrat</h1>
                    <p className="text-muted-foreground">Client, contrat, sites et prestations en quelques étapes. La saisie est enregistrée automatiquement dans ce navigateur.</p>
                </div>
                <Button variant="ghost" size="sm" onClick={recommencer}><RotateCcw className="mr-1 h-4 w-4" />Recommencer</Button>
            </div>

            {reprise && (
                <div className="flex flex-wrap items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                    <span>Un contrat était en cours de saisie ({new Date(reprise.le).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}{reprise.b.contrat.label ? ` : « ${reprise.b.contrat.label} »` : ''}).</span>
                    <Button size="sm" onClick={() => { setB(reprise.b); setVues(new Set(ETAPES.slice(0, ETAPES.indexOf(reprise.etape) + 1))); setEtape(reprise.etape); setReprise(null); }}>Reprendre</Button>
                    <Button size="sm" variant="outline" onClick={() => { try { localStorage.removeItem(CLE_BROUILLON); } catch { /* */ } setReprise(null); }}>Nouveau</Button>
                </div>
            )}

            {/* Étapes */}
            <ol className="flex flex-wrap items-center gap-1 text-sm" aria-label="Étapes">
                {ETAPES.map((e, i) => {
                    const faite = i < index && vues.has(e) && !toutes[e].length;
                    const accessible = vues.has(e);
                    return (
                        <li key={e} className="flex items-center gap-1">
                            {i > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />}
                            <button type="button" disabled={!accessible} onClick={() => aller(e)} aria-current={e === etape ? 'step' : undefined}
                                className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors',
                                    e === etape ? 'bg-primary text-primary-foreground' : accessible ? 'hover:bg-muted' : 'text-muted-foreground opacity-60')}>
                                <span className={cn('flex h-5 w-5 items-center justify-center rounded-full border text-[11px]', e === etape && 'border-primary-foreground')}>
                                    {faite ? <Check className="h-3 w-3" /> : i + 1}
                                </span>
                                {LIBELLES_ETAPES[e]}
                            </button>
                        </li>
                    );
                })}
            </ol>

            <Card>
                <CardHeader className="pb-3"><CardTitle className="text-lg">{index + 1}. {LIBELLES_ETAPES[etape]}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    {montrerErreurs && erreurs.length > 0 && (
                        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                            <p className="font-medium">À compléter avant de continuer :</p>
                            <ul className="mt-1 list-disc pl-5">{erreurs.map(m => <li key={m}>{m}</li>)}</ul>
                        </div>
                    )}
                    {etape === 'source' && <EtapeSource b={b} maj={maj} refs={refs} onAnalyser={analyser} analyse={analyse} consignes={consignes} setConsignes={setConsignes} />}
                    {etape === 'client' && <EtapeClient b={b} maj={maj} refs={refs} />}
                    {etape === 'contrat' && <EtapeContrat b={b} maj={maj} refs={refs} />}
                    {etape === 'sites' && <EtapeSites b={b} maj={maj} refs={refs} />}
                    {etape === 'prestations' && <EtapePrestations b={b} maj={maj} refs={refs} />}
                    {etape === 'recapitulatif' && <Recapitulatif b={b} refs={refs} erreurs={toutes} onModifier={aller} />}
                </CardContent>
            </Card>

            <div className="flex items-center justify-between">
                <Button variant="outline" disabled={index === 0} onClick={() => aller(ETAPES[index - 1])}><ChevronLeft className="mr-1 h-4 w-4" />Précédent</Button>
                {etape === 'recapitulatif' ? (
                    <Button onClick={creer} disabled={creation || ETAPES.some(e => toutes[e].length)}>
                        {creation && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Créer le contrat
                    </Button>
                ) : (
                    <Button onClick={suivant}>
                        {etape === 'source' && b.source !== 'saisie' && !b.lusDansPdf.length ? 'Continuer sans PDF' : 'Suivant'}<ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                )}
            </div>
        </div>
    );
}

function Recapitulatif({ b, refs, erreurs, onModifier }: { b: Brouillon; refs: Refs; erreurs: Record<Etape, string[]>; onModifier: (e: Etape) => void }) {
    const client = b.client.mode === 'existant' ? refs.clients.find(c => c.id === b.client.clientId) : null;
    const lignes = lignesPrestations(b).filter(l => b.prestations.saisir && l.montant.trim());
    const total = lignes.reduce((t, l) => t + (montantNombre(l.montant) || 0), 0);
    const nomSite = (cle: string) => b.sites.nouveaux.find(s => s.cle === cle)?.name || refs.sites.find(s => s.id === cle)?.name || 'Site';
    const nom = (id: string, liste: { id: string; name?: string; label?: string; code?: string }[]) => { const x = liste.find(y => y.id === id); return x?.name ?? x?.label ?? x?.code ?? '—'; };
    const Bloc = ({ e, children }: { e: Etape; children: React.ReactNode }) => (
        <div className="rounded-md border p-3">
            <div className="mb-1 flex items-center justify-between">
                <p className="font-medium">{LIBELLES_ETAPES[e]}</p>
                <Button variant="link" size="sm" className="h-auto p-0" onClick={() => onModifier(e)}>Modifier</Button>
            </div>
            <div className="text-sm text-muted-foreground">{children}</div>
            {erreurs[e].length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-destructive">{erreurs[e].map(m => <li key={m}>{m}</li>)}</ul>}
        </div>
    );
    const c = b.contrat;
    return (
        <div className="space-y-3">
            <Bloc e="client">
                {client ? <>{client.name} {client.externalCode && <span className="font-mono text-xs">({client.externalCode})</span>} — client existant</>
                    : <>{b.client.nouveau.name || '—'} — <strong>nouveau client</strong> ({b.client.nouveau.clientType === 'public' ? 'public' : 'privé'}, {[b.client.nouveau.postalCode, b.client.nouveau.city].filter(Boolean).join(' ')})
                        {b.client.nouveau.contactFacturation.email && <>, contact de facturation {b.client.nouveau.contactFacturation.email}</>}</>}
            </Bloc>
            <Bloc e="contrat">
                « {c.label || '—'} », du {c.startDate ? new Date(c.startDate).toLocaleDateString('fr-FR') : '—'} au {c.endDate ? new Date(c.endDate).toLocaleDateString('fr-FR') : '—'}
                {c.marketType && <> · {c.marketType}</>} · activités : {c.activityIds.map(id => refs.activities.find(a => a.id === id)?.code).filter(Boolean).join(', ') || '—'}
                {' '}· facturation {c.invoicingType === 'global' ? 'globale' : 'par site'}{c.scheduleId && <>, {nom(c.scheduleId, refs.schedules).toLowerCase()}</>}
                {c.billingManagerId && <> · responsable : {(() => { const u = refs.users.find(x => x.id === c.billingManagerId); return u ? [u.firstName, u.name].filter(Boolean).join(' ') : '—'; })()}</>}
            </Bloc>
            <Bloc e="sites">
                {[...b.sites.existants.map(id => `${nom(id, refs.sites)} (existant)`), ...b.sites.nouveaux.map(s => `${s.name || 'sans nom'} (nouveau)`)].join(', ') || 'Aucun site'}
            </Bloc>
            <Bloc e="prestations">
                {!b.prestations.saisir ? 'À saisir plus tard, sur la fiche de chaque site.'
                    : lignes.length === 0 ? 'Aucun montant saisi : aucune prestation créée (à saisir sur la fiche de chaque site).'
                        : <>{lignes.length} prestation(s), {total.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} HT par an : {lignes.map(l => `${nomSite(l.site)} / ${refs.activities.find(a => a.id === l.activityId)?.code}`).join(', ')}</>}
            </Bloc>
            <p className="text-sm text-muted-foreground">
                Le contrat est créé « Brouillon », <strong>en attente de validation</strong> (Clients et contrats › Validation des contrats). Le paramétrage P1 se fait ensuite sur
                la fiche de chaque site.
            </p>
        </div>
    );
}
