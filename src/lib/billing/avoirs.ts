/**
 * Émission des avoirs : motifs, nature (avoir transmis ou avoir interne) et contrôles d'une sélection de factures.
 *
 * Un avoir annule entièrement **une** facture. Sa nature dépend de ce qui est arrivé à la facture côté facturation
 * électronique : une facture **rejetée par la plateforme** n'a jamais été reçue par le client ; son avoir est
 * **interne** (il l'annule dans nos comptes, sans être transmis), et une facture corrigée est réémise. Sinon l'avoir
 * suit le canal du client (transmis par la plateforme ou Chorus, ou envoyé au client). Module sans dépendance serveur.
 */

export const MOTIFS_AVOIR = [
    { code: 'erreur_montant', libelle: 'Erreur de montant ou de prix' },
    { code: 'erreur_periode', libelle: 'Erreur de période facturée' },
    { code: 'erreur_client', libelle: 'Erreur de client ou d\'adressage' },
    { code: 'doublon', libelle: 'Double facturation' },
    { code: 'rejet_plateforme', libelle: 'Rejet par la plateforme de facturation électronique' },
    { code: 'resiliation', libelle: 'Résiliation ou fin de contrat' },
    { code: 'geste_commercial', libelle: 'Geste commercial' },
    { code: 'autre', libelle: 'Autre motif' },
] as const;
export type MotifAvoir = typeof MOTIFS_AVOIR[number]['code'];
export const libelleMotif = (code?: string) => MOTIFS_AVOIR.find(m => m.code === code)?.libelle ?? '';

export type NatureAvoir = 'interne' | 'standard';

/** Ce qu'il faut savoir d'une facture pour l'annuler. */
export type FactureAAnnuler = {
    id: string; invoiceNumber?: string; status: string; cancelledByCreditNoteId?: string;
    einvoicing?: { status?: string; channel?: string } | null;
};

/** Nature de l'avoir d'une facture : interne si la plateforme l'a rejetée, sinon standard. */
export const natureAvoir = (f: Pick<FactureAAnnuler, 'einvoicing'>): NatureAvoir => (f.einvoicing?.status === 'rejected' ? 'interne' : 'standard');

/** Ce que devient l'avoir, en clair. */
export function destinationAvoir(f: Pick<FactureAAnnuler, 'einvoicing'>): string {
    if (natureAvoir(f) === 'interne') return 'Interne : non transmis (facture rejetée par la plateforme)';
    const canal = f.einvoicing?.channel;
    if (canal === 'pa') return 'À transmettre par la plateforme agréée';
    if (canal === 'chorus') return 'À transmettre sur Chorus Pro';
    return 'Envoyé au client';
}

/** Pourquoi une facture ne peut pas être annulée ; null : elle peut l'être. */
export function refusAnnulation(f: FactureAAnnuler): string | null {
    if (f.status === 'proforma') return 'proforma : se supprime, ne s\'annule pas';
    if (f.status === 'cancelled' || f.cancelledByCreditNoteId) return 'déjà annulée par un avoir';
    if (!f.invoiceNumber) return 'facture sans numéro';
    return null;
}

/** Motif imprimé sur l'avoir : le libellé du motif, puis le commentaire. */
export function texteMotif(motif: string, commentaire?: string): string {
    const c = commentaire?.trim();
    return [libelleMotif(motif), c].filter(Boolean).join(' — ');
}

/** Anomalies de la demande (avant tout appel au serveur). */
export function controleDemande(factures: FactureAAnnuler[], motif: string, commentaire?: string): string[] {
    const erreurs: string[] = [];
    if (factures.length === 0) erreurs.push('Aucune facture sélectionnée.');
    if (factures.length > 200) erreurs.push('Au plus 200 factures à la fois.');
    if (!MOTIFS_AVOIR.some(m => m.code === motif)) erreurs.push('Choisissez un motif.');
    if (motif === 'autre' && !commentaire?.trim()) erreurs.push('Précisez le motif dans le commentaire.');
    return erreurs;
}
