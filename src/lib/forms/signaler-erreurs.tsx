import type { FieldErrors } from 'react-hook-form';
import { toast } from '@/hooks/use-toast';

/**
 * À passer en second argument de `form.handleSubmit(onSubmit, signalerErreurs)` : un message liste les champs à corriger
 * (lus à l'écran) et l'écran défile jusqu'au premier ; les champs d'un onglet non affiché sont comptés à part.
 */
export function signalerErreurs(errors: FieldErrors): void {
    const total = compter(errors);
    if (!total) return;
    // Les champs passent en erreur au rendu suivant : lecture des libellés une fois l'écran à jour.
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const invalides = [...document.querySelectorAll<HTMLElement>('[aria-invalid="true"]')];
        const lignes = invalides.map(ligneErreur).filter(Boolean).slice(0, 6);
        const caches = Math.max(0, total - invalides.length);
        invalides[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        invalides[0]?.focus({ preventScroll: true });
        toast({
            variant: 'destructive',
            title: `${total} champ${total > 1 ? 's' : ''} à corriger`,
            description: (
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {lignes.map(l => <li key={l}>{l}</li>)}
                    {invalides.length > lignes.length && <li>… et {invalides.length - lignes.length} autre(s), en rouge à l&apos;écran.</li>}
                    {caches > 0 && <li>{caches} dans un autre onglet ou une autre étape : vérifiez les onglets.</li>}
                    {!lignes.length && !caches && <li>Les champs en rouge sont à corriger.</li>}
                </ul>
            ),
        });
    }));
}

/** « Libellé : motif », sans répéter le libellé quand le motif le contient déjà (« La raison sociale est requise. »). */
function ligneErreur(el: HTMLElement): string {
    const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    let nom = '';
    if (label) {
        const copie = label.cloneNode(true) as HTMLElement;
        copie.querySelectorAll('[aria-hidden="true"], .sr-only').forEach(n => n.remove());
        nom = copie.textContent?.replace(/\s*\*\s*$/, '').trim() ?? '';
    }
    const message = el.getAttribute('aria-describedby')?.split(' ').map(id => document.getElementById(id))
        .find(m => m?.id.endsWith('-form-item-message'))?.textContent?.trim() ?? '';
    const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (message && nom && sansAccents(message).includes(sansAccents(nom))) return message;
    return [nom, message || 'à corriger'].filter(Boolean).join(' : ');
}

function compter(e: unknown): number {
    if (!e || typeof e !== 'object') return 0;
    if ('message' in e && typeof (e as { message?: unknown }).message === 'string' && !('0' in e)) return 1;
    return Object.values(e as Record<string, unknown>).reduce<number>((n, v) => n + (v && typeof v === 'object' && 'ref' in (v as object) ? 1 : compter(v)), 0);
}
