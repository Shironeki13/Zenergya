import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { PerimetreError, clientDe, gardePerimetre, type GardePerimetre, type ObjetPerimetre } from '@/lib/auth/perimetre-server';
import type { SessionUser } from '@/lib/auth/server';
import { convertir } from '@/services/donnees-admin';
import { aAnnexeP1 } from '@/lib/billing/p1-annexe';

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

// --- Factures et avoirs : par période, jamais tout l'historique ---

const estJour = (x: string) => /^\d{4}-\d{2}-\d{2}$/.test(x);
/** Bornes d'une période (jours AAAA-MM-JJ inclus), en horodatages. */
function bornes(a: Args): [Timestamp, Timestamp] {
    if (!estJour(a.du) || !estJour(a.au) || a.au < a.du) throw new Error('Période : dates de début et de fin (AAAA-MM-JJ), dans l\'ordre.');
    return [Timestamp.fromDate(new Date(`${a.du}T00:00:00Z`)), Timestamp.fromDate(new Date(`${a.au}T23:59:59.999Z`))];
}
/** Documents d'une période : date en horodatage (cas normal) ou en texte ISO (anciennes écritures). */
const dePeriode = (c: FirebaseFirestore.CollectionReference, a: Args) => {
    const [du, au] = bornes(a);
    return [c.where('date', '>=', du).where('date', '<=', au).get(), c.where('date', '>=', a.du).where('date', '<=', `${a.au}T23:59:59.999Z`).get()];
};
/**
 * Document de liste : sans le détail de ses lignes (97 % du poids d'une facture), dont les listes ne se servent que
 * pour savoir si une annexe P1 existe — indiqué par `annexeP1`. La fiche d'une facture lit le document complet.
 */
const pourListe = (d: Doc): Doc => ({ ...d, lineItems: [], annexeP1: aAnnexeP1((d.lineItems ?? []) as never) });
const sansDoublon = (l: Doc[]): Doc[] => [...new Map(l.map(d => [d.id, d])).values()];
/** États de facturation électronique qui demandent une action : à transmettre, rejeté. */
const A_TRANSMETTRE = ['to_send', 'rejected'];

/**
 * Factures d'une période, plus celles qui demandent une action quelle que soit leur date : impayées (à payer, en
 * retard) et proformas ; avec `einvoicing=1`, celles qui restent à transmettre ou ont été rejetées.
 */
const facturesDePeriode: Lecture = async (a, garde) => {
    const c = adminDb.collection('invoices');
    const lots = await Promise.all([
        ...dePeriode(c, a),
        c.where('status', 'in', ['due', 'overdue', 'proforma']).get(),
        ...(a.einvoicing === '1' ? [c.where('einvoicing.status', 'in', A_TRANSMETTRE).get()] : []),
    ]);
    return (await garde.filtrer(sansDoublon(lots.flatMap(docs)), d => s(d.clientId))).map(pourListe);
};

/** Avoirs d'une période (avec `einvoicing=1` : plus ceux à transmettre), et les numéros des factures qu'ils annulent. */
const avoirsDePeriode: Lecture = async (a, garde) => {
    const c = adminDb.collection('creditNotes');
    const lots = await Promise.all([
        ...dePeriode(c, a),
        ...(a.einvoicing === '1' ? [c.where('einvoicing.status', 'in', A_TRANSMETTRE).get()] : []),
    ]);
    const avoirs = await garde.filtrer(sansDoublon(lots.flatMap(docs)), d => s(d.clientId));
    const ids = [...new Set(avoirs.flatMap(x => (Array.isArray(x.originalInvoiceIds) ? x.originalInvoiceIds as string[] : [])))];
    const numeros = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 100) {
        const refs = ids.slice(i, i + 100).map(id => adminDb.collection('invoices').doc(id));
        for (const d of refs.length ? await adminDb.getAll(...refs) : []) if (d.exists) numeros.set(d.id, s(d.get('invoiceNumber')) || d.id);
    }
    return avoirs.map(pourListe).map(x => ({ ...x, originalInvoiceNumbers: (Array.isArray(x.originalInvoiceIds) ? x.originalInvoiceIds as string[] : []).map(id => numeros.get(id) ?? id) }));
};

/** Factures impayées (à payer, en retard), toutes dates : suivi des encaissements. */
const facturesImpayees: Lecture = async (_a, garde) => (await garde.filtrer(docs(await adminDb.collection('invoices').where('status', 'in', ['due', 'overdue']).get()), d => s(d.clientId))).map(pourListe);

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
    /** Relevés de tous les compteurs d'un site. */
    relevesDuSite: (async (a, garde) => {
        if ((await acces(garde, 'site', a.id)) === 'absent') return [];
        const compteurs = (await adminDb.collection('meters').where('siteId', '==', a.id).select().get()).docs.map(d => d.id);
        const lots = await Promise.all(Array.from({ length: Math.ceil(compteurs.length / 30) }, (_, i) => adminDb.collection('meterReadings').where('meterId', 'in', compteurs.slice(i * 30, i * 30 + 30)).get()));
        return lots.flatMap(docs);
    }) as Lecture,
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
    facturesDePeriode, avoirsDePeriode, facturesImpayees,
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
