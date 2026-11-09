// Jeu de données SIMULÉES pour la démo (émulateurs Firebase uniquement) : référentiels, clients, contacts, contrats,
// sites, compteurs, relevés, prestations, factures, documents de contrat à valider (avec leurs pièces PDF), comptes de
// test. Les données passent par le moteur d'import et de facturation de l'application : codes, liens et montants sont
// ceux que l'application produirait.
//   npm run demo:donnees            (remet les émulateurs à zéro puis les remplit)
// Garde-fou : refuse de tourner hors émulateurs ou sur un projet dont l'identifiant ne commence pas par « demo- ».
import { Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { adminAuth, adminDb } from '../../src/lib/firebase-admin';
import { applyImport, type ImportReport } from '../../src/services/imports-admin';
import { prepareContractInvoice } from '../../src/services/contract-billing-admin';
import { createInvoice } from '../../src/services/firestore-admin';
import type { ImportEntityKey } from '../../src/lib/imports/definitions';

const env = process.env;
const PROJET = env.FIREBASE_PROJECT_ID ?? env.GCLOUD_PROJECT ?? '';
if (!env.FIRESTORE_EMULATOR_HOST || !env.FIREBASE_AUTH_EMULATOR_HOST || !env.FIREBASE_STORAGE_EMULATOR_HOST || !PROJET.startsWith('demo-')) {
    console.error('Refusé : uniquement sur les émulateurs Firebase et un projet « demo-… » (voir docs/demo.md).');
    process.exit(1);
}
const BUCKET = `${PROJET}.appspot.com`;
export const MOT_DE_PASSE = 'Demo-Zenergya-2026';
const AUJOURDHUI = '2026-11-09';

// --- Utilitaires ---

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const paris = (jour: string) => Timestamp.fromDate(new Date(`${jour}T00:00:00+01:00`));
const instant = (jour: string, h = 10) => `${jour}T${String(h).padStart(2, '0')}:00:00.000Z`;

async function importer(entite: ImportEntityKey, table: unknown[][]): Promise<ImportReport> {
    const r = await applyImport(entite, table, { fileName: `demo-${entite}.xlsx`, by: 'demo@example.com' });
    if (r.errors.length) {
        console.error(`Import ${entite} : ${r.errors.length} ligne(s) en erreur`);
        for (const e of r.errors) console.error(`  ligne ${e.line} : ${e.messages.join(' ')}`);
        throw new Error(`Import ${entite} incomplet.`);
    }
    console.log(`  ${entite} : ${r.created} créé(s)`);
    return r;
}
/** SIRET fictif au format valide (clé de Luhn) : 999 + n° de démo. */
function siretFictif(n: number): string {
    const base = `999${String(n).padStart(10, '0')}`;
    for (let c = 0; c <= 9; c++) {
        const s = base + c;
        const somme = [...s].reverse().reduce((t, d, i) => { const v = Number(d) * (i % 2 ? 2 : 1); return t + (v > 9 ? v - 9 : v); }, 0);
        if (somme % 10 === 0) return s;
    }
    throw new Error('SIRET');
}
/** Code ou identifiant attribué à chaque ligne de données (ligne 2 = première ligne après l'en-tête). */
const parLigne = (r: ImportReport) => new Map(r.results.map(x => [x.line, x]));

/** PDF d'une page (texte simple), lisible par tout lecteur. */
function pdf(titre: string, lignes: string[]): Buffer {
    const esc = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[«»]/g, '"').replace(/[’]/g, "'").replace(/[^\x20-\x7e]/g, '').replace(/([\\()])/g, '\\$1');
    const texte = [`BT /F1 16 Tf 60 780 Td (${esc(titre)}) Tj ET`, ...lignes.map((l, i) => `BT /F1 11 Tf 60 ${740 - i * 20} Td (${esc(l)}) Tj ET`),
        'BT /F1 8 Tf 60 60 Td (Document fictif - donnees simulees pour la demonstration Zenergya) Tj ET'].join('\n');
    const objets = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${Buffer.byteLength(texte)} >>\nstream\n${texte}\nendstream`,
    ];
    let out = '%PDF-1.4\n';
    const pos: number[] = [];
    objets.forEach((o, i) => { pos.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = Buffer.byteLength(out);
    out += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${pos.map(p => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
}

/** Dépose une pièce dans le stockage ; adresse relative (servie par le relais de la démo, même origine). */
async function piece(chemin: string, titre: string, lignes: string[]): Promise<{ documentUrl: string; documentName: string }> {
    const jeton = `demo-${Math.random().toString(36).slice(2)}`;
    const nom = chemin.split('/').pop()!;
    await getStorage().bucket(BUCKET).file(chemin).save(pdf(titre, lignes), {
        contentType: 'application/pdf',
        metadata: { contentDisposition: `inline; filename*=utf-8''${encodeURIComponent(nom)}`, metadata: { firebaseStorageDownloadTokens: jeton } },
    });
    return { documentUrl: `/v0/b/${BUCKET}/o/${encodeURIComponent(chemin)}?alt=media&token=${jeton}`, documentName: nom };
}

// --- Remise à zéro ---

async function remiseAZero() {
    const [fs, au] = [env.FIRESTORE_EMULATOR_HOST, env.FIREBASE_AUTH_EMULATOR_HOST];
    const r1 = await fetch(`http://${fs}/emulator/v1/projects/${PROJET}/databases/(default)/documents`, { method: 'DELETE' });
    const r2 = await fetch(`http://${au}/emulator/v1/projects/${PROJET}/accounts`, { method: 'DELETE' });
    if (!r1.ok || !r2.ok) throw new Error('Remise à zéro des émulateurs impossible.');
    const [fichiers] = await getStorage().bucket(BUCKET).getFiles().catch(() => [[]] as never);
    await Promise.all(fichiers.map(f => f.delete()));
    console.log('Émulateurs remis à zéro.');
}

