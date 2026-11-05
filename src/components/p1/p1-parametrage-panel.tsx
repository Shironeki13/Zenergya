'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, History, Loader2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import {
    EXIGENCES_MARCHE, PERIODICITES_REVISION, TYPES_MARCHE, UNITES_PRIX, enVigueur, type Energie, type TermeNc, type TrancheBareme, type TypeMarche,
} from '@/lib/p1/parametrage';
import {
    ENERGIES, MARCHES_BAREME, P1_PARAMS, REPARTITIONS, baremeKey, formatFormuleNc, paramDef, valeurAu,
    type InteressementMarche, type P1Formule, type P1Params, type P1Scope, type P1Version,
} from '@/lib/p1/stockage';
import { formatBareme } from '@/lib/p1/bareme';
import { formatTermes, parseTermes, type FormuleVersion } from '@/lib/p1/formules';
import {
    addP1FormuleAction, addP1FormuleVersionAction, addP1PosteAction, addP1VersionAction, getP1ContractAction, getP1MeterAction, getP1ReelAction, getP1SiteAction, previewPrixP1Action,
    retireP1FormuleAction, retireP1FormuleVersionAction, retireP1PosteAction, retireP1VersionAction,
} from '@/lib/p1/actions';
import type { PrixP1Preview } from '@/services/p1-admin';
import type { P1ContractView, P1MeterView, P1ReelLigne, P1SiteView, P1Target } from '@/services/p1-admin';

