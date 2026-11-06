'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * Fenêtres de confirmation et de saisie de l'application, à la place de `window.confirm` et `window.prompt` :
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: 'Supprimer ce relevé ?', destructive: true }))) return;
 *
 *   const prompt = usePrompt();
 *   const motif = await prompt({ title: 'Retirer la version', label: 'Motif du retrait', required: true });
 *   if (motif === null) return; // annulé
 */

export type ConfirmOptions = { title: string; description?: React.ReactNode; confirmLabel?: string; cancelLabel?: string; destructive?: boolean };
export type PromptOptions = {
    title: string; description?: React.ReactNode; label: string; placeholder?: string; defaultValue?: string;
    required?: boolean; multiline?: boolean; confirmLabel?: string;
};

type Ctx = { confirm: (o: ConfirmOptions) => Promise<boolean>; prompt: (o: PromptOptions) => Promise<string | null> };
const ConfirmContext = createContext<Ctx | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
    const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);
    const [promptState, setPromptState] = useState<PromptOptions | null>(null);
    const [value, setValue] = useState('');
    const [touched, setTouched] = useState(false);
    const resolveConfirm = useRef<(v: boolean) => void>();
    const resolvePrompt = useRef<(v: string | null) => void>();

    const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>(res => { resolveConfirm.current = res; setConfirmState(o); }), []);
    const prompt = useCallback((o: PromptOptions) => new Promise<string | null>(res => {
        resolvePrompt.current = res; setValue(o.defaultValue ?? ''); setTouched(false); setPromptState(o);
    }), []);

    const closeConfirm = (v: boolean) => { resolveConfirm.current?.(v); resolveConfirm.current = undefined; setConfirmState(null); };
    const closePrompt = (v: string | null) => { resolvePrompt.current?.(v); resolvePrompt.current = undefined; setPromptState(null); };
    const invalid = !!promptState?.required && value.trim() === '';
    const submitPrompt = () => { setTouched(true); if (!invalid) closePrompt(value.trim()); };

    return (
        <ConfirmContext.Provider value={{ confirm, prompt }}>
            {children}
            <AlertDialog open={!!confirmState} onOpenChange={o => { if (!o) closeConfirm(false); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{confirmState?.title}</AlertDialogTitle>
                        {confirmState?.description && <AlertDialogDescription asChild><div>{confirmState.description}</div></AlertDialogDescription>}
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => closeConfirm(false)}>{confirmState?.cancelLabel ?? 'Annuler'}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => closeConfirm(true)}
                            className={cn(confirmState?.destructive && 'bg-destructive text-destructive-foreground hover:bg-destructive/90')}>
                            {confirmState?.confirmLabel ?? 'Confirmer'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <Dialog open={!!promptState} onOpenChange={o => { if (!o) closePrompt(null); }}>
                <DialogContent>
                    <form onSubmit={e => { e.preventDefault(); submitPrompt(); }} className="space-y-4">
                        <DialogHeader>
                            <DialogTitle>{promptState?.title}</DialogTitle>
                            {promptState?.description && <DialogDescription asChild><div>{promptState.description}</div></DialogDescription>}
                        </DialogHeader>
                        <div className="space-y-1.5">
                            <Label htmlFor="app-prompt">{promptState?.label}{promptState?.required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}</Label>
                            {promptState?.multiline
                                ? <Textarea id="app-prompt" autoFocus rows={3} value={value} onChange={e => setValue(e.target.value)} placeholder={promptState.placeholder} aria-invalid={touched && invalid} />
                                : <Input id="app-prompt" autoFocus value={value} onChange={e => setValue(e.target.value)} placeholder={promptState?.placeholder} aria-invalid={touched && invalid} />}
                            {touched && invalid && <p className="text-sm text-destructive">Ce champ est obligatoire.</p>}
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => closePrompt(null)}>Annuler</Button>
                            <Button type="submit">{promptState?.confirmLabel ?? 'Valider'}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </ConfirmContext.Provider>
    );
}

function useCtx(): Ctx {
    const ctx = useContext(ConfirmContext);
    if (!ctx) throw new Error('ConfirmProvider manquant (layout de l\'application).');
    return ctx;
}

export const useConfirm = () => useCtx().confirm;
export const usePrompt = () => useCtx().prompt;
