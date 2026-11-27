import 'server-only';
import Handlebars from 'handlebars';
import { ai } from '@/ai/genkit';
import { exigerCleIA, modeleIA, nomModele } from '@/ai/modeles';
import { ExtractContractInfoOutputSchema, type ExtractContractInfoOutput } from '@/lib/types';
import { CONSIGNE_PREUVES } from '@/lib/contracts/propositions';

/**
 * Lecture d'un contrat (PDF) par l'IA, côté serveur. `IA_SIMULATION=1` (démo et essais seulement) : une lecture fictive
 * plausible, sans appel au fournisseur — le résultat le dit.
 */

export type RefsLecture = { activities: { id: string; code: string; label: string }[]; typologies: { id: string; name: string }[]; terms: { id: string; name: string }[]; schedules: { id: string; name: string }[] };
export type Lecture = { sortie: ExtractContractInfoOutput; modele: string; simulee: boolean; dureeMs: number };

export const simulationIA = () => process.env.IA_SIMULATION === '1';

export async function lireContrat(p: { dataUri: string; contentType: string; consignes: string; refs: RefsLecture; nomFichier?: string }): Promise<Lecture> {
    const debut = Date.now();
    if (simulationIA()) return { sortie: lectureSimulee(p.refs, p.nomFichier ?? ''), modele: 'simulation', simulee: true, dureeMs: Date.now() - debut };
    exigerCleIA();
    const consignes = Handlebars.compile(p.consignes)({
        activities: JSON.stringify(p.refs.activities.map(({ id, code, label }) => ({ id, code, label })), null, 2),
        typologies: JSON.stringify(p.refs.typologies, null, 2), terms: JSON.stringify(p.refs.terms, null, 2), schedules: JSON.stringify(p.refs.schedules, null, 2),
    }) + CONSIGNE_PREUVES;
    const { output } = await ai.generate({
        model: modeleIA(),
        prompt: [{ text: consignes }, { media: { url: p.dataUri, contentType: p.contentType } }],
        output: { schema: ExtractContractInfoOutputSchema },
        config: { temperature: 0.2 },
    });
    if (!output) throw new Error("L'IA n'a rien renvoyé pour ce document.");
    if ((!output.activityIds || output.activityIds.length === 0) && output.activitiesDetails?.length) output.activityIds = output.activitiesDetails.map(a => a.activityId);
    return { sortie: output, modele: nomModele(), simulee: false, dureeMs: Date.now() - debut };
}

/**
 * Lecture fictive (démo) : une copropriété avec deux bâtiments, P1, P2 et P3 ; si le nom du fichier contient le nom
 * d'un client existant (« tilleuls »…), la copropriété Les Tilleuls (client reconnu, contrat déjà en place).
 */
function lectureSimulee(refs: RefsLecture, nomFichier: string): ExtractContractInfoOutput {
    const act = (code: string) => refs.activities.find(a => a.code === code)?.id;
    const par = (l: { id: string; name: string }[], mot: RegExp) => l.find(x => mot.test(x.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()))?.id;
    const trim = par(refs.schedules, /trimestr/), annuel = par(refs.schedules, /annuel/), echoir = par(refs.terms, /echoir/), echu = par(refs.terms, /echu/) && refs.terms.find(t => /echu/i.test(t.name.normalize('NFD').replace(/[̀-ͯ]/g, '')) && !/echoir/i.test(t.name.normalize('NFD').replace(/[̀-ͯ]/g, '')))?.id;
    const tilleuls = /tilleul/i.test(nomFichier);
    const details = [
        act('P1') && { activityId: act('P1')!, amount: tilleuls ? 61000 : 48500, scheduleId: trim, termId: echu, revisionFormula: 'P1 = P0 x (0,15 + 0,85 x PEG/PEG0)', revisionBaseIndices: [{ code: 'PEG', value: 31.2 }], contractualDJU: 2350, contractualNB: 820 },
        act('P2') && { activityId: act('P2')!, amount: tilleuls ? 9800 : 7900, scheduleId: trim, termId: echoir, revisionFormula: 'P2 = P0 x (0,15 + 0,85 x ICHT/ICHT0)', revisionBaseIndices: [{ code: 'ICHT-IME', value: 148.5 }] },
        act('P3') && { activityId: act('P3')!, amount: tilleuls ? 4200 : 3600, scheduleId: annuel ?? trim, termId: echoir },
    ].filter(Boolean) as NonNullable<ExtractContractInfoOutput['activitiesDetails']>;
    const client = tilleuls
        ? { isBe: false, name: 'Copropriété Les Tilleuls', address: '4 allée des Tilleuls', postalCode: '69004', city: 'Lyon', clientType: 'private' as const, typologyName: 'Copropriété', representativeName: 'Cabinet Exemple Gestion', contactFacturation: { name: 'Service comptable', email: 'compta@example.com' } }
        : { isBe: false, name: 'Syndicat des copropriétaires Résidence Les Érables', address: '12 rue des Érables', postalCode: '69008', city: 'Lyon', clientType: 'private' as const, typologyName: 'Copropriété', siret: '81234567800019', representativeName: 'Régie des Érables (démo)', contactFacturation: { name: 'Mme Bernard', email: 'compta.erables@example.com', phone: '04 78 00 11 22' } };
    return {
        client,
        contrat: { label: tilleuls ? 'Exploitation chauffage 2027-2031' : 'Exploitation chauffage et ECS', startDate: '2027-01-01', endDate: '2031-12-31', tacitRenewal: true, noticePeriod: '3 mois', invoicingType: 'multi-site' },
        sites: tilleuls
            ? [{ name: 'Tilleuls - Bâtiment A', address: '4 allée des Tilleuls', postalCode: '69004', city: 'Lyon', billingSchedule: 'Trimestriel', term: 'Échu' }]
            : [{ name: 'Les Érables - Bâtiment A', address: '12 rue des Érables', postalCode: '69008', city: 'Lyon', billingSchedule: 'Trimestriel', term: 'Échu' }, { name: 'Les Érables - Bâtiment B', address: '14 rue des Érables', postalCode: '69008', city: 'Lyon' }],
        activityIds: details.map(d => d.activityId),
        activitiesDetails: details,
        preuves: [
            { champ: 'client.name', extrait: `Entre ${client.name}, représenté par son syndic ${client.representativeName}, ci-après « le Client »`, page: 1, confiance: 'haute' },
            ...(tilleuls ? [] : [{ champ: 'client.siret', extrait: 'SIRET : 812 345 678 00019', page: 1, confiance: 'haute' as const }]),
            { champ: 'contrat.startDate', extrait: 'Le présent contrat prend effet le 1er janvier 2027 pour une durée de cinq ans.', page: 2, confiance: 'haute' },
            { champ: 'contrat.endDate', extrait: 'pour une durée de cinq ans', page: 2, confiance: 'moyenne' },
            { champ: 'contrat.noticePeriod', extrait: 'résiliation par lettre recommandée trois mois avant l\'échéance', page: 6, confiance: 'haute' },
            { champ: 'sites[0].address', extrait: `${client.address}, ${client.postalCode} ${client.city}`, page: 1, confiance: 'haute' },
            ...details.map(d => ({ champ: `activitiesDetails[${d.activityId}].amount`, extrait: `Montant annuel forfaitaire : ${d.amount!.toLocaleString('fr-FR')} € HT`, page: 4, confiance: (d.activityId === act('P3') ? 'moyenne' : 'haute') as 'moyenne' | 'haute' })),
        ],
    };
}
