'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, CalendarPlus, CheckCircle2, FileText, Loader2, Receipt, RotateCcw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect, type SearchableOption } from '@/components/ui/searchable-select';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import { generateInvoice } from '@/ai/flows/generate-invoice-flow';
import { apercuFacturationAction } from '@/lib/billing/actions';
import { frDay, vatTotals } from '@/lib/billing/contract-billing';
import { basculer, controleSelection, lignesRetenues } from '@/lib/billing/selection';
import type { ApercuFacturation } from '@/services/contract-billing-admin';

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const aujourdhui = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

type Emise = { id: string; numero?: string; proforma: boolean; total: number; contrat: string };

function Facturation() {
    const { contracts, clients, sites, isLoading } = useData();
    const { toast } = useToast();
    const router = useRouter();
    const contratInitial = useSearchParams().get('contrat');

    const [contratId, setContratId] = useState<string | null>(contratInitial);
    const [apercu, setApercu] = useState<ApercuFacturation | null>(null);
    const [selection, setSelection] = useState<string[]>([]);
    const [chargement, setChargement] = useState(false);
    const [erreur, setErreur] = useState<string | null>(null);
    const [date, setDate] = useState(aujourdhui());
    const [envoi, setEnvoi] = useState<'proforma' | 'facture' | null>(null);
    const [emise, setEmise] = useState<Emise | null>(null);

    // Une seule recherche : numéro de contrat, client, libellé, sites, villes, SIRET.
    const options = useMemo<SearchableOption[]>(() => {
        const clientDe = new Map(clients.map(c => [c.id, c]));
        return contracts.filter(c => c.status !== 'Brouillon' && c.validationStatus === 'validated')
            .sort((a, b) => a.clientName.localeCompare(b.clientName, 'fr') || (a.contractNumber ?? '').localeCompare(b.contractNumber ?? ''))
            .map(c => {
                const s = sites.filter(x => x.contractId === c.id);
                const client = clientDe.get(c.clientId);
                return {
                    value: c.id,
                    label: [c.contractNumber, c.clientName, c.label].filter(Boolean).join(' · '),
                    description: [s.length === 1 ? s[0].name : `${s.length} sites`, c.status !== 'Actif' ? c.status : undefined].filter(Boolean).join(' · '),
                    keywords: [client?.siret, client?.externalCode, client?.city, c.externalRef, ...s.flatMap(x => [x.name, x.code, x.city, x.address])].filter(Boolean).join(' '),
                };
            });
    }, [contracts, clients, sites]);

    const charger = useCallback(async (id: string, jusquAu?: string, garder?: string[]) => {
        setChargement(true); setErreur(null);
        const r = await apercuFacturationAction(id, jusquAu);
        setChargement(false);
        if (!r.success) { setApercu(null); setErreur(r.error); return; }
        setApercu(r.data);
        // Tout ce qui est dû est coché d'avance ; en élargissant l'horizon, la sélection en cours est conservée.
        const dues = r.data.echeances;
        setSelection(garder ? dues.filter(e => garder.includes(e.id)).map(e => e.id) : dues.filter(e => e.facturableLe <= aujourdhui()).map(e => e.id));
    }, []);

    useEffect(() => { if (contratId) { setEmise(null); void charger(contratId); } else setApercu(null); }, [contratId, charger]);

    const choisir = (id: string) => { setContratId(id || null); router.replace(id ? `/billing?contrat=${id}` : '/billing'); };

    const dues = apercu?.echeances ?? [];
    const totaux = useMemo(() => vatTotals(lignesRetenues(dues, selection)), [dues, selection]);
    const anomalies = dues.length ? controleSelection(dues, selection) : [];
    const bloque = !apercu || apercu.blocages.length > 0 || anomalies.length > 0 || !!envoi || chargement;

    const emettre = async (proforma: boolean) => {
        if (!apercu) return;
        setEnvoi(proforma ? 'proforma' : 'facture');
        const until = dues.filter(e => selection.includes(e.id)).map(e => e.facturableLe).sort().at(-1);
        const r = await generateInvoice({ contractId: apercu.contrat.id, invoiceDate: date, isProforma: proforma, until: until && until > date ? until : apercu.jusquAu, selection });
        setEnvoi(null);
        if (!r.success || !r.invoiceId) { toast({ title: 'Émission impossible', description: r.error ?? 'Erreur inconnue.', variant: 'destructive' }); void charger(apercu.contrat.id); return; }
        setEmise({ id: r.invoiceId, numero: r.invoiceNumber, proforma, total: totaux.total, contrat: [apercu.contrat.numero, apercu.contrat.client].filter(Boolean).join(' · ') });
        // Ce qui reste dû après cette facture.
        void charger(apercu.contrat.id);
    };

    return (
        <div className="space-y-6 max-w-4xl">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Facturation manuelle</h1>
                <p className="text-sm text-muted-foreground">Choisissez un contrat : ce qui est dû s'affiche, vous vérifiez puis vous émettez.</p>
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">1. Quel contrat facturer ?</CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : (
                        <SearchableSelect id="contrat-recherche" value={contratId} onValueChange={choisir} options={options} clearable
                            placeholder="Rechercher un contrat…" searchPlaceholder="N° de contrat, client, site, ville, SIRET…" emptyText="Aucun contrat validé ne correspond." className="w-full" />
                    )}
                </CardContent>
            </Card>

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
                        <Button variant="outline" onClick={() => choisir('')}><RotateCcw className="mr-2 h-4 w-4" />Facturer un autre contrat</Button>
                    </CardContent>
                </Card>
            )}

            {contratId && chargement && !apercu && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Calcul de ce qui est dû…</div>}

            {apercu && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base">2. Ce qui est dû{emise ? ' ensuite' : ''}</CardTitle>
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
                                    return (
                                        <label key={e.id} className="flex cursor-pointer items-start gap-3 p-3 hover:bg-muted/40">
                                            <Checkbox className="mt-0.5" checked={selection.includes(e.id)} onCheckedChange={v => setSelection(s => basculer(dues, s, e.id, v === true))} aria-label={`${e.activite} ${e.site} du ${frDay(e.debut)} au ${frDay(e.fin)}`} />
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
                                <Label htmlFor="date-facture">Date de la facture</Label>
                                <Input id="date-facture" type="date" value={date} max={aujourdhui()} onChange={e => setDate(e.target.value || aujourdhui())} className="w-44" />
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
                        <div className="flex flex-wrap justify-end gap-2">
                            <Button variant="outline" disabled={bloque} onClick={() => emettre(true)}>{envoi === 'proforma' ? 'Création…' : 'Créer un proforma'}</Button>
                            <Button disabled={bloque} onClick={() => emettre(false)}>{envoi === 'facture' ? 'Émission…' : `Émettre la facture — ${eur(totaux.total)}`}</Button>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

export default function BillingPage() {
    return <Suspense><Facturation /></Suspense>;
}