// --- Référentiels ---

async function referentiels() {
    await set('companies', 'demo-zen', {
        code: 'ZEN', name: 'Zenergya Services (démo)', address: '12 rue de l\'Exemple', postalCode: '69003', city: 'Lyon',
        siret: '90000000000013', siren: '900000000', vatNumber: 'FR00900000000', quoteCoefficient: 1.35, quoteLaborRate: 68, quoteValidityDays: 90, quoteDefaultVatRate: 20,
    });
    for (const [id, name] of [['demo-ag-lyon', 'Lyon'], ['demo-ag-paris', 'Paris Est']]) await set('agencies', id, { name, companyId: 'demo-zen', companyName: 'Zenergya Services (démo)' });
    for (const [id, name, agencyId] of [['demo-se-ln', 'Lyon Nord', 'demo-ag-lyon'], ['demo-se-ls', 'Lyon Sud', 'demo-ag-lyon'], ['demo-se-p', 'Paris 11e-12e', 'demo-ag-paris']]) {
        await set('sectors', id, { name, agencyId });
    }
    for (const [id, name, regime] of [['demo-ty-copro', 'Copropriété', 'b2b'], ['demo-ty-bailleur', 'Bailleur social', 'b2b'], ['demo-ty-public', 'Collectivité', 'b2g'], ['demo-ty-tertiaire', 'Tertiaire', 'b2b']]) {
        await set('typologies', id, { name, einvoicingRegime: regime });
    }
    for (const [id, code, rate] of [['demo-tva20', 'TVA20', 0.2], ['demo-tva10', 'TVA10', 0.1], ['demo-tva55', 'TVA5,5', 0.055]] as const) await set('vatRates', id, { code, rate });
    for (const [id, code, label, type, vat] of [
        ['demo-p1', 'P1', 'Fourniture de chaleur', 'P1', 'demo-tva55'], ['demo-p2', 'P2', 'Conduite et petit entretien', 'P2', 'demo-tva20'],
        ['demo-p3', 'P3', 'Garantie totale (gros entretien)', 'P3', 'demo-tva20'],
    ]) await set('activities', id, { code, label, type, vatRateId: vat });
    for (const [id, name] of [['demo-mens', 'Mensuel'], ['demo-trim', 'Trimestriel'], ['demo-ann', 'Annuel']]) await set('schedules', id, { name });
    for (const [id, name] of [['demo-echoir', 'À échoir'], ['demo-echu', 'Terme échu']]) await set('terms', id, { name });
    await set('paymentTerms', 'demo-30j', { code: '30J', deadline: '30 jours', days: 30, endOfMonth: false });
    await set('paymentTerms', 'demo-45fdm', { code: '45FDM', deadline: '45 jours fin de mois', days: 45, endOfMonth: true });
    for (const [id, code, label, unit] of [['demo-mt-gaz', 'GAZ', 'Gaz naturel', 'kWh'], ['demo-mt-calo', 'CALO', 'Compteur de calories', 'MWh'], ['demo-mt-eau', 'EAU', 'Eau chaude sanitaire', 'm³'], ['demo-mt-elec', 'ELEC', 'Électricité', 'kWh']]) {
        await set('meterTypes', id, { code, label, unit });
    }
    await set('markets', 'demo-mkt-1', { code: 'MP-2024-017', label: 'Marché public exploitation chauffage 2024', description: 'Marché fictif de la démo' });
    console.log('Référentiels créés.');
}

// --- Comptes de test ---

const COMPTES = [
    { id: 'demo-u-adv', email: 'adv@example.com', name: 'Claire Martin (ADV)', firstName: 'Claire', roleId: 'demo-r-adv' },
    { id: 'demo-u-adv2', email: 'adv2@example.com', name: 'Julien Petit (ADV)', firstName: 'Julien', roleId: 'demo-r-adv' },
    { id: 'demo-u-ctq', email: 'contratheque@example.com', name: 'Sophie Bernard (contrathèque)', firstName: 'Sophie', roleId: 'demo-r-ctq' },
    { id: 'demo-u-admin', email: 'admin@example.com', name: 'Marc Leroy (administrateur)', firstName: 'Marc', roleId: 'demo-r-admin' },
];

