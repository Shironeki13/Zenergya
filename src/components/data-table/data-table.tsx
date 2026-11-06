'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FiltreMulti } from '@/components/pilotage/filtre-multi';
import { SearchParamSync } from '@/components/navigation/search-param-sync';
import { cn, downloadCSV } from '@/lib/utils';
import { appliquerTable, normaliser, type ColonneTri, type FiltreTable, type TriTable } from '@/components/data-table/logique';

/**
 * Tableau commun des listes : recherche, filtres à choix multiples (avec effectifs), tri par colonne, pagination,
 * choix des colonnes, export CSV des lignes filtrées, sélection et actions groupées, lignes cliquables.
 * Colonnes, taille de page et tri sont mémorisés par liste dans le navigateur (`id`). Voir docs/ergonomie.md.
 */

export type Colonne<T> = ColonneTri<T> & {
    label: string;
    cell: (row: T) => React.ReactNode;
    /** Valeur exportée (CSV) ; absente : colonne non exportée. */
    exporter?: (row: T) => string | number | null | undefined;
    className?: string;
    align?: 'left' | 'right' | 'center';
    /** Masquée par défaut (ajoutable par « Colonnes »). */
    masquee?: boolean;
    /** Toujours affichée (pas dans « Colonnes »). */
    fixe?: boolean;
};

type Props<T> = {
    /** Clé de mémorisation des préférences (colonnes, tri, taille de page). */
    id: string;
    rows: T[];
    rowId: (row: T) => string;
    colonnes: Colonne<T>[];
    chargement?: boolean;
    recherche?: { placeholder: string; valeurs: (row: T) => (string | null | undefined)[]; parametreUrl?: string };
    filtres?: FiltreTable<T>[];
    triInitial?: TriTable;
    /** Ligne cliquable : adresse de la fiche (Ctrl/⌘ + clic : nouvel onglet). */
    lien?: (row: T) => string;
    /** Actions de la ligne (menu, boutons), dernière colonne ; ne déclenchent pas l'ouverture de la ligne. */
    actions?: (row: T) => React.ReactNode;
    /** Sélection : lignes sélectionnables et actions groupées. */
    selection?: { possible?: (row: T) => boolean; actions: (lignes: T[], vider: () => void) => React.ReactNode };
    export?: { fichier: string };
    /** Boutons propres à la liste (« Nouveau… »), à droite de la barre d'outils. */
    boutons?: React.ReactNode;
    vide?: { titre: string; description?: string; action?: React.ReactNode };
};

const TAILLES = [25, 50, 100];

type Prefs = { masquees?: string[]; taille?: number; tri?: TriTable | null };
const lirePrefs = (id: string): Prefs => { try { return JSON.parse(localStorage.getItem(`zenergya.table.${id}`) ?? '{}'); } catch { return {}; } };
const ecrirePrefs = (id: string, p: Prefs) => { try { localStorage.setItem(`zenergya.table.${id}`, JSON.stringify(p)); } catch { /* stockage indisponible */ } };