/**
 * Paramétrage P1 daté d'un site : ce qui manque pour calculer (selon le type de marché), la valeur en vigueur à une
 * date, l'historique de chaque paramètre, l'ajout d'une version (date d'effet, motif) et son retrait tracé.
 */

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
/** Répartitions usuelles des acomptes (janvier à décembre). */
const PRESETS_REPARTITION: { label: string; parts: number[] }[] = [
    { label: 'Linéaire (12 mois)', parts: Array(12).fill(8.3333) },
    { label: 'Saison de chauffe (octobre à mai, 8 mois)', parts: [12.5, 12.5, 12.5, 12.5, 12.5, 0, 0, 0, 0, 12.5, 12.5, 12.5] },
];

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
const frDay = (d?: string | null) => (d ? d.split('-').reverse().join('/') : 'origine');
const fmtNum = (n: number, unit?: string) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 6 })}${unit ? ` ${unit}` : ''}`;

function formatValue(scope: P1Scope, key: string, value: unknown): string {
    if (value === null || value === undefined) return '—';
    const def = paramDef(scope, key)!;
    if (def.kind === 'formule') return formatFormuleNc(value as TermeNc[]);
    if (def.kind === 'bareme') return formatBareme(value as TrancheBareme[]);
    if (def.kind === 'repartition') return (value as number[]).map((p, i) => `${MOIS_COURTS[i]} ${p.toLocaleString('fr-FR')} %`).join(' · ');
    if (def.kind === 'interessement') {
        return (value as InteressementMarche[]).map(i => `${i.marche} (${i.repartition === 'contrat' ? 'au contrat' : 'prorata NB'}${i.plafondPct !== null ? `, plafond ${i.plafondPct} % P2${i.plafonne ? '' : ' non plafonné'}` : ''})`).join(' ; ');
    }
    if (typeof value === 'number') return fmtNum(value, def.unit);
    return String(value).replace(/_/g, ' ');
}

type Editing = { target: P1Target; key: string; title: string; meterCodes?: string[] } | null;
type Run = (fn: () => Promise<{ success: boolean; error?: string }>, ok: string) => Promise<boolean>;

/** Saisie d'une version (et retrait tracé) : état et fenêtre communs aux écrans site, compteur et contrat. */
function useEdition(reload: () => Promise<void>) {
    const { toast } = useToast();
    const { weatherStations } = useData();
    const [editing, setEditing] = useState<Editing>(null);
    const [busy, setBusy] = useState(false);
    const run: Run = async (fn, ok) => {
        setBusy(true);
        const r = await fn();
        setBusy(false);
        if (!r.success) { toast({ title: 'Opération refusée', description: r.error, variant: 'destructive' }); return false; }
        toast({ title: ok });
        await reload();
        return true;
    };
    const retire = (target: P1Target, key: string, v: P1Version<unknown>) => {
        const motif = window.prompt(`Retirer la version ${frDay(v.dateEffet)} (${v.motif}) : motif du retrait ?`);
        if (motif) run(() => retireP1VersionAction(target, key, v.id, motif), 'Version retirée');
    };
    const rows = (scope: P1Scope, target: P1Target, params: P1Params | undefined, date: string, keys = Object.keys(P1_PARAMS[scope]), opts: { meterCodes?: string[]; readOnly?: boolean } = {}) => (
        <div className="divide-y rounded-md border">
            {keys.map(key => (
                <ParamRow key={key} scope={scope} paramKey={key} params={params} date={date} readOnly={opts.readOnly}
                    onAdd={() => setEditing({ target, key, title: paramDef(scope, key)!.label, meterCodes: opts.meterCodes })}
                    onRetire={v => retire(target, key, v)} />
            ))}
        </div>
    );
    const dialog = (
        <VersionDialog editing={editing} onClose={() => setEditing(null)} busy={busy} stations={weatherStations.map(s => s.code)}
            onSubmit={async (valeur, dateEffet, motif, document) => {
                if (!editing) return;
                const ok = await run(() => addP1VersionAction(editing.target, editing.key, { valeur, dateEffet, motif, document }), 'Version enregistrée');
                if (ok) setEditing(null);
            }} />
    );
    return { busy, run, rows, dialog };
}

function DateVigueur({ date, onChange }: { date: string; onChange: (d: string) => void }) {
    return <div className="space-y-1"><Label>Valeurs en vigueur au</Label><Input type="date" value={date} onChange={e => onChange(e.target.value || today())} className="w-44" /></div>;
}

/**
 * Paramétrage P1 du site : paramètres du site et postes de consommation (saisis ici) ; compteurs et contrat en
 * lecture, chacun se paramétrant sur sa propre fiche ; aperçu des prix révisés et réel P1 du moteur.
 */
export function P1ParametragePanel({ siteId }: { siteId: string }) {
    const { toast } = useToast();
    const [date, setDate] = useState(today());
    const [view, setView] = useState<P1SiteView | null>(null);
    const [open, setOpen] = useState(false);

    const load = useCallback(async () => {
        const r = await getP1SiteAction(siteId, date);
        if (r.success) setView(r.data);
        else toast({ title: 'Paramétrage P1', description: r.error, variant: 'destructive' });
    }, [siteId, date, toast]);
    useEffect(() => { load(); }, [load]);
    const { busy, run, rows, dialog } = useEdition(load);

    if (!view) return <Card><CardContent className="py-6"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></CardContent></Card>;
    const { reste } = view;
    const meterCodes = view.meters.map(m => m.code);
    const postes = Object.values(view.siteDoc?.postes ?? {}).filter(p => !p.retireLe);

    return (
        <Card>
            <CardHeader className="cursor-pointer pb-3" onClick={() => setOpen(o => !o)}>
                <CardTitle className="flex items-center justify-between text-base">
                    <span>Paramétrage P1</span>
                    <span className="flex items-center gap-2">
                        {reste.typeMarche ? <Badge variant="outline">{reste.typeMarche}</Badge> : null}
                        {!reste.suivi ? <Badge variant="secondary">Hors suivi P1</Badge>
                            : reste.calculable ? <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" />Calculable</Badge>
                            : <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />{reste.manque.length} à renseigner</Badge>}
                        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                </CardTitle>
                <CardDescription>
                    Chaque valeur a une date d&apos;effet et un motif : un avenant ajoute une version, il n&apos;écrase rien. Le site et ses postes se
                    paramètrent ici ; les compteurs sur leur fiche, le contrat (commun à ses sites) sur la sienne.
                </CardDescription>
            </CardHeader>
            {open && (
                <CardContent className="space-y-6">
                    <div className="flex flex-wrap items-end gap-4">
                        <DateVigueur date={date} onChange={setDate} />
                        {(reste.manque.length > 0 || reste.aVenir.length > 0 || reste.alertes.length > 0) && (
                            <div className="flex-1 rounded-md border border-dashed p-3 text-sm">
                                {reste.manque.length > 0 && <p><span className="font-medium">Reste à faire :</span> {reste.manque.join(' · ')}</p>}
                                {reste.alertes.length > 0 && <p className="text-amber-700">{reste.alertes.join(' · ')}</p>}
                                {reste.aVenir.length > 0 && <p className="text-muted-foreground">Prochain lot : {reste.aVenir.join(' · ')}</p>}
                            </div>
                        )}
                    </div>

                    <section className="space-y-2">
                        <h3 className="text-sm font-semibold">Site {view.site.code}</h3>
                        {rows('site', { scope: 'site', id: siteId }, view.siteDoc?.params, date,
                            [...Object.keys(P1_PARAMS.site), ...(reste.typeMarche && EXIGENCES_MARCHE[reste.typeMarche].bareme ? [baremeKey(reste.typeMarche)] : [])])}
                    </section>

                    <section className="space-y-2">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">Postes de consommation</h3>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                                const name = window.prompt('Désignation du poste (ex. « Chaufferie gaz ») ?');
                                if (name) run(() => addP1PosteAction(siteId, name), 'Poste créé');
                            }}><Plus className="mr-1 h-3 w-3" />Poste</Button>
                        </div>
                        {postes.length === 0 && <p className="text-sm text-muted-foreground">Aucun poste : la formule de NC (compteurs signés) et l&apos;engagement (cible, DJU) se saisissent par poste.</p>}
                        {postes.map(p => (
                            <div key={p.id} className="space-y-1">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="font-medium">{p.designation}</span>
                                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
                                        const motif = window.prompt(`Retirer le poste « ${p.designation} » : motif ?`);
                                        if (motif) run(() => retireP1PosteAction(siteId, p.id, motif), 'Poste retiré');
                                    }}>Retirer</Button>
                                </div>
                                {rows('poste', { scope: 'poste', id: siteId, posteId: p.id }, p.params, date, undefined, { meterCodes })}
                            </div>
                        ))}
                    </section>

                    <section className="space-y-2">
                        <h3 className="text-sm font-semibold">Compteurs <span className="font-normal text-muted-foreground">(paramétrés sur leur fiche)</span></h3>
                        {view.meters.length === 0 && <p className="text-sm text-muted-foreground">Aucun compteur sur ce site.</p>}
                        {view.meters.map(m => (
                            <div key={m.id} className="space-y-1">
                                <div className="flex items-center justify-between text-sm">
                                    <span><span className="font-mono">{m.code}</span> — {m.name}{m.unit ? ` (${m.unit})` : ''}</span>
                                    <P1CompteurDialog meterId={m.id} onSaved={load} trigger={<Button size="sm" variant="outline" className="h-7">Modifier (compteur)</Button>} />
                                </div>
                                {rows('meter', { scope: 'meter', id: m.id }, m.doc?.params, date, undefined, { readOnly: true })}
                            </div>
                        ))}
                    </section>

                    {view.contract && (
                        <section className="space-y-2">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold">Contrat {view.contract.code} <span className="font-normal text-muted-foreground">(commun à tous ses sites, paramétré sur le contrat)</span></h3>
                                <Link href={`/contracts/${view.contract.id}#p1`}><Button size="sm" variant="outline" className="h-7 gap-1">Ouvrir le contrat<ExternalLink className="h-3 w-3" /></Button></Link>
                            </div>
                            {rows('contract', { scope: 'contract', id: view.contract.id }, view.contractDoc?.params, date,
                                [...Object.keys(P1_PARAMS.contract), ...MARCHES_BAREME.map(baremeKey)].filter(k => valeurAu(view.contractDoc?.params, k, date) !== null || k in P1_PARAMS.contract), { readOnly: true })}
                            <p className="text-xs text-muted-foreground">
                                Formules de révision du contrat : {Object.values(view.contractDoc?.formules ?? {}).filter(f => !f.retireLe).map(f => f.nom).join(', ') || 'aucune'}.
                            </p>
                        </section>
                    )}

                    <PrixPreview sites={[{ id: siteId, code: view.site.code, name: view.site.name }]} />
                    <ReelP1 siteId={siteId} />
                </CardContent>
            )}
            {dialog}
        </Card>
    );
}