async function comptes() {
    await set('roles', 'demo-r-adv', { name: 'ADV', isAdmin: false });
    await set('roles', 'demo-r-ctq', { name: 'Contrathèque', isAdmin: false, isContratheque: true });
    await set('roles', 'demo-r-admin', { name: 'Administrateur', isAdmin: true });
    for (const c of COMPTES) {
        const u = await adminAuth.createUser({ email: c.email, password: MOT_DE_PASSE, displayName: c.name });
        await set('users', c.id, {
            name: c.name, firstName: c.firstName, email: c.email, roleId: c.roleId, authUid: u.uid,
            modules: ['contracts', 'billing', 'settings'], scope: { companyIds: ['*'], agencyIds: ['*'], sectorIds: ['*'] },
        });
    }
    console.log(`Comptes de test : ${COMPTES.map(c => c.email).join(', ')} (mot de passe ${MOT_DE_PASSE}).`);
}

// --- Clients, contacts ---

type DefClient = { nom: string; type: 'Privé' | 'Public'; typo: string; adresse: string; cp: string; ville: string; agence: string; secteur: string; syndic?: string; prospect?: boolean; paiement: string };
const CLIENTS: DefClient[] = [
    { nom: 'Copropriété Les Tilleuls', type: 'Privé', typo: 'Copropriété', adresse: '4 allée des Tilleuls', cp: '69004', ville: 'Lyon', agence: 'Lyon', secteur: 'Lyon Nord', syndic: 'Cabinet Exemple Gestion', paiement: '30J' },
    { nom: 'Résidence Le Parc des Cèdres', type: 'Privé', typo: 'Copropriété', adresse: '18 avenue des Cèdres', cp: '69100', ville: 'Villeurbanne', agence: 'Lyon', secteur: 'Lyon Nord', syndic: 'Syndic Démo Immobilier', paiement: '30J' },
    { nom: 'SDC Le Belvédère', type: 'Privé', typo: 'Copropriété', adresse: '2 montée du Belvédère', cp: '69005', ville: 'Lyon', agence: 'Lyon', secteur: 'Lyon Sud', syndic: 'Cabinet Exemple Gestion', paiement: '45FDM' },
    { nom: 'Habitat Solidaire Démo', type: 'Privé', typo: 'Bailleur social', adresse: '55 rue du Logement', cp: '69007', ville: 'Lyon', agence: 'Lyon', secteur: 'Lyon Sud', paiement: '45FDM' },
    { nom: 'Commune de Saint-Exemple', type: 'Public', typo: 'Collectivité', adresse: '1 place de la Mairie', cp: '69230', ville: 'Saint-Genis-Laval', agence: 'Lyon', secteur: 'Lyon Sud', paiement: '30J' },
    { nom: 'Groupe scolaire Jules-Exemple', type: 'Public', typo: 'Collectivité', adresse: '9 rue des Écoles', cp: '75011', ville: 'Paris', agence: 'Paris Est', secteur: 'Paris 11e-12e', paiement: '30J' },
    { nom: 'Copropriété Square Voltaire', type: 'Privé', typo: 'Copropriété', adresse: '140 boulevard Voltaire', cp: '75011', ville: 'Paris', agence: 'Paris Est', secteur: 'Paris 11e-12e', syndic: 'Syndic Démo Immobilier', paiement: '30J' },
    { nom: 'Bureaux Quai Est (SCI Démo)', type: 'Privé', typo: 'Tertiaire', adresse: '30 quai de l\'Exemple', cp: '75012', ville: 'Paris', agence: 'Paris Est', secteur: 'Paris 11e-12e', paiement: '45FDM' },
    { nom: 'Résidence Les Hauts de Bercy', type: 'Privé', typo: 'Copropriété', adresse: '7 rue de Bercy-Démo', cp: '75012', ville: 'Paris', agence: 'Paris Est', secteur: 'Paris 11e-12e', syndic: 'Cabinet Exemple Gestion', paiement: '30J' },
    { nom: 'Clinique du Parc (démo)', type: 'Privé', typo: 'Tertiaire', adresse: '3 rue de la Santé-Démo', cp: '69008', ville: 'Lyon', agence: 'Lyon', secteur: 'Lyon Sud', paiement: '45FDM' },
    { nom: 'Copropriété Le Clos Fleuri', type: 'Privé', typo: 'Copropriété', adresse: '21 chemin Fleuri', cp: '69300', ville: 'Caluire-et-Cuire', agence: 'Lyon', secteur: 'Lyon Nord', syndic: 'Syndic Démo Immobilier', paiement: '30J' },
    { nom: 'Résidence Les Terrasses (prospect)', type: 'Privé', typo: 'Copropriété', adresse: '12 rue des Terrasses', cp: '69009', ville: 'Lyon', agence: 'Lyon', secteur: 'Lyon Nord', prospect: true, paiement: '30J' },
];

