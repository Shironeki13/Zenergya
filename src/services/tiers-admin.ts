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
