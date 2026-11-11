'use client';

import { FileText, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Pièce justificative d'un document de contrat (avenant, OS, reconduction, résiliation, changement de syndic ou de
 * BE) : obligatoire, c'est elle qui fait foi. PDF ou image, 20 Mo au plus, déposée dans le dossier du contrat.
 */

export const TAILLE_MAX_PIECE = 20 * 1024 * 1024;
const TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

export function PieceJustificative({ fichier, onChange, erreur, obligatoire = true, libelle = 'Pièce justificative' }: { fichier: File | null; onChange: (f: File | null) => void; erreur?: boolean; obligatoire?: boolean; libelle?: string }) {
    const tropGros = !!fichier && fichier.size > TAILLE_MAX_PIECE;
    const mauvaisType = !!fichier && !TYPES.includes(fichier.type);
    return (
        <div className="space-y-1.5">
            <Label htmlFor="piece-justificative" className={cn(erreur && 'text-destructive')}>
                {libelle}{obligatoire && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
            </Label>
            {fichier ? (
                <div className="flex items-center gap-2 rounded-md border p-2 text-sm">
                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate">{fichier.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{(fichier.size / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo</span>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => onChange(null)} aria-label="Retirer le fichier"><X className="h-3.5 w-3.5" /></Button>
                </div>
            ) : (
                <div className="flex items-center gap-2">
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                    <Input id="piece-justificative" type="file" accept="application/pdf,image/png,image/jpeg" aria-invalid={erreur}
                        onChange={e => onChange(e.target.files?.[0] ?? null)} />
                </div>
            )}
            {(erreur && !fichier) && <p className="text-sm text-destructive">Joignez le document signé : c&apos;est lui qui fait foi.</p>}
            {tropGros && <p className="text-sm text-destructive">Fichier trop volumineux (20 Mo au plus).</p>}
            {mauvaisType && <p className="text-sm text-destructive">PDF, PNG ou JPEG uniquement.</p>}
            {!erreur && !fichier && <p className="text-xs text-muted-foreground">Document signé (PDF, PNG ou JPEG, 20 Mo au plus).{obligatoire ? ' Obligatoire.' : ' Recommandé : sans lui, la validation le signale.'}</p>}
        </div>
    );
}

/** Pièce valide (présente, du bon type, pas trop grosse). */
export const pieceValide = (f: File | null): f is File => !!f && f.size <= TAILLE_MAX_PIECE && TYPES.includes(f.type);

/**
 * Dépose la pièce dans le dossier du contrat ; renvoie son adresse et son nom. Le dépôt est fait par le serveur
 * (/api/pieces), qui contrôle la session, le périmètre de l'utilisateur, le type et la taille du fichier.
 */
export async function deposerPiece(fichier: File, contractId: string, dossier: string): Promise<{ documentUrl: string; documentName: string }> {
    const form = new FormData();
    form.set('fichier', fichier);
    form.set('contractId', contractId);
    form.set('dossier', dossier);
    const res = await fetch('/api/pieces', { method: 'POST', credentials: 'same-origin', body: form });
    const corps = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(corps?.error || `Dépôt refusé (${res.status}).`);
    return { documentUrl: corps.documentUrl, documentName: corps.documentName };
}
