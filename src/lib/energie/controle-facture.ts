/**
 * Contrôle d'une facture du fournisseur d'énergie face au contrat de fourniture du point de livraison : la facture
 * tombe-t-elle dans une période de contrat, chez le bon fournisseur, et à quel prix moyen ? Les alertes signalent,
 * elles n'empêchent pas de saisir. Module sans dépendance serveur.
 */
import type { PeriodeFourniture } from './fournitures';

export type AlerteFacture = { gravite: 'attention' | 'info'; texte: string };
export type ControleFacture = {
    /** Période de fourniture qui couvre la facture (son début de consommation, sinon sa date). */
    periode: Pick<PeriodeFourniture, 'id' | 'debut' | 'fin' | 'fournisseur' | 'numeroContrat' | 'prixMolecule' | 'indexationAchat'> | null;
    /** Prix moyen HT par MWh (toutes composantes), quand la quantité est saisie. */
    prixMoyen: number | null;
    alertes: AlerteFacture[];
};

const norm = (t: string | null | undefined) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\(.*?\)/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
const fr = (d: string) => d.split('-').reverse().join('/');
const eur = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ')} €`;
/** Mots qui ne distinguent pas un fournisseur d'un autre. */
const GENERIQUES = new Set(['GAZ', 'ENERGIE', 'ENERGIES', 'ELECTRICITE', 'ELEC', 'FRANCE', 'ENTREPRISES', 'SERVICES', 'SA', 'SAS', 'DE', 'DU', 'DES', 'LA', 'LE', 'LES', 'ET']);
/** Même fournisseur à une variante de nom près (« EDF » et « EDF Entreprises », « UNIPER/GAZELENERGIE » et « Uniper »), mais pas « Gaz du Sud » et « Gaz de Bordeaux ». */
export function memeFournisseur(a: string, b: string): boolean {
    const [x, y] = [norm(a), norm(b)];
    if (!x || !y) return false;
    if (x === y) return true;
    const propres = (t: string) => t.split(' ').filter(m => m.length > 1 && !GENERIQUES.has(m));
    const [px, py] = [propres(x), propres(y)];
    return px.length > 0 && py.length > 0 && px.some(m => py.includes(m));
}

export function controlerFactureFournisseur(
    f: { fournisseur: string; date: string; debut?: string | null; fin?: string | null; montantHT: number; quantite?: number | null },
    periodes: PeriodeFourniture[] | null,
): ControleFacture {
    const prixMoyen = f.quantite && f.quantite > 0 ? Math.round((f.montantHT / f.quantite) * 100) / 100 : null;
    if (periodes === null) return { periode: null, prixMoyen, alertes: [{ gravite: 'info', texte: 'Facture non rattachée à un point de livraison : aucun contrôle sur le contrat fournisseur.' }] };
    const [du, au] = f.debut && f.fin ? [f.debut, f.fin] : [f.date, f.date];
    const datees = periodes.filter(p => p.debut && p.fin);
    const couvre = (jour: string) => datees.filter(p => p.debut! <= jour && p.fin! >= jour).sort((a, b) => b.debut!.localeCompare(a.debut!))[0] ?? null;
    const [debutCouvert, finCouverte] = [couvre(du), couvre(au)];
    const periode = debutCouvert ?? finCouverte;
    const alertes: AlerteFacture[] = [];
    const quoi = f.debut && f.fin ? `la consommation du ${fr(du)} au ${fr(au)}` : `la facture du ${fr(du)}`;
    if (!periode) alertes.push({ gravite: 'attention', texte: `Aucun contrat fournisseur de ce point ne couvre ${quoi}.` });
    else {
        if (!debutCouvert || !finCouverte) alertes.push({ gravite: 'attention', texte: `Le contrat fournisseur ne couvre qu'une partie de ${quoi} (contrat du ${fr(periode.debut!)} au ${fr(periode.fin!)}).` });
        else if (debutCouvert.id !== finCouverte.id) alertes.push({ gravite: 'info', texte: `La consommation est à cheval sur deux contrats : ${debutCouvert.fournisseur || '?'} jusqu'au ${fr(debutCouvert.fin!)}, puis ${finCouverte.fournisseur || '?'}.` });
        if (periode.fournisseur && !memeFournisseur(periode.fournisseur, f.fournisseur)) alertes.push({ gravite: 'attention', texte: `Fournisseur de la facture (${f.fournisseur}) différent de celui du contrat en vigueur (${periode.fournisseur}).` });
        if (prixMoyen !== null && typeof periode.prixMolecule === 'number' && periode.prixMolecule > 0) {
            // Le prix moyen inclut acheminement, abonnements et taxes : il dépasse normalement la molécule seule.
            if (prixMoyen < periode.prixMolecule) alertes.push({ gravite: 'attention', texte: `Prix moyen de ${eur(prixMoyen)}/MWh, inférieur à la molécule du contrat (${eur(periode.prixMolecule)}/MWh) : vérifiez la quantité ou le montant.` });
            else alertes.push({ gravite: 'info', texte: `Prix moyen de ${eur(prixMoyen)}/MWh toutes composantes, pour une molécule à ${eur(periode.prixMolecule)}/MWh au contrat.` });
        }
    }
    return { periode: periode ? { id: periode.id, debut: periode.debut, fin: periode.fin, fournisseur: periode.fournisseur, numeroContrat: periode.numeroContrat, prixMolecule: periode.prixMolecule ?? null, indexationAchat: periode.indexationAchat } : null, prixMoyen, alertes };
}