async function clientsEtContacts(): Promise<string[]> {
    const r = await importer('clients', [
        ['Raison sociale', 'Type', 'Relation', 'SIRET', 'Adresse', 'Code postal', 'Ville', 'Typologie', 'Société', 'Agence', 'Secteur', 'Représenté par', 'Conditions de paiement'],
        ...CLIENTS.map((c, i) => [c.nom, c.type, c.prospect ? 'Prospect' : 'Client', c.type === 'Public' ? siretFictif(1000 + i) : '', c.adresse, c.cp, c.ville, c.typo, 'ZEN', c.agence, c.secteur, c.syndic ?? '', c.paiement]),
    ]);
    const codes = CLIENTS.map((_, i) => parLigne(r).get(i + 2)!.code!);
    const prenoms = ['Nathalie Durand', 'Pierre Moreau', 'Isabelle Laurent', 'Thomas Simon', 'Céline Michel', 'Antoine Lefebvre', 'Émilie Garcia', 'Nicolas Roux', 'Laura Fournier', 'Hugo Girard', 'Camille Bonnet', 'Lucas Dupont'];
    await importer('contacts', [
        ['Client', 'Type', 'Nom', 'Email', 'Téléphone', 'Fonction'],
        ...codes.flatMap((code, i) => [
            [code, 'Principal', prenoms[i], `contact${i + 1}@example.com`, `04 72 00 ${String(10 + i).padStart(2, '0')} 0${i % 10}`, CLIENTS[i].syndic ? 'Gestionnaire de copropriété' : 'Responsable technique'],
            // Deux clients sans contact de facturation : apparaissent dans « À faire ».
            ...(i % 5 === 3 ? [] : [[code, 'Facturation', `Service comptable ${i + 1}`, `factures${i + 1}@example.com`, '', 'Comptabilité fournisseurs']]),
        ]),
    ]);
    return codes;
}

// --- Contrats, sites, compteurs, relevés, prestations ---

