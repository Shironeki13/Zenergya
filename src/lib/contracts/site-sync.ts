/**
 * Correction d'un contrat (formulaire avec la liste de ses sites) : les sites existants sont mis à jour en place
 * (même identifiant, même code SIT : compteurs, relevés, prestations et factures restent rattachés), les
 * nouveaux sont créés, et seuls ceux retirés du formulaire sont candidats à la suppression.
 */
export type SiteSyncPlan<T> = {
    update: { id: string; values: T }[];
    create: T[];
    remove: string[];
};

export function planSiteSync<T extends { id?: string }>(existingIds: string[], formSites: T[]): SiteSyncPlan<Omit<T, 'id'>> {
    const plan: SiteSyncPlan<Omit<T, 'id'>> = { update: [], create: [], remove: [] };
    const kept = new Set<string>();
    for (const site of formSites) {
        const { id, ...values } = site;
        if (id && existingIds.includes(id) && !kept.has(id)) {
            kept.add(id);
            plan.update.push({ id, values });
        } else {
            plan.create.push(values);
        }
    }
    plan.remove = existingIds.filter(id => !kept.has(id));
    return plan;
}
