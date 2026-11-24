/**
 * File de travail de la facturation manuelle : les contrats qui ont quelque chose à facturer aujourd'hui, les plus
 * en retard d'abord. Module sans dépendance serveur.
 */
export type LigneFile = {
    contractId: string; contractNumber: string; clientName: string; periodStart: string; periodEnd: string;
    subtotal: number; error?: string; dueSince?: string;
};

export type ContratAFacturer = {
    id: string; numero: string; client: string; debut: string; fin: string; montantHT: number;
    /** Jours écoulés depuis que la plus ancienne échéance est facturable (0 : facturable aujourd'hui). */
    retard: number;
    /** Anomalie empêchant tout ou partie de la facture : à ouvrir pour voir quoi corriger. */
    blocage?: string;
};

const jours = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Contrats à facturer, du plus en retard au plus récent ; à retard égal, le plus gros montant d'abord. */
export function fileFacturation(lignes: LigneFile[], aujourdhui: string): ContratAFacturer[] {
    return lignes.map(l => ({
        id: l.contractId, numero: l.contractNumber, client: l.clientName, debut: l.periodStart, fin: l.periodEnd, montantHT: l.subtotal,
        retard: l.dueSince ? Math.max(0, jours(l.dueSince, aujourdhui)) : 0,
        ...(l.error && { blocage: l.error }),
    })).sort((a, b) => b.retard - a.retard || b.montantHT - a.montantHT || a.client.localeCompare(b.client, 'fr') || a.numero.localeCompare(b.numero));
}

export function libelleRetard(retard: number): string {
    return retard === 0 ? "facturable aujourd'hui" : retard === 1 ? 'depuis hier' : `depuis ${retard} jours`;
}

/** Contrat suivant dans la file après celui qu'on vient de traiter (null : file terminée). */
export function suivant(file: ContratAFacturer[], courant: string | null): ContratAFacturer | null {
    const i = file.findIndex(c => c.id === courant);
    return file.slice(i + 1).concat(i > 0 ? file.slice(0, i) : []).find(c => c.id !== courant) ?? null;
}