type DefContrat = {
    client: number; libelle: string; debut: string; fin: string; statut?: 'Actif' | 'Résilié' | 'Terminé'; marche: 'Privé' | 'Public';
    activites: string[]; base: { P1?: number; P2?: number; P3?: number }; echeancier: string; tacite: boolean; facturation?: 'Multi-site' | 'Globale';
    sites: { nom: string; adresse: string; compteur?: 'GAZ' | 'CALO'; ecs?: boolean; prestations: { act: string; montant: number; periodicite?: string; terme?: string }[] }[];
};
const CONTRATS: DefContrat[] = [
    { client: 0, libelle: 'Chaufferie collective', debut: '2024-07-01', fin: '2029-06-30', marche: 'Privé', activites: ['P1', 'P2', 'P3'], base: { P1: 38000, P2: 6200, P3: 2400 }, echeancier: 'Trimestriel', tacite: true,
        sites: [{ nom: 'Tilleuls - Bâtiment A', adresse: '4 allée des Tilleuls', compteur: 'GAZ', ecs: true, prestations: [{ act: 'P1', montant: 22000, periodicite: 'Mensuel', terme: 'Terme échu' }, { act: 'P2', montant: 3600 }, { act: 'P3', montant: 1400 }] },
            { nom: 'Tilleuls - Bâtiment B', adresse: '6 allée des Tilleuls', compteur: 'GAZ', prestations: [{ act: 'P1', montant: 16000, periodicite: 'Mensuel', terme: 'Terme échu' }, { act: 'P2', montant: 2600 }, { act: 'P3', montant: 1000 }] }] },
    { client: 1, libelle: 'Sous-station réseau de chaleur', debut: '2025-01-01', fin: '2030-12-31', marche: 'Privé', activites: ['P2', 'P3'], base: { P2: 8400, P3: 3100 }, echeancier: 'Trimestriel', tacite: false,
        sites: [{ nom: 'Parc des Cèdres - Sous-station', adresse: '18 avenue des Cèdres', compteur: 'CALO', prestations: [{ act: 'P2', montant: 8400 }, { act: 'P3', montant: 3100 }] }] },
    { client: 2, libelle: 'Exploitation chauffage et ECS', debut: '2023-10-01', fin: '2027-09-30', marche: 'Privé', activites: ['P1', 'P2'], base: { P1: 27500, P2: 4800 }, echeancier: 'Trimestriel', tacite: true,
        sites: [{ nom: 'Belvédère - Chaufferie', adresse: '2 montée du Belvédère', compteur: 'GAZ', ecs: true, prestations: [{ act: 'P1', montant: 27500, periodicite: 'Mensuel', terme: 'Terme échu' }, { act: 'P2', montant: 4800 }] }] },
    { client: 3, libelle: 'Patrimoine Lyon 7e - lot 1', debut: '2025-07-01', fin: '2031-06-30', marche: 'Privé', activites: ['P2', 'P3'], base: { P2: 15600, P3: 7200 }, echeancier: 'Trimestriel', tacite: false, facturation: 'Globale',
        sites: [{ nom: 'Résidence Gerland', adresse: '55 rue du Logement', compteur: 'GAZ', prestations: [{ act: 'P2', montant: 5200 }, { act: 'P3', montant: 2400 }] },
            { nom: 'Résidence Jean-Macé', adresse: '61 rue du Logement', compteur: 'GAZ', prestations: [{ act: 'P2', montant: 5200 }, { act: 'P3', montant: 2400 }] },
            { nom: 'Résidence Guillotière', adresse: '70 rue du Logement', compteur: 'GAZ', prestations: [{ act: 'P2', montant: 5200 }, { act: 'P3', montant: 2400 }] }] },
    { client: 4, libelle: 'Bâtiments communaux', debut: '2024-01-01', fin: '2027-12-31', marche: 'Public', activites: ['P2'], base: { P2: 12800 }, echeancier: 'Trimestriel', tacite: false,
        sites: [{ nom: 'Mairie de Saint-Exemple', adresse: '1 place de la Mairie', compteur: 'GAZ', prestations: [{ act: 'P2', montant: 4800 }] },
            { nom: 'Gymnase municipal', adresse: '5 rue du Stade', compteur: 'GAZ', prestations: [{ act: 'P2', montant: 5000 }] },
            { nom: 'Médiathèque', adresse: '8 rue des Arts', prestations: [{ act: 'P2', montant: 3000 }] }] },
    { client: 5, libelle: 'Groupe scolaire - chauffage', debut: '2025-09-01', fin: '2029-08-31', marche: 'Public', activites: ['P1', 'P2'], base: { P1: 19000, P2: 5400 }, echeancier: 'Mensuel', tacite: false,
        sites: [{ nom: 'École élémentaire Jules-Exemple', adresse: '9 rue des Écoles', compteur: 'GAZ', prestations: [{ act: 'P1', montant: 19000, periodicite: 'Mensuel', terme: 'Terme échu' }, { act: 'P2', montant: 5400 }] }] },
    { client: 6, libelle: 'Chaufferie Voltaire', debut: '2024-10-01', fin: '2028-09-30', marche: 'Privé', activites: ['P2', 'P3'], base: { P2: 7300, P3: 2900 }, echeancier: 'Trimestriel', tacite: true,
        sites: [{ nom: 'Square Voltaire - Chaufferie', adresse: '140 boulevard Voltaire', compteur: 'GAZ', ecs: true, prestations: [{ act: 'P2', montant: 7300 }, { act: 'P3', montant: 2900 }] }] },
    { client: 7, libelle: 'Maintenance CVC bureaux', debut: '2025-04-01', fin: '2028-03-31', marche: 'Privé', activites: ['P2'], base: { P2: 21600 }, echeancier: 'Mensuel', tacite: true,
        sites: [{ nom: 'Quai Est - Bâtiment principal', adresse: '30 quai de l\'Exemple', compteur: 'CALO', prestations: [{ act: 'P2', montant: 21600, periodicite: 'Mensuel' }] }] },
    { client: 8, libelle: 'Chaufferie gaz', debut: '2021-10-01', fin: '2026-09-30', statut: 'Terminé', marche: 'Privé', activites: ['P2'], base: { P2: 5100 }, echeancier: 'Trimestriel', tacite: false,
        sites: [{ nom: 'Hauts de Bercy - Chaufferie', adresse: '7 rue de Bercy-Démo', compteur: 'GAZ', prestations: [{ act: 'P2', montant: 5100 }] }] },
    { client: 9, libelle: 'Production eau chaude', debut: '2025-01-01', fin: '2029-12-31', marche: 'Privé', activites: ['P2', 'P3'], base: { P2: 9800, P3: 4100 }, echeancier: 'Trimestriel', tacite: true,
        sites: [{ nom: 'Clinique du Parc - Local technique', adresse: '3 rue de la Santé-Démo', compteur: 'GAZ', ecs: true, prestations: [{ act: 'P2', montant: 9800 }, { act: 'P3', montant: 4100 }] }] },
    // Contrats de la base marché à valider (rendus « en attente » après l'import).
    { client: 10, libelle: 'Chaufferie Clos Fleuri', debut: '2026-10-01', fin: '2031-09-30', marche: 'Privé', activites: ['P2', 'P3'], base: { P2: 6900, P3: 2600 }, echeancier: 'Trimestriel', tacite: true,
        sites: [{ nom: 'Clos Fleuri - Chaufferie', adresse: '21 chemin Fleuri', compteur: 'GAZ', prestations: [{ act: 'P2', montant: 6900 }, { act: 'P3', montant: 2600 }] }] },
    { client: 1, libelle: 'Extension parking chauffé', debut: '2026-11-01', fin: '2030-12-31', marche: 'Privé', activites: ['P2'], base: { P2: 2400 }, echeancier: 'Annuel', tacite: false,
        sites: [{ nom: 'Parc des Cèdres - Parking', adresse: '20 avenue des Cèdres', prestations: [{ act: 'P2', montant: 2400 }] }] },
    { client: 6, libelle: 'Avenant de périmètre ECS', debut: '2026-09-01', fin: '2028-09-30', marche: 'Privé', activites: ['P2'], base: { P2: 1800 }, echeancier: 'Trimestriel', tacite: false,
        sites: [{ nom: 'Square Voltaire - ECS', adresse: '142 boulevard Voltaire', prestations: [{ act: 'P2', montant: 1800 }] }] },
];
const A_VALIDER = { avecPdf: 10, sansPdf: 11, refuse: 12 };