export function DataTable<T>({ id, rows, rowId, colonnes, chargement, recherche, filtres = [], triInitial, lien, actions, selection, export: exp, boutons, vide }: Props<T>) {
    const router = useRouter();
    const [q, setQ] = useState('');
    const [valeursFiltres, setValeursFiltres] = useState<Record<string, string[]>>({});
    const [tri, setTri] = useState<TriTable | null>(triInitial ?? null);
    const [masquees, setMasquees] = useState<string[]>(() => colonnes.filter(c => c.masquee).map(c => c.id));
    const [taille, setTaille] = useState(25);
    const [page, setPage] = useState(0);
    const [selectionIds, setSelectionIds] = useState<string[]>([]);

    // Préférences mémorisées (après le premier rendu : le stockage n'existe pas côté serveur).
    useEffect(() => {
        const p = lirePrefs(id);
        if (p.masquees) setMasquees(p.masquees);
        if (p.taille && TAILLES.includes(p.taille)) setTaille(p.taille);
        if (p.tri !== undefined) setTri(p.tri);
    }, [id]);
    const memoriser = (p: Prefs) => ecrirePrefs(id, { ...lirePrefs(id), ...p });

    const { lignes, effectifs } = useMemo(
        () => appliquerTable(rows, { recherche: recherche?.valeurs, q, filtres, valeurs: valeursFiltres, colonnes, tri }),
        [rows, recherche, q, filtres, valeursFiltres, colonnes, tri],
    );
    useEffect(() => { setPage(0); }, [q, valeursFiltres, tri, taille]);
    // Sélection : retire les lignes disparues (suppression, rechargement) ; état inchangé sinon (pas de rendu en boucle).
    useEffect(() => {
        setSelectionIds(ids => {
            if (!ids.length) return ids;
            const presents = new Set(rows.map(rowId));
            const garde = ids.filter(i => presents.has(i));
            return garde.length === ids.length ? ids : garde;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows]);

    const pages = Math.max(1, Math.ceil(lignes.length / taille));
    const pageCourante = Math.min(page, pages - 1);
    const visibles = lignes.slice(pageCourante * taille, (pageCourante + 1) * taille);
    const colonnesVisibles = colonnes.filter(c => c.fixe || !masquees.includes(c.id));
    const filtresActifs = Object.entries(valeursFiltres).filter(([, v]) => v.length > 0);
    const filtre = q.trim() !== '' || filtresActifs.length > 0;

    const selectionnables = selection ? lignes.filter(r => selection.possible?.(r) ?? true) : [];
    const selectionnees = rows.filter(r => selectionIds.includes(rowId(r)));
    const toutCoche = selectionnables.length > 0 && selectionnables.every(r => selectionIds.includes(rowId(r)));
    const nbColonnes = colonnesVisibles.length + (selection ? 1 : 0) + (actions ? 1 : 0);

    const trier = (colId: string) => {
        const suivant: TriTable | null = tri?.id !== colId ? { id: colId, sens: 'asc' } : tri.sens === 'asc' ? { id: colId, sens: 'desc' } : null;
        setTri(suivant);
        memoriser({ tri: suivant });
    };
    const reinitialiser = () => { setQ(''); setValeursFiltres({}); };
    const exporter = () => {
        const cols = colonnes.filter(c => c.exporter);
        downloadCSV(lignes.map(r => Object.fromEntries(cols.map(c => [c.label, c.exporter!(r) ?? '']))), exp!.fichier);
    };
    const ouvrir = (e: React.MouseEvent, row: T) => {
        if (!lien) return;
        // Clic sur un élément interactif de la ligne (lien, bouton, case, menu) : il garde son propre comportement.
        if ((e.target as HTMLElement).closest('a,button,input,label,[role="checkbox"],[role="menuitem"],[data-no-row-click]')) return;
        if (e.ctrlKey || e.metaKey) window.open(lien(row), '_blank');
        else router.push(lien(row));
    };

    return (
        <div className="space-y-3">
            {recherche?.parametreUrl && <SearchParamSync name={recherche.parametreUrl} onValue={setQ} />}
            {/* Barre d'outils : recherche, filtres, colonnes, export, actions de la liste */}
            <div className="flex flex-wrap items-center gap-2">
                {recherche && (
                    <div className="relative w-full sm:w-72">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input type="search" placeholder={recherche.placeholder} className="h-9 pl-8" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher" />
                    </div>
                )}
                {filtres.map(f => (
                    <FiltreMulti key={f.id} libelle={f.label}
                        options={(f.options ?? effectifs[f.id]?.options ?? []).map(o => ({ id: o.value, label: `${o.label} (${effectifs[f.id]?.compte[o.value] ?? 0})` }))}
                        valeurs={valeursFiltres[f.id] ?? []} onChange={v => setValeursFiltres(x => ({ ...x, [f.id]: v }))} />
                ))}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="h-9 gap-1"><Columns3 className="h-4 w-4" />Colonnes</Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel>Colonnes affichées</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {colonnes.filter(c => !c.fixe).map(c => (
                                <DropdownMenuCheckboxItem key={c.id} checked={!masquees.includes(c.id)} onSelect={e => e.preventDefault()}
                                    onCheckedChange={v => { const m = v ? masquees.filter(x => x !== c.id) : [...masquees, c.id]; setMasquees(m); memoriser({ masquees: m }); }}>
                                    {c.label}
                                </DropdownMenuCheckboxItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    {exp && <Button variant="outline" size="sm" className="h-9 gap-1" onClick={exporter} disabled={lignes.length === 0}><Download className="h-4 w-4" />Exporter ({lignes.length})</Button>}
                    {boutons}
                </div>
            </div>

            {/* Filtres actifs */}
            {filtre && (
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    {q.trim() && <Badge variant="outline" className="gap-1 bg-muted/60 font-normal">« {q.trim()} »<button type="button" onClick={() => setQ('')} aria-label="Effacer la recherche"><X className="h-3 w-3" /></button></Badge>}
                    {filtresActifs.flatMap(([fid, vals]) => {
                        const f = filtres.find(x => x.id === fid);
                        const opts = f?.options ?? effectifs[fid]?.options ?? [];
                        return vals.map(v => (
                            <Badge key={`${fid}-${v}`} variant="outline" className="gap-1 bg-muted/60 font-normal">
                                <span className="text-muted-foreground">{f?.label} :</span> <span className="font-medium">{opts.find(o => o.value === v)?.label ?? v}</span>
                                <button type="button" aria-label="Retirer ce filtre" onClick={() => setValeursFiltres(x => ({ ...x, [fid]: (x[fid] ?? []).filter(y => y !== v) }))}><X className="h-3 w-3" /></button>
                            </Badge>
                        ));
                    })}
                    <Button variant="link" size="sm" className="h-auto p-0" onClick={reinitialiser}>Tout effacer</Button>
                </div>
            )}

            {/* Actions groupées */}
            {selection && selectionnees.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                    <span className="font-medium">{selectionnees.length} sélectionné(s)</span>
                    {selection.actions(selectionnees, () => setSelectionIds([]))}
                    <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => setSelectionIds([])}>Désélectionner</Button>
                </div>
            )}

            <div className="rounded-md border bg-background">
                <Table>
                    <TableHeader>
                        <TableRow>
                            {selection && (
                                <TableHead className="w-10">
                                    <Checkbox checked={toutCoche} disabled={selectionnables.length === 0} aria-label="Tout sélectionner (lignes filtrées)"
                                        onCheckedChange={v => setSelectionIds(v ? selectionnables.map(rowId) : [])} />
                                </TableHead>
                            )}
                            {colonnesVisibles.map(c => (
                                <TableHead key={c.id} className={cn('whitespace-nowrap', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}
                                    aria-sort={tri?.id === c.id ? (tri.sens === 'asc' ? 'ascending' : 'descending') : undefined}>
                                    {c.tri ? (
                                        <button type="button" onClick={() => trier(c.id)} className={cn('inline-flex items-center gap-1 hover:text-foreground', c.align === 'right' && 'flex-row-reverse')}>
                                            {c.label}
                                            {tri?.id === c.id ? (tri.sens === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />) : <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />}
                                        </button>
                                    ) : c.label}
                                </TableHead>
                            ))}
                            {actions && <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {chargement ? Array.from({ length: 6 }, (_, i) => (
                            <TableRow key={`sq-${i}`}>{Array.from({ length: nbColonnes }, (_, j) => <TableCell key={j}><Skeleton className="h-4 w-full max-w-[160px]" /></TableCell>)}</TableRow>
                        )) : visibles.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={nbColonnes} className="h-32 text-center">
                                    {filtre ? (
                                        <div className="space-y-2 text-muted-foreground">
                                            <p>Aucun résultat pour ces critères.</p>
                                            <Button variant="outline" size="sm" onClick={reinitialiser}>Effacer la recherche et les filtres</Button>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <p className="font-medium">{vide?.titre ?? 'Aucun élément.'}</p>
                                            {vide?.description && <p className="text-sm text-muted-foreground">{vide.description}</p>}
                                            {vide?.action}
                                        </div>
                                    )}
                                </TableCell>
                            </TableRow>
                        ) : visibles.map(row => {
                            const rid = rowId(row);
                            const coche = selectionIds.includes(rid);
                            return (
                                <TableRow key={rid} data-state={coche ? 'selected' : undefined} className={cn(lien && 'cursor-pointer')} onClick={e => ouvrir(e, row)}>
                                    {selection && (
                                        <TableCell>
                                            {(selection.possible?.(row) ?? true) && (
                                                <Checkbox checked={coche} aria-label="Sélectionner la ligne"
                                                    onCheckedChange={v => setSelectionIds(ids => v ? [...ids, rid] : ids.filter(x => x !== rid))} />
                                            )}
                                        </TableCell>
                                    )}
                                    {colonnesVisibles.map(c => (
                                        <TableCell key={c.id} className={cn(c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>{c.cell(row)}</TableCell>
                                    ))}
                                    {actions && <TableCell className="text-right" data-no-row-click>{actions(row)}</TableCell>}
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination */}
            {!chargement && lignes.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                    <span>
                        {pageCourante * taille + 1}–{Math.min((pageCourante + 1) * taille, lignes.length)} sur {lignes.length}
                        {filtre && rows.length !== lignes.length && ` (filtré sur ${rows.length})`}
                    </span>
                    <div className="flex items-center gap-2">
                        <span>Lignes par page</span>
                        <Select value={String(taille)} onValueChange={v => { setTaille(Number(v)); memoriser({ taille: Number(v) }); }}>
                            <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
                            <SelectContent>{TAILLES.map(t => <SelectItem key={t} value={String(t)}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                        <Button variant="outline" size="icon" className="h-8 w-8" disabled={pageCourante === 0} onClick={() => setPage(pageCourante - 1)} aria-label="Page précédente"><ChevronLeft className="h-4 w-4" /></Button>
                        <span className="tabular-nums">{pageCourante + 1} / {pages}</span>
                        <Button variant="outline" size="icon" className="h-8 w-8" disabled={pageCourante >= pages - 1} onClick={() => setPage(pageCourante + 1)} aria-label="Page suivante"><ChevronRight className="h-4 w-4" /></Button>
                    </div>
                </div>
            )}
        </div>
    );
}

export { normaliser };
