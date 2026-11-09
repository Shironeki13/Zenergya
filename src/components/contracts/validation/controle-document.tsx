'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle, ExternalLink, Loader2, Pencil, RotateCcw, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { PieceJustificative, deposerPiece, pieceValide } from '@/components/contracts/events/piece-justificative';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
    CHAMPS_VALIDATION, LIBELLE_UNITAIRE, afficherValeur, champsAControler, effetsValidation, normaliserCorrection,
    type DefChamp, type ElementAValider, type ValeurChamp,
} from '@/lib/validations';
import { traiterValidationAction } from '@/lib/validations-actions';

/**
 * Contrôle d'un document par la contrathèque, garante des documents : la pièce à gauche, à droite chaque valeur saisie
 * à cocher « conforme au document » ou à corriger (l'ancienne valeur est conservée). « Valider » reste grisé tant que
 * tout n'est pas contrôlé et que la pièce manque ; les effets sur le contrat sont rappelés avant de valider.
 */

const estImage = (nom: string | null | undefined) => /\.(png|jpe?g)$/i.test(nom ?? '');

function Apercu({ url, nom }: { url: string; nom: string | null }) {
    return estImage(nom)
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={url} alt={nom ?? 'Document'} className="h-full w-full object-contain" />
        : <iframe src={url} title={nom ?? 'Document'} className="h-full w-full rounded border-0 bg-white" />;
}

function SaisieChamp({ def, valeur, onValider, onAnnuler }: { def: DefChamp; valeur: ValeurChamp; onValider: (v: unknown) => void; onAnnuler: () => void }) {
    const [v, setV] = useState<string | boolean>(def.type === 'booleen' ? valeur === true : valeur === null ? '' : String(valeur));
    const id = `corr-${def.cle}`;
    return (
        <div className="mt-2 flex flex-wrap items-center gap-2">
            {def.type === 'booleen'
                ? <div className="flex items-center gap-2"><Switch id={id} checked={v === true} onCheckedChange={setV} /><Label htmlFor={id}>{v ? 'Oui' : 'Non'}</Label></div>
                : <Input id={id} aria-label={`Valeur corrigée : ${def.libelle}`} autoFocus className="h-8 max-w-[240px]"
                    type={def.type === 'date' ? 'date' : def.type === 'email' ? 'email' : 'text'} inputMode={def.type === 'montant' ? 'decimal' : undefined}
                    value={String(v)} onChange={e => setV(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onValider(v); } if (e.key === 'Escape') { e.stopPropagation(); onAnnuler(); } }} />}
            <Button type="button" size="sm" className="h-8" onClick={() => onValider(v)}>Appliquer</Button>
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={onAnnuler}>Annuler</Button>
        </div>
    );
}