async function contratsEtPatrimoine(codesClients: string[]) {
    const rc = await importer('contracts', [
        ['Client', 'Libellé', 'Société émettrice', 'Date de début', 'Date de fin', 'Statut', 'Type de marché', 'Activités', 'Montant base P1', 'Montant base P2', 'Montant base P3',
            'Échéancier de facturation', 'Facturation', 'Reconduction', 'Tacite reconduction', 'Durée de reconduction', 'Préavis', 'Signé par la société', 'Signé par le client'],
        ...CONTRATS.map(k => [codesClients[k.client], k.libelle, 'ZEN', k.debut, k.fin, k.statut ?? 'Actif', k.marche, k.activites.join(', '), k.base.P1 ?? '', k.base.P2 ?? '', k.base.P3 ?? '',
            k.echeancier, k.facturation ?? 'Multi-site', k.tacite ? 'Oui' : 'Non', k.tacite ? 'Oui' : 'Non', k.tacite ? '1 an' : '', '3 mois', 'Oui', 'Oui']),
    ]);
    const contrats = CONTRATS.map((_, i) => parLigne(rc).get(i + 2)!);

    const sites = CONTRATS.flatMap((k, i) => k.sites.map(s => ({ ...s, k, contrat: contrats[i] })));
    const rs = await importer('sites', [
        ['Client', 'Contrat', 'Nom du site', 'Adresse', 'Code postal', 'Ville'],
        ...sites.map(s => [codesClients[s.k.client], s.contrat.code, s.nom, s.adresse, CLIENTS[s.k.client].cp, CLIENTS[s.k.client].ville]),
    ]);
    const codesSites = sites.map((_, i) => parLigne(rs).get(i + 2)!.code!);

    const compteurs = sites.flatMap((s, i) => [
        ...(s.compteur ? [{ site: codesSites[i], nom: s.compteur === 'GAZ' ? 'Gaz chaufferie' : 'Calories sous-station', type: s.compteur, base: 100000 + i * 37000, pas: s.compteur === 'GAZ' ? 18000 + i * 900 : 40 + i * 3 }] : []),
        ...(s.ecs ? [{ site: codesSites[i], nom: 'Eau chaude sanitaire', type: 'EAU', base: 1200 + i * 150, pas: 60 + i * 4 }] : []),
    ]);
    const rm = await importer('meters', [
        ['Site', 'Nom', 'Type de compteur', 'PDL / PCE', 'Emplacement', 'Statut'],
        ...compteurs.map((m, i) => [m.site, m.nom, m.type, m.type === 'GAZ' ? `GI${String(990000000 + i * 7919).padStart(12, '0')}` : '', m.type === 'EAU' ? 'Local ECS' : 'Chaufferie', 'En service']),
    ]);
    const codesCompteurs = compteurs.map((_, i) => parLigne(rm).get(i + 2)!.code!);

    // Relevés mensuels sur 12 mois (consommation plus forte l'hiver) ; le dernier mois manque sur deux compteurs (alertes).
    const mois = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(2025, 10 + i, 1)); return d.toISOString().slice(0, 10); });
    const hiver = [1.6, 1.8, 1.7, 1.4, 1.0, 0.6, 0.4, 0.3, 0.3, 0.5, 0.9, 1.3];
    await importer('readings', [
        ['Compteur', 'Date du relevé', 'Index', 'Type de relevé', 'Commentaire'],
        ...compteurs.flatMap((m, i) => {
            let index = m.base;
            return mois.filter((_, j) => !(j === 11 && i % 6 === 2)).map((jour, j) => {
                index += Math.round(m.pas * hiver[j]);
                return [codesCompteurs[i], jour, index, j === 7 && i % 4 === 0 ? 'Estimé' : 'Réel', j === 7 && i % 4 === 0 ? 'Accès chaufferie impossible (congés)' : ''];
            });
        }),
    ]);

    // Prestations : une par site et activité, depuis le début du contrat.
    const lignes = sites.flatMap((s, i) => s.prestations.map(p => [codesSites[i], p.act, s.k.debut, '', p.montant, p.periodicite ?? s.k.echeancier, p.terme ?? 'À échoir',
        p.act === 'P1' ? (s.compteur === 'GAZ' ? codesCompteurs[compteurs.findIndex(m => m.site === codesSites[i] && m.type === 'GAZ')] ?? '' : '') : '']));
    await importer('services', [['Site', 'Activité', 'Date de début', 'Date de fin', 'Montant annuel HT', 'Périodicité', 'Terme', 'Compteur'], ...lignes.map(l => [l[0], l[1], l[2], l[3], l[4], l[5], l[6], l[7]])]);
    return { contrats, codesSites };
}

