'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useConfirm } from '@/components/confirm-provider';

/**
 * Prévient avant de quitter une saisie non enregistrée : fermeture ou rechargement de l'onglet (navigateur), clic sur
 * un lien de l'application (menu, fil d'Ariane, recherche…). `actif` : il y a des modifications non enregistrées.
 */
export function useAlerteModifications(actif: boolean) {
    const router = useRouter();
    const confirmer = useConfirm();
    const autorise = useRef(false);

    useEffect(() => {
        if (!actif) return;
        autorise.current = false;
        const avantDeQuitter = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
        const surClic = (e: MouseEvent) => {
            if (autorise.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
            if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
            const url = new URL(a.href, window.location.href);
            if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
            e.preventDefault();
            e.stopPropagation();
            confirmer({
                title: 'Quitter sans enregistrer ?', description: 'Les modifications de ce formulaire seront perdues.',
                confirmLabel: 'Quitter sans enregistrer', cancelLabel: 'Rester sur la page', destructive: true,
            }).then(ok => {
                if (!ok) return;
                autorise.current = true;
                router.push(`${url.pathname}${url.search}${url.hash}`);
            });
        };
        window.addEventListener('beforeunload', avantDeQuitter);
        document.addEventListener('click', surClic, true);
        return () => { window.removeEventListener('beforeunload', avantDeQuitter); document.removeEventListener('click', surClic, true); };
    }, [actif, confirmer, router]);
}