/** Paramétrage P1 d'un compteur (usage, énergie, QE, qECS, code TWIMM), depuis sa fiche ou celle de son site. */
export function P1CompteurDialog({ meterId, trigger, onSaved }: { meterId: string; trigger: React.ReactNode; onSaved?: () => void }) {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [date, setDate] = useState(today());
    const [view, setView] = useState<P1MeterView | null>(null);
    const load = useCallback(async () => {
        const r = await getP1MeterAction(meterId);
        if (r.success) setView(r.data);
        else toast({ title: 'Paramétrage P1', description: r.error, variant: 'destructive' });
    }, [meterId, toast]);
    useEffect(() => { if (open) load(); }, [open, load]);
    // Après une saisie : la fiche du compteur et l'écran appelant (site) se rechargent.
    const { rows, dialog } = useEdition(async () => { await load(); onSaved?.(); });
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <span onClick={e => { e.stopPropagation(); setOpen(true); }}>{trigger}</span>
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Paramétrage P1 — compteur {view?.meter.code ?? ''}</DialogTitle>
                    <DialogDescription>
                        {view ? `${view.meter.name}${view.meter.unit ? ` (${view.meter.unit})` : ''} — site ${view.meter.siteName}. ` : ''}
                        Chaque valeur a une date d&apos;effet et un motif ; un changement (compteur remplacé, nouveau QE) ajoute une version.
                    </DialogDescription>
                </DialogHeader>
                {!view ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : (
                    <div className="space-y-3">
                        <DateVigueur date={date} onChange={setDate} />
                        {rows('meter', { scope: 'meter', id: meterId }, view.doc?.params, date)}
                    </div>
                )}
                {dialog}
            </DialogContent>
        </Dialog>
    );
}