// --- Responsables facturation, contrats à valider, documents de contrat ---

async function documents(contrats: { id: string; code?: string }[]) {
    // Portefeuilles ADV.
    for (const [i, k] of contrats.entries()) await adminDb.collection('contracts').doc(k.id).update({ billingManagerId: i % 3 === 2 ? 'demo-u-adv2' : 'demo-u-adv' });

    // Base marché : trois contrats en attente (avec PDF, sans PDF, refusé puis à corriger).
    const kp = contrats[A_VALIDER.avecPdf], ks = contrats[A_VALIDER.sansPdf], kr = contrats[A_VALIDER.refuse];
    const def = CONTRATS[A_VALIDER.avecPdf];
    const pieceBase = await piece(`contracts/${kp.id}/base-marche/contrat-signe-${kp.code}.pdf`, `Contrat d'exploitation ${kp.code}`, [
        `Client : ${CLIENTS[def.client].nom}`, `Objet : ${def.libelle}`, `Duree : du 01/10/2026 au 30/09/2031`,
        'Base marche P2 : 6 900,00 EUR HT/an', 'Base marche P3 : 2 600,00 EUR HT/an', 'Tacite reconduction : oui, par periode de 1 an', 'Preavis : 3 mois',
    ]);
    await adminDb.collection('contracts').doc(kp.id).update({ status: 'Brouillon', validationStatus: 'pending_validation', requesterEmail: 'adv@example.com', createdAt: instant('2026-11-04'), documents: [{ name: pieceBase.documentName, type: 'Contrat signé', url: pieceBase.documentUrl }] });
    await adminDb.collection('contracts').doc(ks.id).update({ status: 'Brouillon', validationStatus: 'pending_validation', requesterEmail: 'adv2@example.com', createdAt: instant('2026-11-06') });
    await adminDb.collection('contracts').doc(kr.id).update({ status: 'Brouillon', validationStatus: 'refused', refusalReason: 'Date de début erronée : le contrat signé indique le 01/10/2026.', requesterEmail: 'adv@example.com', createdAt: instant('2026-10-20'), validatedBy: 'contratheque@example.com', validatedAt: instant('2026-10-22') });

    const k = (i: number) => contrats[i];
    const evt = async (coll: string, id: string, contrat: number, titre: string, lignes: string[], data: Record<string, unknown>, etat: 'pending' | 'validated' | 'refused', le: string, motif?: string) => {
        const dossier = { amendments: data.nature === 'os' ? 'ordres-de-service' : 'avenants', renewals: 'reconductions', terminations: 'resiliations', trusteeChanges: 'syndic', beChanges: 'be' }[coll]!;
        const p = await piece(`contracts/${k(contrat).id}/${dossier}/${id}.pdf`, titre, lignes);
        await set(coll, id, {
            contractId: k(contrat).id, contractNumber: k(contrat).code, createdAt: instant(le), createdBy: COMPTES[contrat % 2].email, ...data, ...p,
            validationStatus: etat === 'pending' ? 'pending_validation' : etat,
            ...(etat !== 'pending' && { validatedBy: 'contratheque@example.com', validatedAt: instant(le, 15) }),
            ...(etat === 'refused' && { refusalReason: motif }),
        });
    };

    // En attente de validation : un document de chaque type.
    await evt('amendments', 'demo-av-1', 0, 'Avenant n 2 au contrat', ['Objet : ajout du local velos chauffe au perimetre P2', "Date d'effet : 01/12/2026", 'Impact P2 : +450,00 EUR HT/an', 'Duree : inchangee'],
        { nature: 'avenant', description: 'Avenant n°2 : ajout du local vélos chauffé au périmètre P2', effectiveDate: '2026-12-01', signed: true, impactsDuration: false, impactsServices: true, impactP2: 450 }, 'pending', '2026-11-05');
    // Erreur de saisie volontaire (fin saisie 30/06/2029, le PDF dit 30/06/2030) : à corriger au contrôle.
    await evt('amendments', 'demo-av-2', 2, 'Avenant n 1 au contrat', ['Objet : prolongation suite renovation de la chaufferie', "Date d'effet : 01/10/2026", 'Nouvelle fin du contrat : 30/06/2030', 'Impact P1 : -1 200,00 EUR HT/an'],
        { nature: 'avenant', description: 'Avenant n°1 : prolongation après rénovation de la chaufferie', effectiveDate: '2026-10-01', signed: true, impactsDuration: true, newEndDate: '2029-06-30', impactsServices: false, impactP1: -1200 }, 'pending', '2026-11-03');
    await evt('amendments', 'demo-os-1', 4, 'Ordre de service n 7', ['Objet : remplacement du circulateur du gymnase', "Date d'effet : 15/11/2026", 'Montant : 3 850,00 EUR HT (hors forfait)'],
        { nature: 'os', description: 'OS n°7 : remplacement du circulateur du gymnase', effectiveDate: '2026-11-15', signed: true, impactsDuration: false, impactsServices: false }, 'pending', '2026-11-07');
    await evt('renewals', 'demo-re-1', 6, 'Reconduction du contrat', ['Reconduction tacite pour 1 an', 'Nouvelle fin du contrat : 30/09/2029'], { duration: '1 an', newEndDate: '2029-09-30' }, 'pending', '2026-11-02');
    await evt('terminations', 'demo-te-1', 9, 'Lettre de resiliation', ["Motif : regroupement de l'exploitation avec un autre site du groupe", "Date d'effet : 31/12/2027", 'Preavis de 3 mois respecte'],
        { reason: "Regroupement de l'exploitation avec un autre site du groupe", effectiveDate: '2027-12-31' }, 'pending', '2026-11-06');
    await evt('trusteeChanges', 'demo-sy-1', 2, 'Changement de syndic', ['Ancien syndic : Cabinet Exemple Gestion', 'Nouveau syndic : Syndic Démo Immobilier', "Date d'effet : 01/01/2027", 'Contact : gestion@example.com'],
        { currentRepresentative: 'Cabinet Exemple Gestion', newRepresentative: 'Syndic Démo Immobilier', contactEmail: 'gestion@example.com', effectiveDate: '2027-01-01' }, 'pending', '2026-11-08');
    await evt('beChanges', 'demo-be-1', 7, "Designation du bureau d'etudes", ["Bureau d'etudes : BE Fluides Exemple", 'Contact : be-fluides@example.com', "Date d'effet : 01/12/2026"],
        { currentBe: '', newBe: 'BE Fluides Exemple', contactEmail: 'be-fluides@example.com', effectiveDate: '2026-12-01' }, 'pending', '2026-11-08');

    // Historique : documents déjà validés ou refusés.
    await evt('amendments', 'demo-av-0', 0, 'Avenant n 1 au contrat', ['Objet : revision du perimetre P3', "Date d'effet : 01/01/2025"],
        { nature: 'avenant', description: 'Avenant n°1 : révision du périmètre P3', effectiveDate: '2025-01-01', signed: true, impactsDuration: false, impactsServices: true, impactP3: 300 }, 'validated', '2024-12-10');
    await evt('renewals', 'demo-re-0', 2, 'Reconduction du contrat', ['Reconduction pour 1 an', 'Nouvelle fin : 30/09/2027'], { duration: '1 an', newEndDate: '2027-09-30' }, 'validated', '2026-06-15');
    await evt('amendments', 'demo-os-0', 5, 'Ordre de service n 2', ['Objet : desembouage du reseau', "Date d'effet : 01/10/2026"],
        { nature: 'os', description: 'OS n°2 : désembouage du réseau', effectiveDate: '2026-10-01', signed: false, impactsDuration: false, impactsServices: false }, 'refused', '2026-10-12', 'OS non signé par le client : joindre la version signée.');
    await adminDb.collection('contracts').doc(k(2).id).update({ endDate: paris('2027-09-30') });
    console.log('Documents de contrat créés (7 en attente, 3 contrats de base marché à valider).');
}