export function ControleDocument({ element, onClose, onTraite }: { element: ElementAValider | null; onClose: () => void; onTraite: () => Promise<void> | void }) {
    const { toast } = useToast();
    const [coches, setCoches] = useState<Set<string>>(new Set());
    const [corrections, setCorrections] = useState<Record<string, ValeurChamp>>({});
    const [edition, setEdition] = useState<string | null>(null);
    const [erreurCorrection, setErreurCorrection] = useState<{ cle: string; message: string } | null>(null);
    const [piece, setPiece] = useState<File | null>(null);
    const [apercuLocal, setApercuLocal] = useState<string | null>(null);
    const [refus, setRefus] = useState<string | null>(null);
    const [enCours, setEnCours] = useState(false);

    // Nouveau document : contrôle repris de zéro.
    useEffect(() => {
        setCoches(new Set()); setCorrections({}); setEdition(null); setErreurCorrection(null); setPiece(null); setRefus(null);
    }, [element?.type, element?.id]);
    useEffect(() => {
        if (!piece) { setApercuLocal(null); return; }
        const u = URL.createObjectURL(piece); setApercuLocal(u);
        return () => URL.revokeObjectURL(u);
    }, [piece]);

    const valeurs = useMemo(() => ({ ...(element?.valeurs ?? {}), ...corrections }), [element, corrections]);
    const aControler = useMemo(() => (element ? champsAControler(element.type, valeurs) : []), [element, valeurs]);
    const nbCoches = aControler.filter(c => coches.has(c.cle)).length;
    if (!element) return null;

    const type = element.type;
    const champs = CHAMPS_VALIDATION[type].filter(c => aControler.includes(c));
    const pieceManquante = !element.documentUrl && !pieceValide(piece);
    const complet = nbCoches === aControler.length;
    const effets = effetsValidation({ type, effet: element.effet, donnees: { ...element.donnees, ...corrections } });

    const basculer = (cle: string, oui: boolean) => setCoches(s => { const n = new Set(s); if (oui) n.add(cle); else n.delete(cle); return n; });
    const corriger = (def: DefChamp, brut: unknown) => {
        try {
            const v = normaliserCorrection(type, def.cle, brut);
            setCorrections(c => {
                const n = { ...c };
                if (v === element.valeurs[def.cle]) delete n[def.cle]; else n[def.cle] = v;
                return n;
            });
            basculer(def.cle, true); // la valeur corrigée vient d'être lue dans le document
            setEdition(null); setErreurCorrection(null);
        } catch (e) {
            setErreurCorrection({ cle: def.cle, message: e instanceof Error ? e.message : 'Valeur invalide.' });
        }
    };
    const annulerCorrection = (cle: string) => { setCorrections(c => { const n = { ...c }; delete n[cle]; return n; }); basculer(cle, false); };

    const envoyer = async (decision: 'valider' | 'refuser') => {
        setEnCours(true);
        try {
            const pieceJointe = decision === 'valider' && !element.documentUrl && pieceValide(piece)
                ? await deposerPiece(piece, element.contractId, 'base-marche').then(p => ({ url: p.documentUrl, name: p.documentName }))
                : null;
            const r = await traiterValidationAction(type, element.id, decision === 'valider'
                ? { decision, controles: [...coches].filter(c => aControler.some(d => d.cle === c)), corrections, piece: pieceJointe }
                : { decision, motif: refus ?? '' });
            if (!r.success) { toast({ title: 'Opération refusée', description: r.error, variant: 'destructive' }); return; }
            const nb = Object.keys(corrections).length;
            toast({
                title: decision === 'valider' ? 'Document validé' : 'Document refusé',
                description: `${LIBELLE_UNITAIRE[type]} ${element.contractNumber}${decision === 'valider' && nb ? ` · ${nb} correction(s) enregistrée(s)` : ''}`,
            });
            onClose();
            await onTraite();
        } catch (e) {
            toast({ title: 'Opération impossible', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
        } finally {
            setEnCours(false);
        }
    };

    const urlApercu = element.documentUrl ?? apercuLocal;
    return (
        <Dialog open onOpenChange={o => { if (!o && !enCours) onClose(); }}>
            <DialogContent className="flex h-[92vh] max-w-[1400px] flex-col gap-3 p-4 sm:w-[96vw]">
                <DialogHeader>
                    <DialogTitle className="flex flex-wrap items-center gap-2">
                        Contrôle : {LIBELLE_UNITAIRE[type]}
                        <Link href={`/contracts/${element.contractId}`} target="_blank" className="font-mono text-sm font-normal underline">{element.contractNumber}</Link>
                        <span className="text-sm font-normal text-muted-foreground">· {element.clientName}</span>
                    </DialogTitle>
                    <DialogDescription>
                        Demandé par {element.demandePar || '—'}{element.demandeLe ? ` le ${new Date(element.demandeLe).toLocaleDateString('fr-FR')}` : ''}.
                        Comparez chaque valeur au document : cochez-la si elle est conforme, corrigez-la sinon.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
                    {/* Document */}
                    <section aria-label="Document" className="flex min-h-[300px] flex-col overflow-hidden rounded-md border bg-muted/40">
                        <div className="flex items-center justify-between gap-2 border-b bg-background px-3 py-2 text-sm">
                            <span className="truncate font-medium">{element.documentName ?? piece?.name ?? 'Aucun document'}</span>
                            {element.documentUrl && <a href={element.documentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-primary underline">Ouvrir<ExternalLink className="h-3.5 w-3.5" /></a>}
                        </div>
                        <div className="min-h-0 flex-1">
                            {urlApercu ? <Apercu url={urlApercu} nom={element.documentName ?? piece?.name ?? null} /> : (
                                <div className="flex h-full flex-col justify-center gap-3 p-6">
                                    <p className="font-medium text-destructive">{type === 'contrat' ? 'Contrat signé absent : il est obligatoire pour valider.' : 'Pièce justificative absente : refusez le document.'}</p>
                                    {type === 'contrat' && <PieceJustificative fichier={piece} onChange={setPiece} libelle="Joindre le contrat signé" />}
                                </div>
                            )}
                        </div>
                    </section>

                    {/* Valeurs à contrôler */}
                    <section aria-label="Valeurs à contrôler" className="flex min-h-0 flex-col gap-3">
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="font-semibold">Valeurs saisies</h3>
                            <Badge variant={complet ? 'secondary' : 'outline'} className={cn(complet && 'bg-green-100 text-green-800')}>{nbCoches} / {aControler.length} contrôlée(s)</Badge>
                        </div>
                        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                            {champs.map(def => {
                                const corrige = def.cle in corrections;
                                const coche = coches.has(def.cle);
                                return (
                                    <li key={def.cle} className={cn('rounded-md border p-2.5', coche && 'border-green-300 bg-green-50/60', corrige && 'border-amber-300 bg-amber-50/60')}>
                                        <div className="flex items-start gap-3">
                                            <Checkbox id={`ctl-${def.cle}`} checked={coche} onCheckedChange={c => basculer(def.cle, c === true)} className="mt-0.5"
                                                aria-label={`${def.libelle} conforme au document`} />
                                            <div className="min-w-0 flex-1">
                                                <Label htmlFor={`ctl-${def.cle}`} className="text-xs text-muted-foreground">{def.libelle}</Label>
                                                <div className="break-words text-sm font-medium">
                                                    {afficherValeur(def, valeurs[def.cle] ?? null)}
                                                    {corrige && <span className="ml-2 text-xs font-normal text-muted-foreground line-through" title="Valeur saisie">{afficherValeur(def, element.valeurs[def.cle] ?? null)}</span>}
                                                </div>
                                                {edition === def.cle && <SaisieChamp def={def} valeur={valeurs[def.cle] ?? null} onValider={v => corriger(def, v)} onAnnuler={() => { setEdition(null); setErreurCorrection(null); }} />}
                                                {erreurCorrection?.cle === def.cle && <p className="mt-1 text-xs text-destructive">{erreurCorrection.message}</p>}
                                            </div>
                                            {!def.fige && edition !== def.cle && (corrige
                                                ? <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => annulerCorrection(def.cle)}><RotateCcw className="h-3.5 w-3.5" />Rétablir</Button>
                                                : <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setEdition(def.cle)}><Pencil className="h-3.5 w-3.5" />Corriger</Button>)}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>

                        <div className="space-y-1 rounded-md border bg-muted/40 p-2.5 text-sm">
                            <p className="font-medium">À la validation :</p>
                            <ul className="list-disc pl-5 text-muted-foreground">{effets.map(x => <li key={x}>{x}</li>)}</ul>
                        </div>

                        {refus !== null ? (
                            <div className="space-y-2">
                                <Label htmlFor="motif-refus">Motif du refus <span className="text-destructive">*</span></Label>
                                <Textarea id="motif-refus" autoFocus value={refus} onChange={e => setRefus(e.target.value)} placeholder="Ce qui ne va pas, pour que le demandeur corrige." />
                                <div className="flex justify-end gap-2">
                                    <Button variant="outline" onClick={() => setRefus(null)} disabled={enCours}>Annuler</Button>
                                    <Button variant="destructive" onClick={() => envoyer('refuser')} disabled={enCours || !refus.trim()}>
                                        {enCours ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <XCircle className="mr-1 h-4 w-4" />}Refuser
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                {(!complet || pieceManquante) && (
                                    <p className="mr-auto text-xs text-muted-foreground">
                                        {pieceManquante ? 'Pièce manquante. ' : ''}{!complet ? `Encore ${aControler.length - nbCoches} valeur(s) à contrôler.` : ''}
                                    </p>
                                )}
                                <Button variant="outline" className="text-destructive" onClick={() => setRefus('')} disabled={enCours}><XCircle className="mr-1 h-4 w-4" />Refuser…</Button>
                                <Button onClick={() => envoyer('valider')} disabled={enCours || !complet || pieceManquante} className="bg-green-700 hover:bg-green-800">
                                    {enCours ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-1 h-4 w-4" />}Valider
                                </Button>
                            </div>
                        )}
                    </section>
                </div>
            </DialogContent>
        </Dialog>
    );
}
