'use server';

import { requireUser } from '@/lib/auth/server';
import { gardePerimetre } from '@/lib/auth/perimetre-server';
import { encaisser, encours, type Encours } from '@/services/encours-admin';

/** Encours et relances : utilisateurs du module Facturation (ou administrateurs), dans leur périmètre. */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const run = async <T,>(f: (u: Awaited<ReturnType<typeof requireUser>>) => Promise<T>): Promise<Result<T>> => {
    try {
        const u = await requireUser();
        if (!u.isAdmin && !u.profile.modules?.includes('billing')) throw new Error('Réservé aux utilisateurs du module Facturation.');
        return { success: true, data: JSON.parse(JSON.stringify(await f(u))) as T };
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : 'Opération impossible.' }; }
};

export const encoursAction = async (): Promise<Result<Encours>> => run(u => encours(gardePerimetre(u)));
export const encaisserAction = async (ids: string[]): Promise<Result<number>> => run(u => encaisser(Array.isArray(ids) ? ids.map(String) : [], gardePerimetre(u), u.email));