// --- Factures (moteur de facturation de l'application) ---

async function factures(contrats: { id: string }[]) {
    const factures: { id: string; date: string }[] = [];
    for (const date of ['2026-04-05', '2026-07-05', '2026-10-05']) {
        for (const [i, k] of contrats.entries()) {
            if (Object.values(A_VALIDER).includes(i) || CONTRATS[i].statut) continue;
            try {
                const p = await prepareContractInvoice(k.id, date, { isProforma: false });
                const f = await createInvoice(p.invoice, p.company, { contractId: k.id, billingVersion: p.billingVersion });
                factures.push({ id: f.id, date });
            } catch (e) {
                if (!/Rien à facturer/.test(String((e as Error).message))) console.warn(`  facture ${CONTRATS[i].libelle} au ${date} : ${(e as Error).message}`);
            }
        }
    }
    // Encaissements : anciennes factures payées, une partie en retard.
    for (const [i, f] of factures.entries()) {
        const status = f.date < '2026-10-01' ? (i % 7 === 3 ? 'overdue' : 'paid') : (i % 4 === 1 ? 'paid' : 'due');
        await adminDb.collection('invoices').doc(f.id).update({ status });
    }
    console.log(`Factures émises : ${factures.length}.`);
}

(async () => {
    console.log(`Données simulées — projet ${PROJET}, au ${AUJOURDHUI}.`);
    await remiseAZero();
    await referentiels();
    await comptes();
    const codesClients = await clientsEtContacts();
    const { contrats } = await contratsEtPatrimoine(codesClients);
    await documents(contrats);
    await factures(contrats);
    console.log('Jeu de données prêt.');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
