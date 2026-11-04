'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';

/**
 * Champ numérique tolérant la saisie française (virgule) : garde le texte saisi,
 * transmet un nombre (ou null si vide / invalide).
 */
export function NumberField({ value, onChange, disabled, placeholder, className, ariaLabel }: {
    value: number | null | undefined;
    onChange: (v: number | null) => void;
    disabled?: boolean;
    placeholder?: string;
    className?: string;
    ariaLabel?: string;
}) {
    const toText = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
    const [text, setText] = useState(toText(value));
    const [focused, setFocused] = useState(false);

    // Valeur modifiée de l'extérieur (rechargement, annulation) : resynchronise hors saisie.
    useEffect(() => { if (!focused) setText(toText(value)); }, [value, focused]);

    return (
        <Input
            inputMode="decimal"
            aria-label={ariaLabel}
            className={className}
            placeholder={placeholder}
            disabled={disabled}
            value={text}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); setText(toText(value)); }}
            onChange={e => {
                setText(e.target.value);
                const raw = e.target.value.replace(/\s/g, '').replace(',', '.');
                const n = raw === '' ? null : Number(raw);
                onChange(n === null || Number.isNaN(n) ? null : n);
            }}
        />
    );
}
