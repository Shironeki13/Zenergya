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
import { INDICES, STATIONS, djuJournaliers, djuMensuels, valeursIndice, type CodeStation } from './meteo-indices';
import { setSaisonChauffe } from '../../src/services/p1-admin';
import { saisonDe } from '../../src/lib/p1/saisons';
import { acceptQuote } from '../../src/services/quotes-admin';
import { invoiceQuote } from '../../src/services/quote-billing';
import { createProjectFromQuote, invoiceSituation, saveSituationDraft } from '../../src/services/projects-admin';
import { computeQuoteTotals } from '../../src/lib/quotes/pricing';
import type { Quote, QuoteLine, QuotePricing } from '../../src/lib/quotes/types';
import { ajouterFactureFournisseur, avancerCommande, deciderCommande, saveCommande, saveFournisseur, soumettreCommande, type CommandeInput } from '../../src/services/commandes-admin';
import type { SessionUser } from '../../src/lib/auth/server';

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
    for (const [id, name, code] of [['demo-ag-lyon', 'Lyon', 'LYO'], ['demo-ag-paris', 'Paris Est', 'PAE']]) await set('agencies', id, { name, code, companyId: 'demo-zen', companyName: 'Zenergya Services (démo)' });
    for (const [id, name, agencyId, code] of [['demo-se-ln', 'Lyon Nord', 'demo-ag-lyon', 'LN'], ['demo-se-ls', 'Lyon Sud', 'demo-ag-lyon', 'LS'], ['demo-se-p', 'Paris 11e-12e', 'demo-ag-paris', 'P11'], ]) {
        await set('sectors', id, { name, agencyId, code });
    }
    for (const [id, name, regime] of [['demo-ty-copro', 'Copropriété', 'b2b'], ['demo-ty-bailleur', 'Bailleur social', 'b2b'], ['demo-ty-public', 'Collectivité', 'b2g'], ['demo-ty-tertiaire', 'Tertiaire', 'b2b']]) {
        await set('typologies', id, { name, einvoicingRegime: regime });
    }
    for (const [id, code, rate] of [['demo-tva20', 'TVA20', 20], ['demo-tva10', 'TVA10', 10], ['demo-tva55', 'TVA5,5', 5.5]] as const) await set('vatRates', id, { code, rate });
    for (const [id, code, label, type, vat] of [
        ['demo-p1', 'P1', 'Fourniture de chaleur', 'P1', 'demo-tva55'], ['demo-p1e', 'P1E', 'Fourniture d\'eau chaude sanitaire', 'P1', 'demo-tva10'], ['demo-p2', 'P2', 'Conduite et petit entretien', 'P2', 'demo-tva20'],
        ['demo-p3', 'P3', 'Garantie totale (gros entretien)', 'P3', 'demo-tva20'],
    ]) await set('activities', id, { code, label, type, vatRateId: vat });
    for (const [id, name] of [['demo-mens', 'Mensuel'], ['demo-trim', 'Trimestriel'], ['demo-ann', 'Annuel']]) await set('schedules', id, { name });
    for (const [id, name] of [['demo-echoir', 'À échoir'], ['demo-echu', 'Terme échu']]) await set('terms', id, { name });
    await set('paymentTerms', 'demo-30j', { code: '30J', deadline: '30 jours', days: 30, endOfMonth: false });
    await set('paymentTerms', 'demo-45fdm', { code: '45FDM', deadline: '45 jours fin de mois', days: 45, endOfMonth: true });
    for (const [id, code, label, unit] of [['demo-mt-gaz', 'GAZ', 'Gaz naturel', 'm³'], ['demo-mt-calo', 'CALO', 'Compteur de calories', 'MWh'], ['demo-mt-eau', 'EAU', 'Eau chaude sanitaire', 'm³'], ['demo-mt-elec', 'ELEC', 'Électricité', 'kWh']]) {
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
    // Achats : le technicien commande ; son responsable (N+1) puis le directeur d'agence (N+2) valident ; les achats au-delà de leur seuil.
    { id: 'demo-u-dir', email: 'directeur@example.com', name: 'Paul Garnier (directeur d\'agence)', firstName: 'Paul', roleId: 'demo-r-expl' },
    { id: 'demo-u-resp', email: 'responsable@example.com', name: 'Nadia Roche (responsable d\'exploitation)', firstName: 'Nadia', roleId: 'demo-r-expl', managerId: 'demo-u-dir' },
    { id: 'demo-u-tech', email: 'technicien@example.com', name: 'Lucas Morel (technicien)', firstName: 'Lucas', roleId: 'demo-r-expl', managerId: 'demo-u-resp' },
    { id: 'demo-u-achats', email: 'achats@example.com', name: 'Élise Faure (achats)', firstName: 'Élise', roleId: 'demo-r-achats' },
] as { id: string; email: string; name: string; firstName: string; roleId: string; managerId?: string }[];

