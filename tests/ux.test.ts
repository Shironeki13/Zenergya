// Ergonomie : navigation (entrée active, droits), champs obligatoires déduits des schémas, messages de validation : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { activeNavItem, navGroupsFor, NAV_GROUPS } from '../src/components/navigation/nav-config';
import { champObligatoire } from '../src/lib/forms/champs-obligatoires';
import '../src/lib/forms/zod-fr';
import { ClientSchema } from '../src/lib/types';

test('menu : entrée active la plus précise, fiches et sous-pages comprises ; entrées réservées aux administrateurs', () => {
    const actif = (p: string) => { const a = activeNavItem(p); return a && `${a.group.label} › ${a.item.label}`; };
    assert.equal(actif('/contracts'), 'Clients et contrats › Contrats');
    assert.equal(actif('/contracts/abc123/edit'), 'Clients et contrats › Contrats');
    assert.equal(actif('/contracts/library'), 'Clients et contrats › Contrathèque');
    assert.equal(actif('/billing'), 'Facturation › Facturation manuelle');
    assert.equal(actif('/billing/suivi'), 'Pilotage › Suivi facturation');
    assert.equal(actif('/meters/alertes'), 'Compteurs et énergie › Alertes compteurs');
    assert.equal(actif('/billingx'), null);
    const admin = (a: boolean) => navGroupsFor(a).flatMap(g => g.items.map(i => i.href));
    assert.ok(admin(true).includes('/imports') && !admin(false).includes('/imports'));
    // Chaque page n'apparaît qu'une fois.
    const hrefs = NAV_GROUPS.flatMap(g => g.items.map(i => i.href));
    assert.equal(new Set(hrefs).size, hrefs.length);
});

test('champs obligatoires : déduits du schéma (texte non vide, optionnel, défaut, tableaux, raffinements)', () => {
    const s = z.object({
        nom: z.string().min(1), commentaire: z.string(), email: z.string().email().optional().or(z.literal('')),
        montant: z.number(), statut: z.enum(['a', 'b']).default('a'), actif: z.boolean(), debut: z.date().nullable(),
        sites: z.array(z.object({ nom: z.string().min(1, 'Nom requis'), ville: z.string().optional() })),
    }).superRefine(() => {});
    const req = (p: string) => champObligatoire(s, p);
    assert.deepEqual(['nom', 'commentaire', 'email', 'montant', 'statut', 'actif', 'debut'].map(req), [true, false, false, true, false, false, false]);
    assert.deepEqual([req('sites.0.nom'), req('sites.3.ville'), req('inconnu'), req('sites')], [true, false, false, false]);
    // Fiche client : raison sociale, société, agence obligatoires ; SIRET (conditionnel) non marqué.
    assert.deepEqual(['name', 'companyId', 'agencyId', 'typologyId', 'siret', 'representedBy'].map(p => champObligatoire(ClientSchema, p)), [true, true, true, true, false, false]);
});

test('messages de validation en français, ceux des schémas restent prioritaires', () => {
    const r = z.object({ a: z.string(), b: z.string().min(1), c: z.string().min(1, 'Nom requis'), d: z.string().email(), e: z.number() })
        .safeParse({ b: '', c: '', d: 'x', e: 'x' });
    assert.ok(!r.success);
    assert.deepEqual(r.error.issues.map(i => i.message), ['Champ obligatoire.', 'Champ obligatoire.', 'Nom requis', 'Adresse e-mail invalide.', 'Nombre attendu.']);
});