/** Paramétrage P1 du contrat (commun à ses sites) : régime, gestion, répartitions, intéressement, barèmes, formules. */
export function P1ContratPanel({ contractId }: { contractId: string }) {
    const { toast } = useToast();
    const [date, setDate] = useState(today());
    const [view, setView] = useState<P1ContractView | null>(null);
    const [open, setOpen] = useState(false);
    const load = useCallback(async () => {
        const r = await getP1ContractAction(contractId);
        if (r.success) setView(r.data);
        else toast({ title: 'Paramétrage P1', description: r.error, variant: 'destructive' });
    }, [contractId, toast]);
    useEffect(() => { load(); }, [load]);
    const { busy, run, rows, dialog } = useEdition(load);
    useEffect(() => { if (typeof window !== 'undefined' && window.location.hash === '#p1') setOpen(true); }, []);

    return (
        <Card id="p1">
            <CardHeader className="cursor-pointer pb-3" onClick={() => setOpen(o => !o)}>
                <CardTitle className="flex items-center justify-between text-base">
                    <span>Paramétrage P1 du contrat</span>
                    {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </CardTitle>
                <CardDescription>
                    Commun à tous les sites du contrat : régime du compte de prestation, gestion, répartition des acomptes, intéressement, barèmes de partage,
                    formules de révision. Les paramètres propres à un site (type de marché, prix de base, postes) se saisissent sur le site.
                </CardDescription>
            </CardHeader>
            {open && (
                <CardContent className="space-y-6">
                    {!view ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : (
                        <>
                            <DateVigueur date={date} onChange={setDate} />
                            <section className="space-y-2">
                                <h3 className="text-sm font-semibold">Paramètres</h3>
                                {rows('contract', { scope: 'contract', id: contractId }, view.doc?.params, date, [...Object.keys(P1_PARAMS.contract), ...MARCHES_BAREME.map(baremeKey)])}
                            </section>
                            <FormulesSection contractId={contractId} sites={view.sites} formules={Object.values(view.doc?.formules ?? {})} date={date} busy={busy} run={run} />
                            {view.sites.length > 0 && <PrixPreview sites={view.sites} />}
                        </>
                    )}
                </CardContent>
            )}
            {dialog}
        </Card>
    );
}

/** Réel P1 du moteur du site (import « Réel P1 du moteur ») : montants mensuels, base de la régularisation. */
function ReelP1({ siteId }: { siteId: string }) {
    const [lignes, setLignes] = useState<P1ReelLigne[] | null>(null);
    const [tout, setTout] = useState(false);
    useEffect(() => { getP1ReelAction(siteId).then(r => setLignes(r.success ? r.data : [])); }, [siteId]);
    const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
    const affichees = (lignes ?? []).slice(0, tout ? undefined : 12);
    return (
        <div className="space-y-2 pt-2">
            <h4 className="text-sm font-semibold">Réel P1 du moteur</h4>
            <p className="text-xs text-muted-foreground">Montant P1 HT réellement dû, calculé par le moteur et importé chaque mois ; la régularisation le compare aux acomptes facturés (Facturation › P1).</p>
            {lignes === null ? <Loader2 className="h-4 w-4 animate-spin" /> : lignes.length === 0 ? <p className="text-sm text-muted-foreground">Aucun réel importé pour ce site.</p> : (
                <>
                    <table className="w-full text-xs">
                        <thead><tr className="text-muted-foreground"><th className="text-left font-normal">Mois</th><th className="text-left font-normal">Usage</th><th className="text-right font-normal">Montant HT</th><th className="text-left font-normal pl-4">Import</th></tr></thead>
                        <tbody>{affichees.map(l => (
                            <tr key={l.id} className="border-t">
                                <td>{l.mois.split('-').reverse().join('/')}</td>
                                <td>{l.usage === 'chauffage' ? 'Chauffage' : l.usage === 'ecs' ? 'ECS' : 'Total'}</td>
                                <td className="text-right font-medium">{eur(l.montantHt)}</td>
                                <td className="pl-4 text-muted-foreground">{l.importedAt ? new Date(l.importedAt).toLocaleDateString('fr-FR') : ''}{l.fileName ? ` — ${l.fileName}` : ''}</td>
                            </tr>
                        ))}</tbody>
                    </table>
                    {lignes.length > 12 && <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => setTout(t => !t)}>{tout ? 'Les 12 derniers' : `Tout afficher (${lignes.length})`}</Button>}
                </>
            )}
        </div>
    );
}

