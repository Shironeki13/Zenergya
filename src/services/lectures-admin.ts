import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { PerimetreError, clientDe, gardePerimetre, type GardePerimetre, type ObjetPerimetre } from '@/lib/auth/perimetre-server';
import type { SessionUser } from '@/lib/auth/server';
import { convertir } from '@/services/donnees-admin';

/**
 * Lectures spécifiques des écrans (une fiche, les éléments d'un contrat, d'un client, d'un devis, d'une affaire) : faites
 * par le serveur, qui vérifie que l'objet demandé appartient à un client du périmètre de l'utilisateur. Chaque lecture
 * est nommée ; le navigateur ne choisit ni la collection ni le filtre.
 */

type Doc = { id: string } & Record<string, unknown>;
const docs = (s: FirebaseFirestore.QuerySnapshot): Doc[] => s.docs.map(d => convertir({ id: d.id, ...d.data() }) as Doc);
const un = async (coll: string, id: string): Promise<Doc | null> => {
    if (!id) return null;
    const d = await adminDb.collection(coll).doc(id).get();
    return d.exists ? (convertir({ id: d.id, ...d.data() }) as Doc) : null;
};
const par = async (coll: string, champ: string, valeur: string): Promise<Doc[]> => (valeur ? docs(await adminDb.collection(coll).where(champ, '==', valeur).get()) : []);

/**
 * L'objet parent est-il accessible ? `absent` : il n'existe pas (la lecture renvoie alors « rien », comme une lecture
 * directe) ; hors périmètre : refus.
 */
async function acces(garde: GardePerimetre, type: ObjetPerimetre, id: string): Promise<'ok' | 'absent'> {
    if (garde.tout) return 'ok';
    // Un client se désigne lui-même : son existence se vérifie à part.
    const client = type === 'client' ? ((await adminDb.collection('clients').doc(id || '-').get()).exists ? id : null) : await clientDe(type, id);
    if (client === null) return 'absent';
    if (!(await garde.voitClient(client))) throw new PerimetreError();
    return 'ok';
}

type Args = Record<string, string>;
type Lecture = (a: Args, garde: GardePerimetre) => Promise<unknown>;
/** Fiche : lue, puis contrôlée sur son propre client. */
const fiche = (coll: string, client: (d: Doc) => Promise<string | null> | string | null): Lecture => async (a, garde) => {
    const d = await un(coll, a.id);
    if (!d || garde.tout) return d;
    if (!(await garde.voitClient(await client(d)))) throw new PerimetreError();
    return d;
};
/** Éléments d'un parent (contrat, client, devis, affaire, prestation) : le parent est contrôlé. */
const enfants = (coll: string, champ: string, parent: ObjetPerimetre, tri?: (x: Doc, y: Doc) => number): Lecture => async (a, garde) => {
    if ((await acces(garde, parent, a.id)) === 'absent') return [];
    const l = await par(coll, champ, a.id);
    return tri ? l.sort(tri) : l;
};
const s = (v: unknown) => String(v ?? '');
const n = (v: unknown) => Number(v ?? 0);

export const LECTURES = {
    client: fiche('clients', d => d.id),
    contrat: fiche('contracts', d => s(d.clientId) || null),
    facture: fiche('invoices', d => s(d.clientId) || null),
    devis: fiche('quotes', d => s(d.clientId) || null),
    affaire: fiche('projects', d => s(d.clientId) || null),
    contactsDuClient: enfants('contacts', 'clientId', 'client'),
    sitesDuClient: enfants('sites', 'clientId', 'client'),
    contratsDuClient: enfants('contracts', 'clientId', 'client'),
    sitesDuContrat: enfants('sites', 'contractId', 'contrat'),
    facturesDuContrat: enfants('invoices', 'contractId', 'contrat'),
    relevesDuContrat: enfants('meterReadings', 'contractId', 'contrat'),
    relevesDuCompteur: enfants('meterReadings', 'meterId', 'compteur'),
    prestationsDuContrat: enfants('services', 'contractId', 'contrat'),
    prestationsDuSite: enfants('services', 'siteId', 'site'),
    avenantsDuContrat: enfants('amendments', 'contractId', 'contrat'),
    resiliationsDuContrat: enfants('terminations', 'contractId', 'contrat'),
    reconductionsDuContrat: enfants('renewals', 'contractId', 'contrat'),
    syndicsDuContrat: enfants('trusteeChanges', 'contractId', 'contrat'),
    beDuContrat: enfants('beChanges', 'contractId', 'contrat'),
    interetsDeLaPrestation: enfants('interests', 'serviceId', 'prestation'),
    reglementsDeLaPrestation: enfants('service_settlements', 'serviceId', 'prestation'),
    versionsDuDevis: enfants('quoteVersions', 'quoteId', 'devis', (x, y) => n(x.version) - n(y.version)),
    facturesDuDevis: enfants('invoices', 'quoteId', 'devis', (x, y) => s(x.invoiceNumber).localeCompare(s(y.invoiceNumber))),
    situationsDeLAffaire: enfants('projectSituations', 'projectId', 'affaire', (x, y) => n(x.number) - n(y.number)),
    facturesDeLAffaire: enfants('invoices', 'projectId', 'affaire'),
    /** Listes entières, réduites au périmètre. */
    devisTous: (async (_a, garde) => garde.filtrer(docs(await adminDb.collection('quotes').get()), d => s(d.clientId))) as Lecture,
    affaires: (async (_a, garde) => garde.filtrer(docs(await adminDb.collection('projects').get()), d => s(d.clientId))) as Lecture,
} satisfies Record<string, Lecture>;

export type NomLecture = keyof typeof LECTURES;

export async function lire(nom: string, args: Args, user: SessionUser): Promise<unknown> {
    if (!Object.prototype.hasOwnProperty.call(LECTURES, nom)) throw new Error('Lecture inconnue.');
    const a = Object.fromEntries(Object.entries(args ?? {}).map(([k, v]) => [k, String(v ?? '')]));
    return LECTURES[nom as NomLecture](a, gardePerimetre(user));
}
