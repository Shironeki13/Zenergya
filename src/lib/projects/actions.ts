'use server';

import { requireUser } from '@/lib/auth/server';
import { gardePerimetre, type GardePerimetre, type ObjetPerimetre } from '@/lib/auth/perimetre-server';
import { adminDb } from '@/lib/firebase-admin';
import type { Progress, Project, ProjectSituation } from '@/lib/projects/types';
import {
    attachQuoteToProject, createDirectProject,
    createProjectFromQuote, deleteSituationDraft, invoiceSituation, saveSituationDraft, setProjectMilestone,
} from '@/services/projects-admin';
import { setAnalytiqueExterneAffaire } from '@/services/analytique-admin';
import { rentabiliteAffaire, rentabiliteAffaires, type RentabiliteAffaire, type ResumeRentabilite } from '@/services/rentabilite-admin';

/** Actions des affaires P6 (serveur, session requise) : seul le serveur écrit affaires et situations. */

type Result<T> = { success: true; data: T } | { success: false; error: string };

/** `objets` : devis, affaire ou situation sur lesquels porte l'action ; ils doivent être dans le périmètre de l'utilisateur. */
async function run<T>(objets: [ObjetPerimetre, string][], action: (by: string, garde: GardePerimetre) => Promise<T>): Promise<Result<T>> {
    try {
        const user = await requireUser();
        const garde = gardePerimetre(user);
        for (const [type, id] of objets) await garde.exiger(type, id);
        return { success: true, data: await action(user.email, garde) };
    } catch (error) {
        console.error('Action affaire :', error);
        return { success: false, error: error instanceof Error ? error.message : 'Action impossible.' };
    }
}

export async function createProjectAction(quoteId: string, options: { retentionPct: number; retentionBond?: boolean }): Promise<Result<Project>> {
    return run([['devis', quoteId]], by => createProjectFromQuote(quoteId, options, by));
}

/** Affaire à facturation directe d'un devis accepté (P5) : créée à l'acceptation ; ici pour un devis accepté avant. */
export async function createDirectProjectAction(quoteId: string): Promise<Result<Project>> {
    return run([['devis', quoteId]], by => createDirectProject(quoteId, by));
}

/** Rattache un devis complémentaire accepté à une affaire existante du même client. */
export async function attachQuoteAction(quoteId: string, projectId: string): Promise<Result<Project>> {
    return run([['devis', quoteId], ['affaire', projectId]], by => attachQuoteToProject(quoteId, projectId, by));
}

/** Code analytique externe de l'affaire (vide : code généré). */
export async function setProjectAnalyticExternalAction(projectId: string, valeur: string): Promise<Result<null>> {
    return run([['affaire', projectId]], async by => { await setAnalytiqueExterneAffaire(projectId, valeur, by ?? 'inconnu'); return null; });
}

export async function saveSituationAction(projectId: string, input: { period: string; progress: Progress }): Promise<Result<ProjectSituation>> {
    return run([['affaire', projectId]], by => saveSituationDraft(projectId, input, by));
}

export async function deleteSituationAction(situationId: string): Promise<Result<null>> {
    return run([['situation', situationId]], async () => { await deleteSituationDraft(situationId); return null; });
}

export async function invoiceSituationAction(situationId: string): Promise<Result<{ invoiceId: string; invoiceNumber: string }>> {
    return run([['situation', situationId]], by => invoiceSituation(situationId, by));
}

export async function projectMilestoneAction(projectId: string, milestone: 'completed' | 'retentionReleased' | 'closed', date: string): Promise<Result<Project>> {
    return run([['affaire', projectId]], () => setProjectMilestone(projectId, milestone, date));
}

/** Rentabilité d'une affaire : prévu, engagé, réel, facturé par nature ; ses commandes et ses heures. */
export async function rentabiliteAffaireAction(projectId: string): Promise<Result<RentabiliteAffaire>> {
    return run([['affaire', projectId]], async () => JSON.parse(JSON.stringify(await rentabiliteAffaire(projectId))));
}

export async function rentabiliteAffairesAction(): Promise<Result<Record<string, ResumeRentabilite>>> {
    return run([], async (_by, garde) => {
        const tout: Record<string, ResumeRentabilite> = JSON.parse(JSON.stringify(await rentabiliteAffaires()));
        const visibles = await garde.clients();
        if (!visibles) return tout;
        // Seules les affaires des clients du périmètre.
        const projets = await adminDb.collection('projects').select('clientId').get();
        const ok = new Set(projets.docs.filter(d => visibles.has(String(d.get('clientId')))).map(d => d.id));
        return Object.fromEntries(Object.entries(tout).filter(([id]) => ok.has(id)));
    });
}
