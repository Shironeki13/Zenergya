'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CalendarPlus, CheckCircle2, ExternalLink, Eye, EyeOff, FileText, Loader2, Receipt, Maximize2, RefreshCw, RotateCcw, SkipForward } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { optionsClients } from '@/lib/select-options';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import { generateInvoice } from '@/ai/flows/generate-invoice-flow';
import { apercuFacturationAction, previewBatchBillingAction } from '@/lib/billing/actions';
import { fileFacturation, libelleRetard, suivant, type ContratAFacturer } from '@/lib/billing/file';
import { frDay, vatTotals } from '@/lib/billing/contract-billing';
import { basculer, cochable, controleSelection, lienBlocage, lignesRetenues } from '@/lib/billing/selection';
import type { ApercuFacturation } from '@/services/contract-billing-admin';

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const jourParis = (d: string) => new Date(d).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
const aujourdhui = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

type Emise = { id: string; numero?: string; proforma: boolean; total: number; contrat: string };

function Facturation() {
    const { contracts, clients, sites, isLoading } = useData();
    const { toast } = useToast();
    const contratInitial = useSearchParams().get('contrat');

    const [contratId, setContratId] = useState<string | null>(contratInitial);
    const [apercu, setApercu] = useState<ApercuFacturation | null>(null);
    const [selection, setSelection] = useState<string[]>([]);
    const [chargement, setChargement] = useState(false);
    const [erreur, setErreur] = useState<string | null>(null);
    // Une pièce n'est ni antidatée ni postdatée : la date de la facture est celle du jour (imposée aussi par le serveur).
    const date = aujourdhui();
    const [clientId, setClientId] = useState<string | null>(null);
    const [filtre, setFiltre] = useState('');
    const [envoi, setEnvoi] = useState<'proforma' | 'facture' | null>(null);
    const [emise, setEmise] = useState<Emise | null>(null);
    // Aperçu PDF en direct : recalculé peu après chaque changement de sélection ou de date.
    const [voirPdf, setVoirPdf] = useState(true);
    const [pdf, setPdf] = useState<{ url?: string; erreur?: string; calcul?: boolean }>({});
    const demande = useRef(0);
    // File de travail : contrats ayant quelque chose à facturer aujourd'hui, les plus en retard d'abord.
    const [file, setFile] = useState<{ contrats?: ContratAFacturer[]; erreur?: string; calcul?: boolean }>({});
    const chargerFile = useCallback(async () => {
        setFile(f => ({ ...f, calcul: true, erreur: undefined }));
        const r = await previewBatchBillingAction(aujourdhui());
        setFile(r.success ? { contrats: fileFacturation(r.data, aujourdhui()) } : { erreur: r.error });
    }, []);
    useEffect(() => { void chargerFile(); }, [chargerFile]);

    // Le client d'abord, puis ses contrats (validés) ; un lien direct ?contrat=… retrouve le client.
    const facturables = useMemo(() => contracts.filter(c => c.status !== 'Brouillon' && c.validationStatus === 'validated'), [contracts]);
    useEffect(() => {
        if (clientId || !contratId) return;
        const c = contracts.find(x => x.id === contratId);
        if (c) setClientId(c.clientId);
    }, [clientId, contratId, contracts]);
    const duClient = useMemo(() => facturables.filter(c => c.clientId === clientId)
        .sort((a, b) => (a.status === 'Actif' ? 0 : 1) - (b.status === 'Actif' ? 0 : 1) || (a.contractNumber ?? '').localeCompare(b.contractNumber ?? '')), [facturables, clientId]);
    const norm = (t: unknown) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const sitesDe = (id: string) => sites.filter(x => x.contractId === id);
    const visibles = duClient.filter(c => norm(filtre).split(/\s+/).filter(Boolean).every(m => norm([c.contractNumber, c.label, c.name, c.externalRef, ...sitesDe(c.id).flatMap(x => [x.name, x.city, x.code])].join(' ')).includes(m)));

    const charger = useCallback(async (id: string, jusquAu?: string, garder?: string[]) => {
        setChargement(true); setErreur(null);
        const r = await apercuFacturationAction(id, jusquAu);
        setChargement(false);
        if (!r.success) { setApercu(null); setErreur(r.error); return; }
        setApercu(r.data);
        // Tout ce qui est dû est coché d'avance ; en élargissant l'horizon, la sélection en cours est conservée.
        const dues = r.data.echeances;
        const libres = dues.filter(e => cochable(dues, e));
        setSelection(garder ? libres.filter(e => garder.includes(e.id)).map(e => e.id) : libres.filter(e => e.facturableLe <= aujourdhui()).map(e => e.id));
    }, []);

    useEffect(() => { if (contratId) { setEmise(null); void charger(contratId); } else setApercu(null); }, [contratId, charger]);

    // L'adresse n'est pas modifiée à la sélection : toute navigation annulerait le calcul en cours. Un lien ?contrat=… ouvre un contrat.
    const choisir = (id: string) => {
        setContratId(id || null);
        const c = id ? contracts.find(x => x.id === id) : null;
        if (c) setClientId(c.clientId);
    };
    const choisirClient = (id: string) => { setClientId(id || null); setFiltre(''); setContratId(null); };
    // Un seul contrat pour ce client : il est ouvert directement.
    useEffect(() => { if (clientId && !contratId && duClient.length === 1) choisir(duClient[0].id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId, duClient.length]);

    const dues = apercu?.echeances ?? [];
    const totaux = useMemo(() => vatTotals(lignesRetenues(dues, selection)), [dues, selection]);
    const anomalies = dues.length ? controleSelection(dues, selection) : [];
    const bloque = !apercu || apercu.blocages.length > 0 || anomalies.length > 0 || !!envoi || chargement;
    const bloquees = dues.filter(e => e.blocage).length;
    const prochain = file.contrats ? suivant(file.contrats, contratId) : null;
    const horizon = (sel: string[]) => { const u = dues.filter(e => sel.includes(e.id)).map(e => e.facturableLe).sort().at(-1); return u && apercu && u > apercu.jusquAu ? u : apercu?.jusquAu; };

    const cleApercu = apercu && voirPdf && selection.length > 0 && anomalies.length === 0 && apercu.blocages.length === 0 && !emise ? `${apercu.contrat.id}|${date}|${selection.join(',')}` : null;
    useEffect(() => {
        if (!cleApercu || !apercu) { setPdf(p => { if (p.url) URL.revokeObjectURL(p.url); return {}; }); return; }
        const n = ++demande.current;
        setPdf(p => ({ ...p, calcul: true, erreur: undefined }));
        const t = setTimeout(async () => {
            try {
                const r = await fetch('/api/documents/apercu', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contractId: apercu.contrat.id, invoiceDate: date, until: horizon(selection), selection }) });
                if (n !== demande.current) return;
                if (!r.ok) { const e = await r.json().catch(() => ({})); setPdf(p => { if (p.url) URL.revokeObjectURL(p.url); return { erreur: e.error ?? 'Aperçu impossible.' }; }); return; }
                const url = URL.createObjectURL(await r.blob());
                setPdf(p => { if (p.url) URL.revokeObjectURL(p.url); return { url }; });
            } catch { if (n === demande.current) setPdf({ erreur: 'Aperçu impossible.' }); }
        }, 500);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cleApercu]);

    const emettre = async (proforma: boolean) => {
        if (!apercu) return;
        setEnvoi(proforma ? 'proforma' : 'facture');
        const r = await generateInvoice({ contractId: apercu.contrat.id, invoiceDate: date, isProforma: proforma, until: horizon(selection), selection });
        setEnvoi(null);
        if (!r.success || !r.invoiceId) { toast({ title: 'Émission impossible', description: r.error ?? 'Erreur inconnue.', variant: 'destructive' }); void charger(apercu.contrat.id); return; }
        setEmise({ id: r.invoiceId, numero: r.invoiceNumber, proforma, total: totaux.total, contrat: [apercu.contrat.numero, apercu.contrat.client].filter(Boolean).join(' · ') });
        // Ce qui reste dû après cette facture, et la file sans ce qui vient d'être facturé.
        void charger(apercu.contrat.id);
        void chargerFile();
    };

    return (
        <div className={voirPdf && pdf.url ? 'grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : ''}>
        <div className="space-y-6 max-w-4xl">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Facturation manuelle</h1>
                <p className="text-sm text-muted-foreground">Choisissez un contrat : ce qui est dû s'affiche, vous vérifiez puis vous émettez.</p>
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">1. Quel client, quel contrat ?</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {isLoading ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : (
                        <SearchableSelect id="client-recherche" value={clientId} onValueChange={choisirClient} options={optionsClients(clients)} clearable
                            placeholder="Choisir un client…" searchPlaceholder="Nom, code client, SIRET, ville…" emptyText="Aucun client ne correspond." className="w-full" />
                    )}
                    {clientId && !isLoading && (
                        <div className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <Label className="text-sm">{duClient.length} contrat{duClient.length > 1 ? 's' : ''} de ce client</Label>
                                {duClient.length > 5 && <Input value={filtre} onChange={e => setFiltre(e.target.value)} placeholder="Filtrer : n°, libellé, site…" className="h-8 w-64" aria-label="Filtrer les contrats" />}
                            </div>
                            {duClient.length === 0 && <p className="text-sm text-muted-foreground">Aucun contrat validé pour ce client.</p>}
                            {duClient.length > 0 && (
                                <div className="divide-y rounded-md border" data-liste="contrats-client">
                                    {visibles.map(c => {
                                        const st = sitesDe(c.id);
                                        const du = file.contrats?.find(x => x.id === c.id);
                                        return (
                                            <div key={c.id} className={`flex items-center gap-2 ${c.id === contratId ? 'bg-primary/5' : ''}`}>
                                                <button type="button" onClick={() => choisir(c.id)} aria-pressed={c.id === contratId} className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left hover:bg-muted/40">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                                            <span className="font-mono text-xs">{c.contractNumber}</span><span className="truncate">{c.label || c.name}</span>
                                                            {c.status !== 'Actif' && <Badge variant="outline">{c.status}</Badge>}
                                                            {du?.blocage && <Badge variant="destructive">blocage</Badge>}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {st.length === 1 ? st[0].name : `${st.length} sites`} — du {jourParis(c.startDate)} au {jourParis(c.endDate)}
                                                        </div>
                                                    </div>
                                                    <div className="whitespace-nowrap text-right text-xs">
                                                        {du ? <span className="text-sm font-semibold tabular-nums">{eur(du.montantHT)} HT à facturer</span> : file.contrats ? <span className="text-muted-foreground">à jour</span> : null}
                                                    </div>
                                                </button>
                                                <Button asChild variant="ghost" size="icon" className="mr-2 h-8 w-8 shrink-0" title="Ouvrir la fiche du contrat dans un nouvel onglet">
                                                    <a href={`/contracts/${c.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir la fiche du contrat ${c.contractNumber ?? ''}`}><ExternalLink className="h-4 w-4" /></a>
                                                </Button>
                                            </div>
                                        );
                                    })}
                                    {visibles.length === 0 && <p className="p-3 text-sm text-muted-foreground">Aucun contrat ne correspond au filtre.</p>}
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {!clientId && !contratId && (
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <CardTitle className="text-base">À facturer aujourd'hui</CardTitle>
                            <Button variant="ghost" size="sm" disabled={file.calcul} onClick={chargerFile}><RefreshCw className={`mr-2 h-4 w-4 ${file.calcul ? 'animate-spin' : ''}`} />Actualiser</Button>
                        </div>
                        <CardDescription>
                            {file.contrats
                                ? file.contrats.length === 0 ? 'Tout est facturé : aucun contrat de votre périmètre n\'a d\'échéance due.'
                                    : `${file.contrats.length} contrat${file.contrats.length > 1 ? 's' : ''} — ${eur(file.contrats.reduce((a, c) => a + c.montantHT, 0))} HT à facturer, les plus en retard d'abord. Cliquez sur une ligne pour la traiter.`
                                : file.erreur ?? 'Calcul de ce qui est dû sur vos contrats…'}
                        </CardDescription>
                    </CardHeader>
                    {file.contrats && file.contrats.length > 0 && (
                        <CardContent>
                            <div className="divide-y rounded-md border">
                                {file.contrats.map(c => (
                                    <button key={c.id} type="button" onClick={() => choisir(c.id)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/40">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                                <span className="font-mono text-xs">{c.numero}</span><span className="truncate">{c.client}</span>
                                                {c.blocage && <Badge variant="destructive" title={c.blocage}>blocage</Badge>}
                                                {c.retard > 30 && <Badge variant="outline" className="border-amber-500 text-amber-700">en retard</Badge>}
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                {c.debut ? `du ${frDay(c.debut)} au ${frDay(c.fin)} — ` : ''}{libelleRetard(c.retard)}
                                            </div>
                                        </div>
                                        <div className="whitespace-nowrap text-sm font-semibold tabular-nums">{c.montantHT ? `${eur(c.montantHT)} HT` : '—'}</div>
                                    </button>
                                ))}
                            </div>
                        </CardContent>
                    )}
                </Card>
            )}

            {erreur && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Aperçu impossible</AlertTitle><AlertDescription>{erreur}</AlertDescription></Alert>}

            {emise && (
                <Card className="border-emerald-500/50">
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-5 w-5 text-emerald-600" />
                            {emise.proforma ? 'Proforma créé' : `Facture ${emise.numero ?? ''} émise`}
                        </CardTitle>
                        <CardDescription>{emise.contrat} — {eur(emise.total)} TTC{emise.proforma ? ' — sans valeur comptable, à transformer en facture depuis la liste des factures' : ''}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                        <Button asChild><a href={`/api/documents/invoices/${emise.id}`} target="_blank" rel="noopener noreferrer"><FileText className="mr-2 h-4 w-4" />Ouvrir le PDF</a></Button>
                        <Button asChild variant="outline"><Link href={`/invoices/${emise.id}`}><Receipt className="mr-2 h-4 w-4" />Voir le détail</Link></Button>
                        {prochain && <Button variant="outline" onClick={() => choisir(prochain.id)}><SkipForward className="mr-2 h-4 w-4" />Contrat suivant : {prochain.numero} · {prochain.client}</Button>}
                        <Button variant="ghost" onClick={() => choisirClient('')}><RotateCcw className="mr-2 h-4 w-4" />Revenir à la liste</Button>
                    </CardContent>
                </Card>
            )}

            {contratId && chargement && !apercu && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Calcul de ce qui est dû…</div>}

            {apercu && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex flex-wrap items-center gap-2 text-base">2. Ce qui est dû{emise ? ' ensuite' : ''}
                            <a href={`/contracts/${apercu.contrat.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-normal text-primary hover:underline">
                                <ExternalLink className="h-3 w-3" />{[apercu.contrat.numero, apercu.contrat.libelle].filter(Boolean).join(' · ')}
                            </a>
                        </CardTitle>
                        <CardDescription>
                            Échéances facturables au {frDay(apercu.jusquAu)}{apercu.contrat.global ? ' — facturation globale (une ligne par activité)' : ''}. Ce qui est dû aujourd'hui est coché ; décochez ce que vous ne facturez pas maintenant.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {apercu.blocages.map(b => (
                            <Alert key={b} variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Blocage</AlertTitle><AlertDescription>{b}</AlertDescription></Alert>
                        ))}
                        {dues.length === 0 && apercu.blocages.length === 0 && (
                            <p className="text-sm text-muted-foreground">Rien à facturer à cette date : tout est facturé{apercu.prochaine ? `, prochaine échéance le ${frDay(apercu.prochaine)}` : ''}.</p>
                        )}
                        {dues.length > 0 && (
                            <div className="divide-y rounded-md border">
                                {dues.map(e => {
                                    const avance = e.facturableLe > aujourdhui();
                                    const libre = cochable(dues, e);
                                    if (e.blocage) {
                                        const lien = lienBlocage(e.blocage, apercu.contrat.id);
                                        return (
                                            <div key={e.id} className="flex items-start gap-3 bg-destructive/5 p-3">
                                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                                        <Badge variant="secondary">{e.activite}</Badge><span>{e.libelle}</span><Badge variant="destructive">bloquée</Badge>
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">{e.site} — du {frDay(e.debut)} au {frDay(e.fin)}</div>
                                                    <div className="mt-1 text-xs text-destructive">{e.blocage.message}</div>
                                                    <a href={lien.href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                                                        <ExternalLink className="h-3 w-3" />{lien.libelle}
                                                    </a>
                                                </div>
                                            </div>
                                        );
                                    }
                                    return (
                                        <label key={e.id} className={`flex items-start gap-3 p-3 ${libre ? 'cursor-pointer hover:bg-muted/40' : 'opacity-60'}`} title={libre ? undefined : "À facturer après l'échéance bloquée de la même prestation"}>
                                            <Checkbox className="mt-0.5" disabled={!libre} checked={selection.includes(e.id)} onCheckedChange={v => setSelection(s => basculer(dues, s, e.id, v === true))} aria-label={`${e.activite} ${e.site} du ${frDay(e.debut)} au ${frDay(e.fin)}`} />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                                    <Badge variant="secondary">{e.activite}</Badge>
                                                    <span>{e.libelle}</span>
                                                    {e.revise && <Badge variant="outline">révisé</Badge>}
                                                    {e.prorata && <Badge variant="outline">prorata</Badge>}
                                                    {avance && <Badge variant="outline" className="border-amber-500 text-amber-700">d'avance</Badge>}
                                                </div>
                                                <div className="text-xs text-muted-foreground">{e.site} — du {frDay(e.debut)} au {frDay(e.fin)}{avance ? ` — facturable à partir du ${frDay(e.facturableLe)}` : ''}</div>
                                            </div>
                                            <div className="whitespace-nowrap text-sm font-semibold tabular-nums">{eur(e.montant)}</div>
                                        </label>
                                    );
                                })}
                            </div>
                        )}
                        {(bloquees > 0 || apercu.blocages.length > 0) && (
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <Button variant="outline" size="sm" disabled={chargement} onClick={() => charger(apercu.contrat.id, apercu.jusquAu, selection)}>
                                    <RefreshCw className={`mr-2 h-4 w-4 ${chargement ? 'animate-spin' : ''}`} />Recalculer après correction
                                </Button>
                                {bloquees > 0 && <span>{bloquees} échéance{bloquees > 1 ? 's' : ''} bloquée{bloquees > 1 ? 's' : ''} : le reste peut être facturé.</span>}
                            </div>
                        )}
                        {apercu.prochaine && apercu.blocages.length === 0 && (
                            <Button variant="ghost" size="sm" disabled={chargement} onClick={() => charger(apercu.contrat.id, apercu.prochaine!, selection)}>
                                {chargement ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarPlus className="mr-2 h-4 w-4" />}
                                Facturer d'avance : afficher l'échéance du {frDay(apercu.prochaine)}
                            </Button>
                        )}
                        {apercu.avertissements.length > 0 && (
                            <ul className="list-disc pl-5 text-xs text-amber-700">{apercu.avertissements.map(a => <li key={a}>{a}</li>)}</ul>
                        )}
                    </CardContent>
                </Card>
            )}

            {apercu && dues.length > 0 && (
                <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-base">3. La facture</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1">
                                <Label>Date de la facture</Label>
                                <p className="text-sm font-medium">{frDay(date)} <span className="text-xs font-normal text-muted-foreground">— date du jour, non modifiable</span></p>
                                <p className="text-xs text-muted-foreground">Conditions de paiement : {apercu.paiement ?? '30 jours'}.</p>
                            </div>
                            <div className="space-y-1 text-sm tabular-nums sm:text-right">
                                <div className="text-muted-foreground">{selection.length} échéance{selection.length > 1 ? 's' : ''} sur {dues.length}</div>
                                <div>Total HT <span className="ml-2 font-medium">{eur(totaux.subtotal)}</span></div>
                                {totaux.vatBreakdown.map(v => <div key={v.rate} className="text-muted-foreground">TVA {v.rate.toLocaleString('fr-FR')} % <span className="ml-2">{eur(v.amount)}</span></div>)}
                                <div className="text-lg font-semibold">Total TTC <span className="ml-2">{eur(totaux.total)}</span></div>
                            </div>
                        </div>
                        {anomalies.length > 0 && selection.length > 0 && <p className="text-sm text-destructive">{anomalies.join(' ')}</p>}
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button variant="ghost" size="sm" className="mr-auto" onClick={() => setVoirPdf(v => !v)}>
                                {voirPdf ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}{voirPdf ? "Masquer l'aperçu" : "Afficher l'aperçu"}
                            </Button>
                            <Button variant="outline" disabled={bloque} onClick={() => emettre(true)}>{envoi === 'proforma' ? 'Création…' : 'Créer un proforma'}</Button>
                            <Button disabled={bloque} onClick={() => emettre(false)}>{envoi === 'facture' ? 'Émission…' : `Émettre la facture — ${eur(totaux.total)}`}</Button>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
        {voirPdf && apercu && !emise && (pdf.url || pdf.erreur) && (
            <div className="xl:sticky xl:top-4 xl:self-start">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    Aperçu de la facture {pdf.calcul && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    <span className="text-xs font-normal text-muted-foreground">sans numéro tant qu'elle n'est pas émise</span>
                    {pdf.url && <Button asChild variant="outline" size="sm" className="ml-auto"><a href={pdf.url} target="_blank" rel="noopener noreferrer"><Maximize2 className="mr-2 h-4 w-4" />Ouvrir en grand</a></Button>}
                </div>
                {pdf.erreur ? <p className="text-sm text-destructive">{pdf.erreur}</p>
                    : <iframe title="Aperçu de la facture" src={`${pdf.url}#toolbar=0&view=FitH`} className="h-[80vh] w-full rounded-md border bg-white" />}
            </div>
        )}
        </div>
    );
}

export default function BillingPage() {
    return <Suspense><Facturation /></Suspense>;
}
