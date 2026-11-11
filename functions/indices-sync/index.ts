import { synchroniserIndices, type RapportSync } from '@/services/index-sync';

/**
 * Fonction planifiée « indices-sync » (Cloud Functions 2ᵉ génération, déclenchée par Cloud Scheduler) : met à jour les
 * indices depuis leurs sources (INSEE, PEG, CEE…), avec les mêmes contrôles et le même journal que le bouton
 * « Synchroniser » de l'application (src/services/index-sync.ts).
 *
 *   GET ou POST /            synchronise
 *   GET ou POST /?dryRun=1   essai : interroge les sources et contrôle, sans rien enregistrer
 *
 * Appel authentifié (compte de service, jeton OIDC) : la fonction n'est pas publique. Voir docs/indices-automatiques.md.
 */

type Requete = { query?: Record<string, unknown> };
type Reponse = { status: (code: number) => Reponse; json: (corps: unknown) => void };

/** Journal structuré (Cloud Logging) : une ligne par source en difficulté, pour les alertes. */
function journaliser(r: RapportSync): void {
    const ligne = (severity: 'INFO' | 'WARNING' | 'ERROR', message: string, plus: Record<string, unknown> = {}) => console.log(JSON.stringify({ severity, message, composant: 'indices-sync', ...plus }));
    for (const s of r.sources) {
        if (s.statut === 'erreur') ligne('ERROR', `Indice ${s.code} : source en échec — ${s.erreur}`, { indice: s.code, probleme: 'source' });
        for (const x of s.rejetees) ligne('WARNING', `Indice ${s.code} : valeur ${x.value} de ${x.period} rejetée — ${x.motif}`, { indice: s.code, probleme: 'valeur' });
        if ((s.retardMois ?? 0) > 0) ligne('WARNING', `Indice ${s.code} : en retard de ${s.retardMois} mois (dernière valeur : ${s.dernierePeriode ?? 'aucune'})`, { indice: s.code, probleme: 'retard' });
    }
    ligne(r.erreurs ? 'WARNING' : 'INFO', `Indices : ${r.nouvelles} nouvelle(s) valeur(s), ${r.modifiees} révisée(s), ${r.rejetees} rejetée(s), ${r.erreurs} source(s) en échec, ${r.retards} indice(s) en retard${r.dryRun ? ' (essai, rien n\'est enregistré)' : ''}`,
        { nouvelles: r.nouvelles, modifiees: r.modifiees, rejetees: r.rejetees, erreurs: r.erreurs, retards: r.retards, dryRun: r.dryRun });
}

export async function syncIndices(req: Requete, res: Reponse): Promise<void> {
    const dryRun = ['1', 'true'].includes(String(req.query?.dryRun ?? ''));
    try {
        const rapport = await synchroniserIndices({ dryRun, declencheur: 'planifie' });
        journaliser(rapport);
        // Toutes les sources en échec : le passage est en erreur (Cloud Scheduler le relancera). Sinon, 200 : les
        // sources en difficulté sont dans le journal et le rapport.
        res.status(rapport.sources.length > 0 && rapport.erreurs === rapport.sources.length ? 502 : 200).json(rapport);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.log(JSON.stringify({ severity: 'ERROR', message: `Indices : synchronisation impossible — ${message}`, composant: 'indices-sync', probleme: 'execution' }));
        res.status(500).json({ error: message });
    }
}