function ParamRow({ scope, paramKey, params, date, onAdd, onRetire, readOnly }: {
    scope: P1Scope; paramKey: string; params: P1Params | undefined; date: string; onAdd: () => void; onRetire: (v: P1Version<unknown>) => void; readOnly?: boolean;
}) {
    const [history, setHistory] = useState(false);
    const def = paramDef(scope, paramKey)!;
    const versions = (params?.[paramKey] ?? []) as P1Version<unknown>[];
    const current = valeurAu(params, paramKey, date);
    return (
        <div className="px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
                <span className="w-56 text-muted-foreground" title={def.help}>{def.label}</span>
                <span className={`flex-1 ${current === null ? 'italic text-muted-foreground' : 'font-medium'}`}>{current === null ? 'non renseigné' : formatValue(scope, paramKey, current)}</span>
                {versions.length > 0 && <Button size="sm" variant="ghost" className="h-7 gap-1 px-2" onClick={() => setHistory(h => !h)}><History className="h-3 w-3" />{versions.length}</Button>}
                {!readOnly && <Button size="sm" variant="outline" className="h-7 px-2" onClick={onAdd} title="Nouvelle version"><Plus className="h-3 w-3" /></Button>}
            </div>
            {history && (
                <ul className="mt-2 space-y-1 border-l pl-3 text-xs">
                    {versions.map(v => (
                        <li key={v.id} className={v.retireLe ? 'text-muted-foreground line-through' : ''}>
                            <span className="font-medium">{frDay(v.dateEffet)}</span> : {formatValue(scope, paramKey, v.valeur)} — {v.motif}
                            {v.document ? <> — <a href={v.document} target="_blank" rel="noopener noreferrer" className="underline">pièce</a></> : null}
                            <span className="text-muted-foreground"> (saisi le {new Date(v.saisiLe).toLocaleDateString('fr-FR')} par {v.saisiPar})</span>
                            {v.retireLe
                                ? <span className="no-underline"> — retiré le {new Date(v.retireLe).toLocaleDateString('fr-FR')} par {v.retirePar} : {v.motifRetrait}</span>
                                : !readOnly && <Button size="sm" variant="link" className="h-auto p-0 pl-2 text-xs" onClick={() => onRetire(v)}>retirer</Button>}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function VersionDialog({ editing, onClose, onSubmit, busy, stations }: {
    editing: Editing; onClose: () => void; busy: boolean; stations: string[];
    onSubmit: (valeur: unknown, dateEffet: string | null, motif: string, document: string | null) => void;
}) {
    const [value, setValue] = useState('');
    const [dateEffet, setDateEffet] = useState('');
    const [motif, setMotif] = useState('');
    const [document, setDocument] = useState('');
    const [interessement, setInteressement] = useState<InteressementMarche[]>([]);
    useEffect(() => { setValue(''); setDateEffet(''); setMotif(''); setDocument(''); setInteressement([]); }, [editing]);
    const scope = editing?.target.scope;
    const def = editing && scope ? paramDef(scope, editing.key) : null;
    const marchesAvecInteressement = useMemo(() => TYPES_MARCHE.filter(m => EXIGENCES_MARCHE[m].bareme), []);
    if (!editing || !def) return null;

    const valeur = def.kind === 'interessement' ? interessement : value;
    return (
        <Dialog open onOpenChange={o => !o && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Nouvelle version : {editing.title}</DialogTitle>
                    <DialogDescription>{def.help ?? 'La version vaut à partir de sa date d\'effet ; les précédentes restent dans l\'historique.'}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-1">
                        <Label>Valeur{def.unit ? ` (${def.unit})` : ''}</Label>
                        {def.kind === 'enum' || def.kind === 'station' ? (
                            <Select value={value} onValueChange={setValue}>
                                <SelectTrigger><SelectValue placeholder="Choisir" /></SelectTrigger>
                                <SelectContent>{(def.kind === 'station' ? stations : def.options!).map(o => <SelectItem key={o} value={o}>{o.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                            </Select>
                        ) : def.kind === 'interessement' ? (
                            <div className="space-y-2">
                                {interessement.map((i, k) => (
                                    <div key={k} className="grid grid-cols-4 items-center gap-2">
                                        <Select value={i.marche} onValueChange={v => setInteressement(l => l.map((x, n) => (n === k ? { ...x, marche: v as TypeMarche } : x)))}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>{marchesAvecInteressement.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                                        </Select>
                                        <Select value={i.repartition} onValueChange={v => setInteressement(l => l.map((x, n) => (n === k ? { ...x, repartition: v as InteressementMarche['repartition'] } : x)))}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>{REPARTITIONS.map(r => <SelectItem key={r} value={r}>{r === 'contrat' ? 'reste au contrat' : 'prorata NB'}</SelectItem>)}</SelectContent>
                                        </Select>
                                        <Input type="number" placeholder="plafond % P2" value={i.plafondPct ?? ''} onChange={e => setInteressement(l => l.map((x, n) => (n === k ? { ...x, plafondPct: e.target.value === '' ? null : Number(e.target.value) } : x)))} />
                                        <label className="flex items-center gap-1 text-xs"><Checkbox checked={i.plafonne} onCheckedChange={v => setInteressement(l => l.map((x, n) => (n === k ? { ...x, plafonne: !!v } : x)))} />plafonné</label>
                                    </div>
                                ))}
                                <Button type="button" size="sm" variant="outline" onClick={() => setInteressement(l => [...l, { marche: marchesAvecInteressement[0], repartition: 'contrat', plafondPct: null, plafonne: false }])}><Plus className="mr-1 h-3 w-3" />Marché</Button>
                            </div>
                        ) : (
                            <Input value={value} onChange={e => setValue(e.target.value)}
                                placeholder={def.kind === 'formule' ? 'CPT-00012 + CPT-00013 - CPT-00020' : def.kind === 'bareme' ? 'économie 0-10 % 50 % ; économie 10-100 % 70 % ; dépassement 0-100 % 30 %' : ''}
                                inputMode={def.kind === 'text' || def.kind === 'formule' || def.kind === 'bareme' || def.kind === 'repartition' ? 'text' : 'decimal'} />
                        )}
                        {def.kind === 'repartition' && (
                            <div className="flex flex-wrap gap-2 pt-1">
                                {PRESETS_REPARTITION.map(p => <Button key={p.label} type="button" size="sm" variant="outline" onClick={() => setValue(p.parts.join(' ; '))}>{p.label}</Button>)}
                                <p className="w-full text-xs text-muted-foreground">12 parts en %, de janvier à décembre, séparées par « ; » et sommant à 100.</p>
                            </div>
                        )}
                        {def.kind === 'formule' && editing.meterCodes && <p className="text-xs text-muted-foreground">Compteurs du site : {editing.meterCodes.join(', ') || 'aucun'}.</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label htmlFor="p1-effet">Date d'effet</Label><Input id="p1-effet" type="date" value={dateEffet} onChange={e => setDateEffet(e.target.value)} /><p className="text-xs text-muted-foreground">Vide : valeur d'origine du marché.</p></div>
                        <div className="space-y-1"><Label htmlFor="p1-motif">Motif *</Label><Input id="p1-motif" value={motif} onChange={e => setMotif(e.target.value)} placeholder="contrat d'origine, avenant n°2…" /></div>
                    </div>
                    <div className="space-y-1"><Label htmlFor="p1-doc">Pièce justificative (lien)</Label><Input id="p1-doc" value={document} onChange={e => setDocument(e.target.value)} placeholder="facultatif" /></div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuler</Button>
                    <Button disabled={busy || !motif.trim()} onClick={() => onSubmit(valeur, dateEffet || null, motif, document.trim() || null)}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enregistrer
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// --- Formules de révision P1 (contrat) ---

const DEFAULT_VERSION: FormuleVersion = {
    forme: 'A', mode: 'standard', baseEnergetique: 'PCS', unitePrix: 'EUR/MWh', dateM0: null, m0Manquante: null,
    regimeKmol: 'variable', prixMoleculeNegocie: null, prixFixe: false, periodicite: 'mensuel', termes: [],
};
const perimetreText = (f: P1Formule) => f.perimetre.type === 'contrat' ? 'tout le contrat'
    : f.perimetre.type === 'energies' ? `énergies : ${f.perimetre.energies.join(', ')}` : `${f.perimetre.siteIds.length} site(s)`;
const versionText = (v: FormuleVersion) => v.prixFixe ? 'prix fixe (non révisé)'
    : `forme ${v.forme}, ${v.periodicite.replace(/_/g, ' ')}, M0 ${v.dateM0 ?? `inconnu (${v.m0Manquante})`} : ${formatTermes(v.termes) || 'aucun terme'}`;

type SiteRef = { id: string; code: string; name: string };

function FormulesSection({ contractId, sites, formules, date, busy, run }: { contractId: string; sites: SiteRef[]; formules: P1Formule[]; date: string; busy: boolean; run: Run }) {
    const [creating, setCreating] = useState(false);
    const [editing, setEditing] = useState<P1Formule | null>(null);
    const actives = formules.filter(f => !f.retireLe);
    return (
        <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Formules de révision P1</h4>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setCreating(true)}><Plus className="mr-1 h-3 w-3" />Formule</Button>
            </div>
            <p className="text-xs text-muted-foreground">Prix révisé = prix de base du site × coefficient de la formule. La formule la plus précise s'applique (sites, puis énergies, puis contrat).</p>
            {actives.length === 0 && <p className="text-sm text-muted-foreground">Aucune formule sur ce contrat.</p>}
            {actives.map(f => {
                const current = enVigueur(f.versions, date);
                return (
                    <div key={f.id} className="rounded-md border px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{f.nom}</span>
                            <Badge variant="outline">{f.usage === 'chauffage' ? 'chauffage' : 'ECS'}</Badge>
                            <span className="text-xs text-muted-foreground">{perimetreText(f)}</span>
                            <span className="flex-1" />
                            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setEditing(f)}><Plus className="h-3 w-3" /></Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => {
                                const motif = window.prompt(`Retirer la formule « ${f.nom} » : motif ?`);
                                if (motif) run(() => retireP1FormuleAction(contractId, f.id, motif), 'Formule retirée');
                            }}>Retirer</Button>
                        </div>
                        <p className={`mt-1 text-xs ${current ? '' : 'italic text-muted-foreground'}`}>{current ? versionText(current.valeur) : 'aucune version en vigueur'}</p>
                        {f.versions.length > 0 && (
                            <ul className="mt-1 space-y-0.5 border-l pl-3 text-xs">
                                {f.versions.map(v => (
                                    <li key={v.id} className={v.retireLe ? 'text-muted-foreground line-through' : ''}>
                                        <span className="font-medium">{frDay(v.dateEffet)}</span> — {v.motif} <span className="text-muted-foreground">({v.saisiPar})</span>
                                        {!v.retireLe && <Button size="sm" variant="link" className="h-auto p-0 pl-2 text-xs" onClick={() => {
                                            const motif = window.prompt('Motif du retrait de cette version ?');
                                            if (motif) run(() => retireP1FormuleVersionAction(contractId, f.id, v.id, motif), 'Version retirée');
                                        }}>retirer</Button>}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                );
            })}
            {creating && <NewFormuleDialog onClose={() => setCreating(false)} busy={busy} sites={sites}
                onSubmit={async f => { if (await run(() => addP1FormuleAction(contractId, f), 'Formule créée')) setCreating(false); }} />}
            {editing && <FormuleVersionDialog formule={editing} date={date} onClose={() => setEditing(null)} busy={busy}
                onSubmit={async (v, meta) => { if (await run(() => addP1FormuleVersionAction(contractId, editing.id, v, meta), 'Version enregistrée')) setEditing(null); }} />}
        </div>
    );
}

function NewFormuleDialog({ onClose, onSubmit, busy, sites }: {
    onClose: () => void; busy: boolean; sites: SiteRef[];
    onSubmit: (f: { nom: string; usage: 'chauffage' | 'ecs'; perimetre: P1Formule['perimetre'] }) => void;
}) {
    const [nom, setNom] = useState('');
    const [usage, setUsage] = useState<'chauffage' | 'ecs'>('chauffage');
    const [type, setType] = useState<'contrat' | 'energies' | 'site'>('contrat');
    const [energies, setEnergies] = useState<Energie[]>([]);
    const [siteIds, setSiteIds] = useState<string[]>([]);
    const perimetre: P1Formule['perimetre'] = type === 'contrat' ? { type: 'contrat' } : type === 'energies' ? { type: 'energies', energies } : { type: 'sites', siteIds };
    return (
        <Dialog open onOpenChange={o => !o && onClose()}>
            <DialogContent>
                <DialogHeader><DialogTitle>Nouvelle formule de révision P1</DialogTitle><DialogDescription>Elle se paramètre ensuite par versions datées (forme, termes, M0, périodicité).</DialogDescription></DialogHeader>
                <div className="space-y-3">
                    <div className="space-y-1"><Label>Nom</Label><Input value={nom} onChange={e => setNom(e.target.value)} placeholder="Gaz — marché 2025" /></div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label>Usage</Label>
                            <Select value={usage} onValueChange={v => setUsage(v as 'chauffage' | 'ecs')}><SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="chauffage">Chauffage</SelectItem><SelectItem value="ecs">ECS</SelectItem></SelectContent></Select></div>
                        <div className="space-y-1"><Label>Périmètre</Label>
                            <Select value={type} onValueChange={v => setType(v as typeof type)}><SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="contrat">Tout le contrat</SelectItem><SelectItem value="energies">Des énergies</SelectItem><SelectItem value="site">Des sites</SelectItem></SelectContent></Select></div>
                    </div>
                    {type === 'energies' && (
                        <div className="flex flex-wrap gap-3">{ENERGIES.map(e => (
                            <label key={e} className="flex items-center gap-1 text-sm"><Checkbox checked={energies.includes(e)} onCheckedChange={v => setEnergies(l => v ? [...l, e] : l.filter(x => x !== e))} />{e.replace(/_/g, ' ')}</label>
                        ))}</div>
                    )}
                    {type === 'site' && (
                        <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">{sites.map(x => (
                            <label key={x.id} className="flex items-center gap-2 text-sm"><Checkbox checked={siteIds.includes(x.id)} onCheckedChange={v => setSiteIds(l => v ? [...l, x.id] : l.filter(y => y !== x.id))} /><span className="font-mono text-xs">{x.code}</span> {x.name}</label>
                        ))}</div>
                    )}
                </div>
                <DialogFooter><Button variant="outline" onClick={onClose}>Annuler</Button><Button disabled={busy || !nom.trim() || (type === 'site' && siteIds.length === 0)} onClick={() => onSubmit({ nom, usage, perimetre })}>Créer</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function FormuleVersionDialog({ formule, date, onClose, onSubmit, busy }: {
    formule: P1Formule; date: string; onClose: () => void; busy: boolean;
    onSubmit: (v: FormuleVersion, meta: { dateEffet: string | null; motif: string; document: string | null }) => void;
}) {
    const base = enVigueur(formule.versions, date)?.valeur ?? DEFAULT_VERSION;
    const [v, setV] = useState<FormuleVersion>(base);
    const [termes, setTermes] = useState(formatTermes(base.termes));
    const [dateEffet, setDateEffet] = useState('');
    const [motif, setMotif] = useState('');
    const [document, setDocument] = useState('');
    const parsed = termes.trim() ? parseTermes(termes) : [];
    const set = <K extends keyof FormuleVersion>(k: K, value: FormuleVersion[K]) => setV(x => ({ ...x, [k]: value }));
    const sel = (label: string, k: 'forme' | 'mode' | 'baseEnergetique' | 'unitePrix' | 'regimeKmol' | 'periodicite', options: readonly string[]) => (
        <div className="space-y-1"><Label>{label}</Label>
            <Select value={v[k] as string} onValueChange={x => set(k, x as never)}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{options.map(o => <SelectItem key={o} value={o}>{o.replace(/_/g, ' ')}</SelectItem>)}</SelectContent></Select></div>
    );
    return (
        <Dialog open onOpenChange={o => !o && onClose()}>
            <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>Nouvelle version : {formule.nom}</DialogTitle>
                    <DialogDescription>Le prix de base vient du site. Forme A : pondérations sommant à 100 % ; forme B : rapport des sommes.</DialogDescription></DialogHeader>
                <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                        {sel('Forme', 'forme', ['A', 'B'])}
                        {sel('Périodicité', 'periodicite', PERIODICITES_REVISION)}
                        {sel('Unité du prix', 'unitePrix', UNITES_PRIX)}
                        {sel('Mode', 'mode', ['standard', 'derogatoire'])}
                        {sel('Base énergétique', 'baseEnergetique', ['PCS', 'PCI'])}
                        {sel('Molécule', 'regimeKmol', ['variable', 'fixe'])}
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1"><Label>Mois M0</Label><Input type="month" value={v.dateM0 ?? ''} onChange={e => set('dateM0', e.target.value || null)} /></div>
                        {!v.dateM0 && <div className="col-span-2 space-y-1"><Label>M0 inconnu : ce qui manque</Label><Input value={v.m0Manquante ?? ''} onChange={e => set('m0Manquante', e.target.value || null)} placeholder="date M0 à retrouver dans le marché" /></div>}
                        {v.regimeKmol === 'fixe' && <div className="space-y-1"><Label>Prix molécule négocié</Label><Input inputMode="decimal" value={v.prixMoleculeNegocie ?? ''} onChange={e => set('prixMoleculeNegocie', e.target.value ? Number(e.target.value.replace(',', '.')) : null)} /></div>}
                    </div>
                    <label className="flex items-center gap-2 text-sm"><Checkbox checked={v.prixFixe} onCheckedChange={x => set('prixFixe', !!x)} />Prix fixe (non révisable)</label>
                    <div className="space-y-1">
                        <Label>Termes</Label>
                        <Input value={termes} onChange={e => setTermes(e.target.value)} className="font-mono text-xs" placeholder="p0=0,15 ; Kmol=0,60*PEGMA@25,30 ; TVD=0,25*ATRD_T2@3,10" />
                        <p className="text-xs text-muted-foreground">code=coefficient*INDICE@base M0 ; « ! » base contractuelle ; « ~ » terme inactif ; panier : *(1*IND1+0,8*IND2+0,5*#2,1). Séparés par « ; ».</p>
                        {typeof parsed === 'string' && <p className="text-xs text-destructive">{parsed}</p>}
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1"><Label>Date d'effet</Label><Input type="date" value={dateEffet} onChange={e => setDateEffet(e.target.value)} /></div>
                        <div className="col-span-2 space-y-1"><Label>Motif *</Label><Input value={motif} onChange={e => setMotif(e.target.value)} placeholder="marché d'origine, avenant n°3…" /></div>
                    </div>
                    <div className="space-y-1"><Label>Pièce justificative (lien)</Label><Input value={document} onChange={e => setDocument(e.target.value)} placeholder="facultatif" /></div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuler</Button>
                    <Button disabled={busy || !motif.trim() || typeof parsed === 'string'} onClick={() => onSubmit({ ...v, termes: parsed as FormuleVersion['termes'] }, { dateEffet: dateEffet || null, motif, document: document.trim() || null })}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enregistrer
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function PrixPreview({ sites }: { sites: SiteRef[] }) {
    const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
    const [debut, setDebut] = useState(() => today().slice(0, 7));
    const [usage, setUsage] = useState<'chauffage' | 'ecs'>('chauffage');
    const [preview, setPreview] = useState<PrixP1Preview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const fmt = (x: number) => x.toLocaleString('fr-FR', { maximumFractionDigits: 4 });
    const load = async () => {
        setLoading(true);
        const r = await previewPrixP1Action(siteId, usage, debut);
        setLoading(false);
        if (r.success) { setPreview(r.data); setError(null); } else setError(r.error);
    };
    return (
        <div className="space-y-2 pt-2">
            <h4 className="text-sm font-semibold">Prix révisés (aperçu)</h4>
            <div className="flex flex-wrap items-end gap-3">
                {sites.length > 1 && (
                    <div className="space-y-1"><Label>Site</Label>
                        <Select value={siteId} onValueChange={v => { setSiteId(v); setPreview(null); }}><SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                            <SelectContent>{sites.map(x => <SelectItem key={x.id} value={x.id}>{x.code} — {x.name}</SelectItem>)}</SelectContent></Select></div>
                )}
                <div className="space-y-1"><Label>À partir de</Label><Input type="month" value={debut} onChange={e => setDebut(e.target.value)} className="w-40" /></div>
                <div className="space-y-1"><Label>Usage</Label>
                    <Select value={usage} onValueChange={v => setUsage(v as 'chauffage' | 'ecs')}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="chauffage">Chauffage</SelectItem><SelectItem value="ecs">ECS</SelectItem></SelectContent></Select></div>
                <Button size="sm" variant="outline" onClick={load} disabled={loading}>{loading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}Calculer 12 mois</Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {preview && (
                <div className="overflow-x-auto">
                    <p className="text-xs text-muted-foreground">{preview.formule ? `Formule « ${preview.formule} », ${preview.periodicite?.replace(/_/g, ' ')}.` : 'Aucune formule en vigueur.'}</p>
                    <table className="w-full text-xs">
                        <thead><tr className="text-muted-foreground"><th className="text-left font-normal">Mois</th><th className="text-right font-normal">Prix de base</th><th className="text-right font-normal">Coefficient</th><th className="text-right font-normal">Prix du mois</th><th className="text-right font-normal">Prix retenu</th><th /></tr></thead>
                        <tbody>{preview.mois.map(m => (
                            <tr key={m.mois} className="border-t">
                                <td>{m.mois}</td>
                                <td className="text-right">{m.prixBase !== null ? fmt(m.prixBase) : '—'}</td>
                                <td className="text-right">{'coefficient' in m.mensuel ? fmt(m.mensuel.coefficient) : '—'}</td>
                                <td className="text-right">{'prix' in m.mensuel ? fmt(m.mensuel.prix) : '—'}</td>
                                <td className="text-right font-medium">{'prix' in m.retenu ? fmt(m.retenu.prix) : '—'}</td>
                                <td className="pl-2 text-muted-foreground">{'causes' in m.retenu ? m.retenu.causes.join(' ; ') : m.retenu.provisoire ? 'provisoire' : ''}</td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