async function comptes() {
    await set('roles', 'demo-r-adv', { name: 'ADV', isAdmin: false });
    await set('roles', 'demo-r-ctq', { name: 'Contrathèque', isAdmin: false, isContratheque: true });
    await set('roles', 'demo-r-admin', { name: 'Administrateur', isAdmin: true });
    await set('roles', 'demo-r-expl', { name: 'Exploitation', isAdmin: false });
    await set('roles', 'demo-r-achats', { name: 'Achats', isAdmin: false, isAcheteur: true });
    for (const c of COMPTES) {
        const u = await adminAuth.createUser({ email: c.email, password: MOT_DE_PASSE, displayName: c.name });
        await set('users', c.id, {
            name: c.name, firstName: c.firstName, email: c.email, roleId: c.roleId, authUid: u.uid, ...(c.managerId && { managerId: c.managerId }),
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

// --- Contrats, sites, compteurs, relevés, prestations, paramétrage P1 ---

type Prestation = {
    act: 'P1' | 'P1E' | 'P2' | 'P3'; montant: number; periodicite?: string; terme?: string;
    /** P1 : chauffage ou ECS, au compteur, en acomptes ou au forfait. */
    p1?: { type: 'CHAUFFAGE' | 'ECS'; mode: 'releve' | 'acompte' | 'dju'; compteur?: 'gaz' | 'ecs'; coef?: 'aucun' | 'prestation' | 'contrat'; coefValeur?: number; prorata?: 'releve_jours' | 'releve_dju' | 'jours' | 'dju'; puInteressement?: number };
};
type DefSite = {
    nom: string; adresse: string; compteur?: 'GAZ' | 'CALO'; ecs?: boolean; prestations: Prestation[];
    /** Profil de consommation : besoin de chauffage (MWh pour DJU de référence) et performance (< 1 : économie). */
    besoin?: number; performance?: number;
    /** Paramétrage P1 du site (marché, prix, station, poste de consommation). */
    p1?: { marche: 'MC' | 'MCI' | 'MT' | 'MTI'; prixBase: number; prixBaseEcs?: number; station: CodeStation; quantiteAcompte?: number; nc: 'gaz' | 'gaz-ecs'; nb: number; djuRef: number };
};
type DefContrat = {
    client: number; libelle: string; debut: string; fin: string; statut?: 'Actif' | 'Résilié' | 'Terminé'; marche: 'Privé' | 'Public';
    activites: string[]; base: { P1?: number; P2?: number; P3?: number }; echeancier: string; tacite: boolean; facturation?: 'Multi-site' | 'Globale';
    station: CodeStation; sites: DefSite[];
    /** Paramétrage P1 du contrat. */
    p1?: { coefGestion?: number; repartition?: string; bareme?: [string, string]; ecs?: boolean; regularisation?: 'reel_moteur' | 'decompte_dju' };
    /** Saisons de chauffe des sites P1 au DJU ou en décompte : allumage, arrêt. */
    saisons?: [string, string | null][];
};
const SAISON = '12,5;12,5;12,5;12,5;10;5;0;0;0;10;12,5;12,5';   // répartition des acomptes : janvier → décembre
const SEPTIEME = [1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1].map(x => (x ? '14,2857142857' : '0')).join(';');   // 1/7 d'octobre à avril
const SAISONS: [string, string | null][] = [['2023-10-16', '2024-05-12'], ['2024-10-14', '2025-05-09'], ['2025-10-13', '2026-05-27'], ['2026-10-15', null]];
const CONTRATS: DefContrat[] = [
    { client: 0, libelle: 'Chaufferie collective', debut: '2024-07-01', fin: '2029-06-30', marche: 'Privé', activites: ['P1', 'P1E', 'P2', 'P3'], base: { P1: 70000, P2: 6200, P3: 2400 }, echeancier: 'Trimestriel', tacite: true, station: 'DEMO-LYON',
        p1: { coefGestion: 1.03, bareme: ['MTI', 'économie 0-10 % 50 % ; économie 10-100 % 70 % ; dépassement 0-100 % 40 %'], ecs: true },
        sites: [
            // Chauffage au compteur TRIMESTRIEL : formule de NC gaz − ECS, coefficient de gestion du contrat. ECS au compteur MENSUELLE, coefficient propre.
            { nom: 'Tilleuls - Bâtiment A', adresse: '4 allée des Tilleuls', compteur: 'GAZ', ecs: true, besoin: 900, performance: 1.0,
                p1: { marche: 'MTI', prixBase: 72, prixBaseEcs: 6.4, station: 'DEMO-LYON', nc: 'gaz-ecs', nb: 900, djuRef: 2350 },
                prestations: [{ act: 'P1', montant: 0, periodicite: 'Trimestriel', terme: 'Terme échu', p1: { type: 'CHAUFFAGE', mode: 'releve', coef: 'contrat' } },
                    { act: 'P1E', montant: 0, periodicite: 'Mensuel', terme: 'Terme échu', p1: { type: 'ECS', mode: 'releve', compteur: 'ecs', coef: 'prestation', coefValeur: 1.05 } },
                    { act: 'P2', montant: 3600 }, { act: 'P3', montant: 1400 }] },
            // Chauffage au compteur MENSUEL sur son compteur gaz, sans coefficient ; intéressement MTI (économie).
            { nom: 'Tilleuls - Bâtiment B', adresse: '6 allée des Tilleuls', compteur: 'GAZ', besoin: 700, performance: 0.93,
                p1: { marche: 'MTI', prixBase: 72, station: 'DEMO-LYON', nc: 'gaz', nb: 700, djuRef: 2350 },
                prestations: [{ act: 'P1', montant: 0, periodicite: 'Mensuel', terme: 'Terme échu', p1: { type: 'CHAUFFAGE', mode: 'releve', compteur: 'gaz', coef: 'aucun', puInteressement: 72 } },
                    { act: 'P2', montant: 2600 }, { act: 'P3', montant: 1000 }] }] },
    { client: 1, libelle: 'Sous-station réseau de chaleur', debut: '2025-01-01', fin: '2030-12-31', marche: 'Privé', activites: ['P2', 'P3'], base: { P2: 8400, P3: 3100 }, echeancier: 'Trimestriel', tacite: false, station: 'DEMO-LYON',
        sites: [{ nom: 'Parc des Cèdres - Sous-station', adresse: '18 avenue des Cèdres', compteur: 'CALO', prestations: [{ act: 'P2', montant: 8400 }, { act: 'P3', montant: 3100 }] }] },
    // Acomptes chauffage (régularisés sur le réel P1 du moteur) + intéressement MCI (dépassement) ; ECS au compteur.
    { client: 2, libelle: 'Exploitation chauffage et ECS', debut: '2023-10-01', fin: '2027-09-30', marche: 'Privé', activites: ['P1', 'P1E', 'P2'], base: { P1: 80000, P2: 4800 }, echeancier: 'Trimestriel', tacite: true, station: 'DEMO-LYON',
        p1: { repartition: SAISON, bareme: ['MCI', 'économie 0-100 % 50 % ; dépassement 0-5 % 0 % ; dépassement 5-100 % 30 %'], ecs: true },
        sites: [{ nom: 'Belvédère - Chaufferie', adresse: '2 montée du Belvédère', compteur: 'GAZ', ecs: true, besoin: 1050, performance: 1.08,
            p1: { marche: 'MCI', prixBase: 74, prixBaseEcs: 6.2, station: 'DEMO-LYON', quantiteAcompte: 1100, nc: 'gaz', nb: 1050, djuRef: 2350 },
            prestations: [{ act: 'P1', montant: 0, periodicite: 'Mensuel', terme: 'À échoir', p1: { type: 'CHAUFFAGE', mode: 'acompte', compteur: 'gaz', puInteressement: 74 } },
                { act: 'P1E', montant: 0, periodicite: 'Mensuel', terme: 'Terme échu', p1: { type: 'ECS', mode: 'releve', compteur: 'ecs', coef: 'aucun' } },
                { act: 'P2', montant: 4800 }] }] },
    { client: 3, libelle: 'Patrimoine Lyon 7e - lot 1', debut: '2025-07-01', fin: '2031-06-30', marche: 'Privé', activites: ['P2', 'P3'], base: { P2: 15600, P3: 7200 }, echeancier: 'Trimestriel', tacite: false, facturation: 'Globale', station: 'DEMO-LYON',
        sites: [{ nom: 'Résidence Gerland', adresse: '55 rue du Logement', compteur: 'GAZ', prestations: [{ act: 'P2', montant: 5200 }, { act: 'P3', montant: 2400 }] },
            { nom: 'Résidence Jean-Macé', adresse: '61 rue du Logement', compteur: 'GAZ', prestations: [{ act: 'P2', montant: 5200 }, { act: 'P3', montant: 2400 }] },
            { nom: 'Résidence Guillotière', adresse: '70 rue du Logement', compteur: 'GAZ', prestations: [{ act: 'P2', montant: 5200 }, { act: 'P3', montant: 2400 }] }] },
    // MTI au DJU, mensuel, sans décompte (modèle d'un contrat de ville) : P1 annuel de base × C/C0 × DJU chauffés / DJU contractuels.
    { client: 4, libelle: 'Bâtiments communaux', debut: '2024-01-01', fin: '2027-12-31', marche: 'Public', activites: ['P1', 'P2'], base: { P1: 24000, P2: 12800 }, echeancier: 'Trimestriel', tacite: false, station: 'DEMO-LYON',
        p1: {}, saisons: SAISONS,
        sites: [{ nom: 'Mairie de Saint-Exemple', adresse: '1 place de la Mairie', compteur: 'GAZ', besoin: 260, performance: 1.0,
                p1: { marche: 'MTI', prixBase: 38.6, station: 'DEMO-LYON', nc: 'gaz', nb: 260, djuRef: 2308 },
                prestations: [{ act: 'P1', montant: 10036.4, periodicite: 'Mensuel', terme: 'Terme échu', p1: { type: 'CHAUFFAGE', mode: 'dju' } }, { act: 'P2', montant: 4800 }] },
            { nom: 'Gymnase municipal', adresse: '5 rue du Stade', compteur: 'GAZ', besoin: 360, performance: 1.0,
                p1: { marche: 'MTI', prixBase: 38.6, station: 'DEMO-LYON', nc: 'gaz', nb: 360, djuRef: 2308 },
                prestations: [{ act: 'P1', montant: 13896, periodicite: 'Mensuel', terme: 'Terme échu', p1: { type: 'CHAUFFAGE', mode: 'dju' } }, { act: 'P2', montant: 5000 }] },
            { nom: 'Médiathèque', adresse: '8 rue des Arts', prestations: [{ act: 'P2', montant: 3000 }] }] },
    // Début en cours de mois (15/09/2025) : septembre au prorata des DJU (pas de relevé à la date) ; coefficient de gestion propre.
    { client: 5, libelle: 'Groupe scolaire - chauffage', debut: '2025-09-15', fin: '2029-08-31', marche: 'Public', activites: ['P1', 'P2'], base: { P1: 30000, P2: 5400 }, echeancier: 'Mensuel', tacite: false, station: 'DEMO-PARIS',
        p1: {},
        sites: [{ nom: 'École élémentaire Jules-Exemple', adresse: '9 rue des Écoles', compteur: 'GAZ', besoin: 420, performance: 1.0,
            p1: { marche: 'MT', prixBase: 80, station: 'DEMO-PARIS', nc: 'gaz', nb: 420, djuRef: 2250 },
            prestations: [{ act: 'P1', montant: 0, periodicite: 'Mensuel', terme: 'Terme échu', p1: { type: 'CHAUFFAGE', mode: 'releve', compteur: 'gaz', coef: 'prestation', coefValeur: 1.04, prorata: 'releve_dju' } },
                { act: 'P2', montant: 5400 }] }] },
    // MTI avec décompte (modèle d'une copropriété) : acomptes 1/7 d'octobre à avril, décompte en fin de saison, intéressement
    // avec franchise de ±4 % ; ECS au compteur, trimestrielle.
    { client: 6, libelle: 'Chaufferie Voltaire', debut: '2024-10-01', fin: '2028-09-30', marche: 'Privé', activites: ['P1', 'P1E', 'P2', 'P3'], base: { P1: 52000, P2: 7300, P3: 2900 }, echeancier: 'Trimestriel', tacite: true, station: 'DEMO-PARIS',
        p1: { repartition: SEPTIEME, regularisation: 'decompte_dju', bareme: ['MTI', 'économie 0-4 % 0 % ; économie 4-100 % 50 % ; dépassement 0-4 % 0 % ; dépassement 4-100 % 100 %'], ecs: true },
        saisons: SAISONS,
        sites: [{ nom: 'Square Voltaire - Chaufferie', adresse: '140 boulevard Voltaire', compteur: 'GAZ', ecs: true, besoin: 640, performance: 0.97,
            p1: { marche: 'MTI', prixBase: 81.6, prixBaseEcs: 10.5, station: 'DEMO-PARIS', quantiteAcompte: 640, nc: 'gaz-ecs', nb: 640, djuRef: 2250 },
            prestations: [{ act: 'P1', montant: 0, periodicite: 'Mensuel', terme: 'À échoir', p1: { type: 'CHAUFFAGE', mode: 'acompte', compteur: 'gaz', puInteressement: 81.6 } },
                { act: 'P1E', montant: 0, periodicite: 'Trimestriel', terme: 'Terme échu', p1: { type: 'ECS', mode: 'releve', compteur: 'ecs', coef: 'aucun' } },
                { act: 'P2', montant: 7300 }, { act: 'P3', montant: 2900 }] }] },
    { client: 7, libelle: 'Maintenance CVC bureaux', debut: '2025-04-01', fin: '2028-03-31', marche: 'Privé', activites: ['P2'], base: { P2: 21600 }, echeancier: 'Mensuel', tacite: true, station: 'DEMO-PARIS',
        sites: [{ nom: 'Quai Est - Bâtiment principal', adresse: '30 quai de l\'Exemple', compteur: 'CALO', prestations: [{ act: 'P2', montant: 21600, periodicite: 'Mensuel' }] }] },
    { client: 8, libelle: 'Chaufferie gaz', debut: '2021-10-01', fin: '2026-09-30', statut: 'Terminé', marche: 'Privé', activites: ['P2'], base: { P2: 5100 }, echeancier: 'Trimestriel', tacite: false, station: 'DEMO-PARIS',
        sites: [{ nom: 'Hauts de Bercy - Chaufferie', adresse: '7 rue de Bercy-Démo', compteur: 'GAZ', prestations: [{ act: 'P2', montant: 5100 }] }] },
    { client: 9, libelle: 'Production eau chaude', debut: '2025-01-01', fin: '2029-12-31', marche: 'Privé', activites: ['P2', 'P3'], base: { P2: 9800, P3: 4100 }, echeancier: 'Trimestriel', tacite: true, station: 'DEMO-LYON',
        sites: [{ nom: 'Clinique du Parc - Local technique', adresse: '3 rue de la Santé-Démo', compteur: 'GAZ', ecs: true, prestations: [{ act: 'P2', montant: 9800 }, { act: 'P3', montant: 4100 }] }] },
    // Contrats de la base marché à valider (rendus « en attente » après l'import).
    { client: 10, libelle: 'Chaufferie Clos Fleuri', debut: '2026-10-01', fin: '2031-09-30', marche: 'Privé', activites: ['P2', 'P3'], base: { P2: 6900, P3: 2600 }, echeancier: 'Trimestriel', tacite: true, station: 'DEMO-LYON',
        sites: [{ nom: 'Clos Fleuri - Chaufferie', adresse: '21 chemin Fleuri', compteur: 'GAZ', prestations: [{ act: 'P2', montant: 6900 }, { act: 'P3', montant: 2600 }] }] },
    { client: 1, libelle: 'Extension parking chauffé', debut: '2026-11-01', fin: '2030-12-31', marche: 'Privé', activites: ['P2'], base: { P2: 2400 }, echeancier: 'Annuel', tacite: false, station: 'DEMO-LYON',
        sites: [{ nom: 'Parc des Cèdres - Parking', adresse: '20 avenue des Cèdres', prestations: [{ act: 'P2', montant: 2400 }] }] },
    { client: 6, libelle: 'Avenant de périmètre ECS', debut: '2026-09-01', fin: '2028-09-30', marche: 'Privé', activites: ['P2'], base: { P2: 1800 }, echeancier: 'Trimestriel', tacite: false, station: 'DEMO-PARIS',
        sites: [{ nom: 'Square Voltaire - ECS', adresse: '142 boulevard Voltaire', prestations: [{ act: 'P2', montant: 1800 }] }] },
];
const A_VALIDER = { avecPdf: 10, sansPdf: 11, refuse: 12 };

const QE_GAZ = 0.0105;        // MWh PCS par m³ de gaz
const QE_ECS = 0.058;         // MWh par m³ d'eau chaude (énergie de l'ECS, déduite du gaz dans la formule de NC)
const DEBUT_RELEVES = '2023-09-30';
const FIN_RELEVES = '2026-10-31';

/** Météo et indices : stations, DJU journaliers, indices mensuels de révision. */
async function meteoEtIndices(): Promise<Record<CodeStation, Map<string, number>>> {
    const mensuels = {} as Record<CodeStation, Map<string, number>>;
    for (const s of STATIONS) {
        await set('weatherStations', `demo-${s.code}`, { code: s.code, name: s.name, isActive: true });
        const jours = djuJournaliers(s.code, '2023-07-01', FIN_RELEVES);
        for (let i = 0; i < jours.length; i += 400) {
            const b = adminDb.batch();
            for (const d of jours.slice(i, i + 400)) b.set(adminDb.collection('djus').doc(`${s.code}_${d.date}`), { stationCode: s.code, stationName: s.name, date: d.date, value: d.value });
            await b.commit();
        }
        mensuels[s.code] = djuMensuels(jours);
    }
    for (const ix of INDICES) {
        await set('indices', `demo-ix-${ix.code}`, { code: ix.code, label: ix.label, unit: ix.unit, active: true });
        const b = adminDb.batch();
        for (const v of valeursIndice(ix.code, '2023-01', '2026-10')) b.set(adminDb.collection('indexValues').doc(`demo-ix-${ix.code}_${v.period}`), { indexId: `demo-ix-${ix.code}`, period: v.period, value: v.value, source: 'démo' });
        await b.commit();
    }
    const saison = [...mensuels['DEMO-LYON'].entries()].filter(([m]) => m >= '2025-10' && m <= '2026-05').reduce((s, [, v]) => s + v, 0);
    console.log(`Météo et indices : 2 stations (DJU journaliers, saison 2025-2026 Lyon : ${Math.round(saison)} DJU), indices PEGFM et ATRDFM.`);
    return mensuels;
}

/** Fins de mois de `debut` à `fin`. */
function finsDeMois(debut: string, fin: string): string[] {
    const out: string[] = [];
    let [y, m] = debut.split('-').map(Number);
    for (;;) {
        const d = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
        if (d > fin) break;
        out.push(d);
        m++; if (m > 12) { m = 1; y++; }
    }
    return out;
}

async function contratsEtPatrimoine(codesClients: string[], djuMois: Record<CodeStation, Map<string, number>>) {
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
    const r_ids = (i: number) => parLigne(rs).get(i + 2)!.id;

    // Compteurs : gaz (m³, QE) ou calories (MWh), ECS (m³).
    type Cpt = { site: number; cle: 'gaz' | 'ecs'; nom: string; type: 'GAZ' | 'CALO' | 'EAU' };
    const compteurs: Cpt[] = sites.flatMap((s, i) => [
        ...(s.compteur ? [{ site: i, cle: 'gaz' as const, nom: s.compteur === 'GAZ' ? 'Gaz chaufferie' : 'Calories sous-station', type: s.compteur }] : []),
        ...(s.ecs ? [{ site: i, cle: 'ecs' as const, nom: 'Eau chaude sanitaire', type: 'EAU' as const }] : []),
    ]);
    const rm = await importer('meters', [
        ['Site', 'Nom', 'Type de compteur', 'PDL / PCE', 'Emplacement', 'Statut'],
        ...compteurs.map((m, i) => [codesSites[m.site], m.nom, m.type, m.type === 'GAZ' ? `GI${String(990000000 + i * 7919).padStart(12, '0')}` : '', m.type === 'EAU' ? 'Local ECS' : 'Chaufferie', 'En service']),
    ]);
    const codesCompteurs = compteurs.map((_, i) => parLigne(rm).get(i + 2)!.code!);
    const codeCompteur = (site: number, cle: 'gaz' | 'ecs') => codesCompteurs[compteurs.findIndex(c => c.site === site && c.cle === cle)];

    // Relevés de fin de mois : consommation liée aux DJU de la station du contrat (chauffage) et à un besoin d'ECS.
    // Octobre 2026 manque sur le compteur gaz du Bâtiment B : sa facture P1 au compteur de novembre est bloquée.
    const fins = finsDeMois(DEBUT_RELEVES, FIN_RELEVES);
    const indexInitial = (i: number) => (compteurs[i].type === 'EAU' ? 1200 + i * 150 : compteurs[i].type === 'CALO' ? 4000 + i * 90 : 150000 + i * 37000);
    const lignesReleves: unknown[][] = [];
    const bloque = codeCompteur(sites.findIndex(s => s.nom === 'Tilleuls - Bâtiment B'), 'gaz');
    compteurs.forEach((m, i) => {
        const s = sites[m.site];
        let index = indexInitial(i);
        fins.forEach((jour, j) => {
            if (j > 0) {
                const mois = jour.slice(0, 7);
                const dju = djuMois[s.k.station].get(mois) ?? 0;
                const ecsM3 = Math.round((s.ecs ? 110 + 45 * Math.cos((2 * Math.PI * (Number(mois.slice(5)) - 1)) / 12) : 0) * (1 + 0.04 * Math.sin(j * 1.7)));
                const besoin = s.besoin ?? 600;
                const chauffageMwh = (besoin / 2350) * dju * (s.performance ?? 1) * (1 + 0.03 * Math.sin(j * 2.3));
                const mwhEntrants = chauffageMwh + (ecsM3 * QE_ECS) / 0.9;
                index += m.type === 'EAU' ? ecsM3 : m.type === 'CALO' ? Math.round(mwhEntrants * 10) / 10 : Math.round(mwhEntrants / QE_GAZ);
            }
            if (codesCompteurs[i] === bloque && jour === FIN_RELEVES) return;
            const estime = j % 9 === 4 && i % 4 === 0;
            lignesReleves.push([codesCompteurs[i], jour, Math.round(index * 10) / 10, estime ? 'Estimé' : 'Réel', estime ? 'Accès chaufferie impossible : index estimé' : '']);
        });
    });
    await importer('readings', [['Compteur', 'Date du relevé', 'Index', 'Type de relevé', 'Commentaire'], ...lignesReleves]);

    // Paramétrage P1 (valeurs d'origine) : compteurs, sites et postes, contrats, formules de révision.
    const ORIGINE = 'contrat d\'origine (démo)';
    await importer('meters', [
        ['Code compteur', 'P1 · Usage', 'P1 · Énergie', 'P1 · Coefficient de conversion (QE)', 'P1 · Motif'],
        ...compteurs.flatMap((m, i) => !sites[m.site].p1 ? [] : [[codesCompteurs[i], m.cle === 'ecs' ? 'ecs' : 'entrant', m.cle === 'ecs' ? '' : 'gaz', String(m.cle === 'ecs' ? QE_ECS : QE_GAZ).replace('.', ','), ORIGINE]]),
    ]);
    await importer('sites', [
        ['Code site', 'P1 · Type de marché', 'P1 · Période de référence', 'P1 · Prix de base chauffage', 'P1 · Prix de base ECS', 'P1 · Station météo', 'P1 · Quantité annuelle des acomptes',
            'P1 · Poste · Formule de NC', 'P1 · Poste · Cible NB', 'P1 · Poste · Unité de la cible', 'P1 · Poste · DJU de référence', 'P1 · Motif'],
        ...sites.flatMap((s, i) => !s.p1 ? [] : [[codesSites[i], s.p1.marche, 'saison_de_chauffe', s.p1.prixBase, s.p1.prixBaseEcs ?? '', s.p1.station, s.p1.quantiteAcompte ?? '',
            s.p1.nc === 'gaz-ecs' ? `${codeCompteur(i, 'gaz')} - ${codeCompteur(i, 'ecs')}` : codeCompteur(i, 'gaz'), s.p1.nb, 'MWh', s.p1.djuRef, ORIGINE]]),
    ]);
    const kP1 = CONTRATS.map((k, i) => ({ k, code: contrats[i].code! })).filter(x => x.k.p1);
    const colonnesBareme = [...new Set(kP1.flatMap(x => (x.k.p1!.bareme ? [x.k.p1!.bareme[0]] : [])))];
    await importer('contracts', [
        ['N° de contrat', 'P1 · Coefficient de gestion', 'P1 · Répartition des acomptes P1', 'P1 · Régularisation des acomptes', ...colonnesBareme.map(m => `P1 · Barème de partage ${m}`), 'P1 · Motif'],
        ...kP1.map(x => [x.code, x.k.p1!.coefGestion ? String(x.k.p1!.coefGestion).replace('.', ',') : '', x.k.p1!.repartition ?? '', x.k.p1!.regularisation ?? '',
            ...colonnesBareme.map(m => (x.k.p1!.bareme?.[0] === m ? x.k.p1!.bareme[1] : '')), ORIGINE]),
    ]);
    // Formules de révision P1 : p0 fixe, molécule (PEG) et acheminement (ATRD), base M0 = janvier 2024.
    const m0 = (code: typeof INDICES[number]['code']) => String(valeursIndice(code, '2024-01', '2024-01')[0].value).replace('.', ',');
    const termes = `p0=0,15 ; Kmol=0,6*PEGFM@${m0('PEGFM')} ; TVD=0,25*ATRDFM@${m0('ATRDFM')}`;
    await importer('p1formules', [
        ['Contrat', 'Formule', 'Usage', 'Périmètre', 'Motif', 'Forme', 'Périodicité de révision', 'Termes', 'Mois M0', 'Unité du prix', 'Arrondi du coefficient'],
        ...kP1.flatMap(x => [
            [x.code, 'Chauffage gaz', 'Chauffage', 'contrat', ORIGINE, 'A', 'mensuel', termes, '01/2024', 'EUR/MWh', 5],
            ...(x.k.p1!.ecs ? [[x.code, 'ECS gaz', 'ECS', 'contrat', ORIGINE, 'A', 'mensuel', termes, '01/2024', 'EUR/m3', 5]] : []),
        ]),
    ]);

    // Prestations : une par site et activité, depuis le début du contrat (P1 : chauffage ou ECS, au compteur ou en acomptes).
    const lignes = sites.flatMap((s, i) => s.prestations.map(p => [
        codesSites[i], p.act, s.k.debut, '', p.montant, p.periodicite ?? s.k.echeancier, p.terme ?? 'À échoir',
        p.p1?.compteur ? codeCompteur(i, p.p1.compteur) : '', p.p1?.type ?? '', p.p1?.mode === 'releve' ? 'Au compteur' : p.p1?.mode === 'acompte' ? 'Acomptes' : p.p1?.mode === 'dju' ? 'MTI au DJU' : '',
        p.p1?.mode === 'releve' ? 'Paramétrage P1' : '', p.p1?.coefValeur ? String(p.p1.coefValeur).replace('.', ',') : '',
        p.p1?.coef ? { aucun: 'Aucun', prestation: 'Prestation', contrat: 'Contrat' }[p.p1.coef] : '',
        p.p1?.mode === 'releve' ? { releve_jours: 'Relevé sinon jours', releve_dju: 'Relevé sinon DJU', jours: 'Jours', dju: 'DJU' }[p.p1.prorata ?? 'releve_jours'] : '',
    ]));
    const rp = await importer('services', [['Site', 'Activité', 'Date de début', 'Date de fin', 'Montant annuel HT', 'Périodicité', 'Terme', 'Compteur', 'Type P1', 'Facturation P1',
        'Prix au m³', 'Coefficient de prix', 'Coefficient de gestion', 'Prorata (mois partiel)'], ...lignes]);
    // Prix unitaire de l'intéressement (écran « Gérer l'intéressement » de la prestation).
    let n = 2;
    for (const s of sites) for (const p of s.prestations) {
        const r = parLigne(rp).get(n++)!;
        if (p.p1?.puInteressement) await adminDb.collection('services').doc(r.id).update({ interestUnitPrice: p.p1.puInteressement });
    }

    // Saisons de chauffe (allumage, arrêt) des sites au DJU ou en décompte.
    for (const [i, s] of sites.entries()) for (const [allumage, arret] of s.k.saisons && s.p1 ? s.k.saisons : []) {
        await setSaisonChauffe(r_ids(i), { saison: saisonDe(allumage), allumage, arret }, 'demo@example.com');
    }

    // Réel P1 du moteur (base de la régularisation des acomptes) : saison 2025-2026 du Belvédère, chauffage.
    const iBelv = sites.findIndex(s => s.nom === 'Belvédère - Chaufferie');
    const belv = sites[iBelv];
    const reel = finsDeMois('2025-10-01', '2026-09-30').map(j => {
        const mois = j.slice(0, 7);
        const mwh = (belv.besoin! / 2350) * (djuMois['DEMO-LYON'].get(mois) ?? 0) * belv.performance!;
        return [codesSites[iBelv], `${mois.slice(5)}/${mois.slice(0, 4)}`, Math.round(mwh * belv.p1!.prixBase * 1.04 * 100) / 100, 'Chauffage'];
    });
    await importer('p1reel', [['Site', 'Mois', 'Montant P1 HT', 'Usage'], ...reel]);
    console.log('Paramétrage P1 : 7 sites (MTI au DJU, MTI acomptes + décompte, MTI et MCI au compteur, MT), formules de révision (C/C0 arrondi à 5 décimales), barèmes, coefficients de gestion, saisons de chauffe ; réel P1 du Belvédère importé.');
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

// --- Travaux : devis, affaires (P5 facturation directe, P6 par situations), devis complémentaire ---

async function travaux(codesClients: string[], contrats: { id: string }[]) {
    const pricing: QuotePricing = { coefficient: 1.35, laborRate: 68, laborCost: 42, defaultVatRate: 20 };
    const client = async (code: string) => (await adminDb.collection('clients').where('externalCode', '==', code).limit(1).get()).docs[0];
    let n = 0;
    const devis = async (iClient: number, iContrat: number | null, mode: 'P5' | 'P6', title: string, lines: QuoteLine[], date: string) => {
        n++;
        const c = await client(codesClients[iClient]);
        const ref = adminDb.collection('quotes').doc(`demo-devis-${n}`);
        await ref.set({
            number: `ZEN-DEV2026-${String(n).padStart(4, '0')}`, companyId: 'demo-zen', clientId: c.id, clientName: String(c.get('name')),
            agencyId: c.get('agencyId'), sectorId: c.get('sectorId'), ...(iContrat !== null && { contractId: contrats[iContrat].id }),
            title, mode, status: 'envoye', version: 1, date, validityDays: 90, validUntil: '2027-03-31', pricing, lines, totals: computeQuoteTotals(lines, pricing),
            authorName: 'Claire Martin (ADV)', authorEmail: 'adv@example.com', contactName: 'Le gestionnaire', sentAt: instant(date), sentBy: 'adv@example.com',
            createdAt: instant(date), createdBy: 'adv@example.com', updatedAt: instant(date),
        } as Omit<Quote, 'id'>);
        return ref.id;
    };
    const L = (id: string, kind: QuoteLine['kind'], label: string, quantity: number, unitCost?: number): QuoteLine => ({ id, kind, label, quantity, vatRate: 20, ...(unitCost !== undefined && { unitCost }), ...(kind === 'MAIN_OEUVRE' && { unit: 'h' }) });
    const accord = (acceptedAt: string, attachProjectId?: string) => ({ acceptedAt, signatoryName: 'Le gestionnaire', signatoryRole: 'Gestionnaire de copropriété', ...(attachProjectId && { attachProjectId }) });

    // P5 : remplacement d'un circulateur (affaire créée à l'acceptation, acompte de 30 % facturé), puis devis complémentaire.
    const d1 = await devis(0, 0, 'P5', 'Remplacement du circulateur chauffage - Bâtiment A', [
        L('a1', 'FOURNITURE', 'Circulateur double à débit variable', 1, 1850), L('a2', 'FOURNITURE', 'Vannes d\'isolement et accessoires', 1, 240),
        L('a3', 'MAIN_OEUVRE', 'Dépose, pose et mise en service', 12), L('a4', 'DIVERS', 'Évacuation des déchets', 1, 60)], '2026-09-10');
    const q1 = await acceptQuote(d1, accord('2026-09-22'), 'adv@example.com');
    await invoiceQuote(d1, { kind: 'acompte', percent: 30 }, 'adv@example.com');
    const d2 = await devis(0, 0, 'P5', 'Complément : calorifugeage des tuyauteries', [L('b1', 'SOUS_TRAITANCE', 'Calorifugeage (sous-traité)', 1, 780), L('b2', 'MAIN_OEUVRE', 'Préparation et réception', 3)], '2026-10-05');
    await acceptQuote(d2, accord('2026-10-12', q1.projectId), 'adv@example.com');
    // P5 accepté, pas encore facturé (autre client).
    const d3 = await devis(6, 6, 'P5', 'Remplacement du vase d\'expansion', [L('c1', 'FOURNITURE', 'Vase d\'expansion 300 L', 1, 690), L('c2', 'MAIN_OEUVRE', 'Remplacement et épreuve', 6)], '2026-10-20');
    await acceptQuote(d3, accord('2026-11-03'), 'adv2@example.com');
    // P6 : rénovation de chaufferie, par situations (retenue de garantie 5 %), une situation facturée.
    const d4 = await devis(2, 2, 'P6', 'Rénovation de la chaufferie - remplacement des chaudières', [
        L('d1', 'FOURNITURE', 'Chaudières gaz à condensation 2 × 300 kW', 1, 46000), L('d2', 'SOUS_TRAITANCE', 'Fumisterie et tubage', 1, 12500),
        L('d3', 'SOUS_TRAITANCE', 'Électricité et régulation', 1, 9800), L('d4', 'MAIN_OEUVRE', 'Dépose, hydraulique, mise en service', 320), L('d5', 'DIVERS', 'Grutage et location de matériel', 1, 3200)], '2026-06-15');
    await acceptQuote(d4, accord('2026-07-08'), 'adv@example.com');
    const affaire = await createProjectFromQuote(d4, { retentionPct: 5 }, 'adv@example.com');
    const situation = await saveSituationDraft(affaire.id, { period: '2026-10', progress: { d1: 100, d2: 40, d3: 0, d4: 35, d5: 100 } }, 'adv@example.com');
    await invoiceSituation(situation.id, 'adv@example.com');
    // Devis envoyé, en attente de réponse.
    await devis(9, 9, 'P5', 'Désembouage du réseau ECS', [L('e1', 'SOUS_TRAITANCE', 'Désembouage hydrodynamique', 1, 2100), L('e2', 'MAIN_OEUVRE', 'Assistance et remise en service', 8)], '2026-11-04');
    await adminDb.collection('config').doc('sequences').set({ [`quote_ZEN_2026`]: n }, { merge: true });
    console.log(`Travaux : ${n} devis, 3 affaires (2 en P5 à facturation directe dont une avec devis complémentaire, 1 en P6 par situations).`);
    return { circulateur: q1.projectId as string, chaufferie: affaire.id };
}

// --- Achats : fournisseurs, commandes à chaque état du circuit (seuils par défaut : 500 / 5 000 / 10 000 € HT) ---

async function achats(affaires: { circulateur: string; chaufferie: string }, contrats: { id: string }[]) {
    const session = async (id: string): Promise<SessionUser> => {
        const d = await adminDb.collection('users').doc(id).get();
        const role = await adminDb.collection('roles').doc(String(d.get('roleId'))).get();
        return { uid: String(d.get('authUid')), email: String(d.get('email')), isAdmin: role.get('isAdmin') === true, isContratheque: role.get('isContratheque') === true, isAcheteur: role.get('isAcheteur') === true, profile: { id: d.id, ...d.data() } as SessionUser['profile'] };
    };
    const [tech, resp, dir, ach] = await Promise.all(['demo-u-tech', 'demo-u-resp', 'demo-u-dir', 'demo-u-achats'].map(session));
    const F = async (name: string, n: number, email: string) => (await saveFournisseur({ name, siret: siretFictif(900 + n), email, address: `${n} rue des Fournisseurs, 69800 Saint-Priest` }, 'achats@example.com')).id;
    const [negoce, chaudieres, fumiste, calo, levage] = [
        await F('Négoce Thermique Démo', 1, 'commandes@negoce-demo.example.com'), await F('Chaudières Exemple Industrie', 2, 'adv@chaudieres-demo.example.com'),
        await F('Fumisterie Rhône Démo', 3, 'contact@fumisterie-demo.example.com'), await F('Calorifuge Services Démo', 4, 'contact@calorifuge-demo.example.com'),
        await F('Levage et Location Démo', 5, 'agence@levage-demo.example.com'),
    ];
    type Ligne = CommandeInput['lines'][number];
    const aff = (projectId: string) => ({ type: 'affaire' as const, projectId });
    const cmd = async (par: SessionUser, supplierId: string, title: string, date: string, lines: Ligne[], soumettre = true) => {
        const c = await saveCommande({ companyId: 'demo-zen', supplierId, title, date, lines }, par);
        return soumettre ? soumettreCommande(c.id, par) : c;
    };
    const A = affaires;
    // Affaire « circulateur » (P5) : matériel reçu et facturé (N+1), petit achat autovalidé, sous-traitance en attente du N+1.
    const c1 = await cmd(tech, negoce, 'Circulateur double et accessoires', '2026-09-24', [
        { label: 'Circulateur double à débit variable', quantity: 1, unitPrice: 1790, nature: 'FOURNITURE', cible: aff(A.circulateur) },
        { label: 'Vannes d\'isolement et accessoires', quantity: 1, unitPrice: 255, nature: 'FOURNITURE', cible: aff(A.circulateur) }]);
    await deciderCommande(c1.id, 'validee', '', resp);
    await avancerCommande(c1.id, tech); await avancerCommande(c1.id, tech);
    await ajouterFactureFournisseur(c1.id, { numero: 'NTD-2026-4471', date: '2026-10-09', montantHT: 2045, solder: true }, ach);
    await cmd(tech, negoce, 'Évacuation des déchets (benne)', '2026-10-01', [{ label: 'Benne et traitement', quantity: 1, unitPrice: 72, nature: 'DIVERS', cible: aff(A.circulateur) }]);
    await cmd(tech, calo, 'Calorifugeage des tuyauteries', '2026-11-05', [{ label: 'Calorifugeage (sous-traité)', quantity: 1, unitPrice: 820, nature: 'SOUS_TRAITANCE', cible: aff(A.circulateur) }]);
    // Affaire « chaufferie » (P6) : chaudières (N+1, N+2, achats) passées et facturées en partie ; fumisterie validée par le N+1, en attente
    // des achats ; grutage soldé ; électricité refusée (devis à renégocier) ; un brouillon.
    const c4 = await cmd(tech, chaudieres, 'Chaudières gaz à condensation 2 × 300 kW', '2026-07-15', [{ label: 'Chaudière gaz à condensation 300 kW', quantity: 2, unitPrice: 22400, nature: 'FOURNITURE', cible: aff(A.chaufferie) }]);
    await deciderCommande(c4.id, 'validee', '', resp); await deciderCommande(c4.id, 'validee', 'Conforme au budget du devis.', dir); await deciderCommande(c4.id, 'validee', 'Prix négocié au contrat-cadre.', ach);
    await avancerCommande(c4.id, ach); await avancerCommande(c4.id, tech);
    await ajouterFactureFournisseur(c4.id, { numero: 'CEI-26-0918', date: '2026-09-30', montantHT: 22400 }, ach);
    const c5 = await cmd(tech, fumiste, 'Fumisterie et tubage', '2026-11-02', [{ label: 'Tubage inox et conduits', quantity: 1, unitPrice: 12900, nature: 'SOUS_TRAITANCE', cible: aff(A.chaufferie) }]);
    await deciderCommande(c5.id, 'validee', '', resp); await deciderCommande(c5.id, 'validee', '', dir);
    const c6 = await cmd(resp, levage, 'Grutage et location de matériel', '2026-08-20', [{ label: 'Grutage des chaudières', quantity: 1, unitPrice: 2400, nature: 'DIVERS', cible: aff(A.chaufferie) }, { label: 'Location de matériel de manutention (semaine)', quantity: 2, unitPrice: 480, nature: 'DIVERS', cible: aff(A.chaufferie) }]);
    await deciderCommande(c6.id, 'validee', '', dir);
    await avancerCommande(c6.id, resp); await avancerCommande(c6.id, resp);
    await ajouterFactureFournisseur(c6.id, { numero: 'LLD-8820', date: '2026-09-12', montantHT: 3510, solder: true }, ach);
    const c7 = await cmd(tech, fumiste, 'Électricité et régulation', '2026-11-03', [{ label: 'Armoire, câblage et régulation', quantity: 1, unitPrice: 11200, nature: 'SOUS_TRAITANCE', cible: aff(A.chaufferie) }]);
    await deciderCommande(c7.id, 'refusee', 'Dépasse le budget du devis (9 800 €) : à renégocier ou à justifier.', resp);
    await cmd(tech, negoce, 'Hydraulique : vannes et pompes de charge', '2026-11-08', [{ label: 'Pompes de charge', quantity: 2, unitPrice: 940, nature: 'FOURNITURE', cible: aff(A.chaufferie) }, { label: 'Vannes trois voies', quantity: 2, unitPrice: 610, nature: 'FOURNITURE', cible: aff(A.chaufferie) }], false);
    // Sur contrat (dépense d'exploitation P2, hors affaire) : pièces de maintenance, validées par le N+1.
    const c9 = await cmd(tech, negoce, 'Pièces de maintenance : brûleur', '2026-10-14', [{ label: 'Électrodes et gicleurs', quantity: 4, unitPrice: 86, nature: 'FOURNITURE', cible: { type: 'contrat', contractId: contrats[0].id, activityCode: 'P2' } }, { label: 'Cellule de détection de flamme', quantity: 1, unitPrice: 310, nature: 'FOURNITURE', cible: { type: 'contrat', contractId: contrats[0].id, activityCode: 'P2' } }]);
    await deciderCommande(c9.id, 'validee', '', resp);
    console.log('Achats : 5 fournisseurs, 9 commandes (brouillon, à valider N+1 / achats, refusée, validée, reçue, soldées), dont une sur contrat.');
}

(async () => {
    console.log(`Données simulées — projet ${PROJET}, au ${AUJOURDHUI}.`);
    await remiseAZero();
    await referentiels();
    await comptes();
    const codesClients = await clientsEtContacts();
    const djuMois = await meteoEtIndices();
    const { contrats } = await contratsEtPatrimoine(codesClients, djuMois);
    await documents(contrats);
    // Analytique : un contrat suivi par un code externe (outil comptable), les autres par le code généré.
    await adminDb.collection('contracts').doc(contrats[6].id).update({ analyticExternal: '68W2/V080912-1' });
    await factures(contrats);
    const affaires = await travaux(codesClients, contrats);
    await achats(affaires, contrats);
    console.log('Jeu de données prêt.');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
