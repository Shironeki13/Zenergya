import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { cleTiers, type Tiers } from '@/lib/billing/adressage';

/** Tiers d'adressage des factures (syndics, payeurs) : collection `tiers`, lue et écrite par le serveur seulement. */

const COL = 'tiers';
const texte = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const lire = (d: FirebaseFirestore.DocumentSnapshot): Tiers => {
    const x = d.data() ?? {};
    return { id: d.id, name: texte(x.name), quality: texte(x.quality), address: texte(x.address), postalCode: texte(x.postalCode), city: texte(x.city), siret: texte(x.siret), email: texte(x.email), phone: texte(x.phone) };
};

export async function listerTiers(): Promise<Tiers[]> {
    return (await adminDb.collection(COL).get()).docs.map(lire).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export type SaisieTiers = Omit<Tiers, 'id'>;

/**
 * Crée ou modifie un tiers. Deux tiers ne peuvent pas porter le même nom (le nom fait le lien avec les clients) ;
 * un renommage est reporté sur les clients qui citaient l'ancien nom.
 */
export async function enregistrerTiers(id: string | null, saisie: SaisieTiers, par: string): Promise<Tiers> {
    const name = texte(saisie.name);
    if (name.length < 2) throw new Error('Le nom du tiers est requis.');
    const siret = texte(saisie.siret).replace(/\s/g, '');
    if (siret && !/^\d{14}$/.test(siret)) throw new Error('Le SIRET compte 14 chiffres.');
    const tous = await listerTiers();
    if (tous.some(t => t.id !== id && cleTiers(t.name) === cleTiers(name))) throw new Error(`Un tiers « ${name} » existe déjà.`);
    const donnees = { name, quality: texte(saisie.quality), address: texte(saisie.address), postalCode: texte(saisie.postalCode), city: texte(saisie.city), siret, email: texte(saisie.email), phone: texte(saisie.phone) };
    const maintenant = new Date().toISOString();
    if (!id) {
        const ref = await adminDb.collection(COL).add({ ...donnees, createdAt: maintenant, createdBy: par });
        return { id: ref.id, ...donnees };
    }
    const ref = adminDb.collection(COL).doc(id);
    const avant = await ref.get();
    if (!avant.exists) throw new Error('Tiers introuvable.');
    await ref.update({ ...donnees, updatedAt: maintenant, updatedBy: par });
    const ancien = texte(avant.get('name'));
    if (ancien && ancien !== name) {
        for (const champ of ['representedBy', 'payer'] as const) {
            const cites = (await adminDb.collection('clients').where(champ, '==', ancien).get()).docs;
            for (let i = 0; i < cites.length; i += 400) {
                const lot = adminDb.batch();
                cites.slice(i, i + 400).forEach(c => lot.update(c.ref, { [champ]: name }));
                await lot.commit();
            }
        }
    }
    return { id, ...donnees };
}

/** Suppression refusée tant qu'un client cite le tiers comme représentant ou payeur. */
export async function supprimerTiers(id: string): Promise<void> {
    const ref = adminDb.collection(COL).doc(id);
    const d = await ref.get();
    if (!d.exists) return;
    const cle = cleTiers(texte(d.get('name')));
    const clients = await adminDb.collection('clients').select('representedBy', 'payer', 'name').get();
    const cite = clients.docs.filter(c => cleTiers(c.get('representedBy')) === cle || cleTiers(c.get('payer')) === cle);
    if (cite.length) throw new Error(`Ce tiers est cité par ${cite.length} client(s), dont « ${cite[0].get('name')} ».`);
    await ref.delete();
}

/**
 * Crée la fiche d'un tiers cité (nouveau syndic d'un changement validé) ou complète celle qui existe : seuls les
 * champs encore vides sont renseignés, une adresse déjà saisie n'est jamais écrasée.
 */
export async function completerTiers(saisie: SaisieTiers, par: string): Promise<Tiers | null> {
    const name = texte(saisie.name);
    if (name.length < 2) return null;
    const existant = (await listerTiers()).find(t => cleTiers(t.name) === cleTiers(name));
    if (!existant) return enregistrerTiers(null, { ...saisie, name }, par);
    const { id, ...actuel } = existant;
    // L'adresse se complète d'un bloc : pas de ville d'une source sous la rue d'une autre.
    const adresse = !texte(actuel.address) && !texte(actuel.city) && texte(saisie.address) && texte(saisie.city)
        ? { address: texte(saisie.address), postalCode: texte(saisie.postalCode), city: texte(saisie.city) } : {};
    const autres = Object.fromEntries((['quality', 'email', 'phone', 'siret'] as const).filter(k => !texte(actuel[k]) && texte(saisie[k])).map(k => [k, texte(saisie[k])]));
    if (!Object.keys(adresse).length && !Object.keys(autres).length) return existant;
    return enregistrerTiers(id, { ...actuel, ...adresse, ...autres }, par);
}

export type LigneAnnuaire = {
    /** Fiche du tiers ; absente pour un nom cité par des clients sans fiche. */
    tiers: Tiers | null;
    name: string;
    representes: number;
    payes: number;
    /** Quelques clients qui le citent (les premiers par ordre alphabétique). */
    clients: { id: string; name: string }[];
    complet: boolean;
};

/**
 * Annuaire : les tiers enregistrés et les noms cités par des clients sans fiche, avec le nombre de clients concernés.
 * `visibles` restreint les clients comptés et nommés au périmètre de l'utilisateur (null : tous).
 */
export async function annuaireTiers(visibles: Set<string> | null): Promise<LigneAnnuaire[]> {
    const [tiers, clients] = await Promise.all([listerTiers(), adminDb.collection('clients').select('name', 'representedBy', 'payer').get()]);
    const lignes = new Map<string, LigneAnnuaire>();
    for (const t of tiers) lignes.set(cleTiers(t.name), { tiers: t, name: t.name, representes: 0, payes: 0, clients: [], complet: !!(t.address && t.city) });
    const cites = clients.docs.filter(c => !visibles || visibles.has(c.id)).map(c => ({ id: c.id, name: texte(c.get('name')), representedBy: texte(c.get('representedBy')), payer: texte(c.get('payer')) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    for (const c of cites) {
        for (const [champ, compteur] of [['representedBy', 'representes'], ['payer', 'payes']] as const) {
            const nom = c[champ];
            if (!nom) continue;
            const k = cleTiers(nom);
            const l = lignes.get(k) ?? { tiers: null, name: nom, representes: 0, payes: 0, clients: [], complet: false };
            l[compteur]++;
            if (l.clients.length < 5 && !l.clients.some(x => x.id === c.id)) l.clients.push({ id: c.id, name: c.name });
            lignes.set(k, l);
        }
    }
    // À compléter d'abord (les plus cités en tête), puis l'annuaire par ordre alphabétique.
    return [...lignes.values()].sort((a, b) => Number(a.complet) - Number(b.complet) || (a.complet ? 0 : (b.representes + b.payes) - (a.representes + a.payes)) || a.name.localeCompare(b.name, 'fr'));
}
