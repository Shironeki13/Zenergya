'use server';

import { requireUser } from '@/lib/auth/server';
import type { Progress, Project, ProjectSituation } from '@/lib/projects/types';
import {
    attachQuoteToProject, createDirectProject,
    createProjectFromQuote, deleteSituationDraft, invoiceSituation, saveSituationDraft, setProjectMilestone,
} from '@/services/projects-admin';
import { setAnalytiqueExterneAffaire } from '@/services/analytique-admin';
import { rentabiliteAffaire, rentabiliteAffaires, type RentabiliteAffaire, type ResumeRentabilite } from '@/services/rentabilite-admin';

/** Actions des affaires P6 (serveur, session requise) : seul le serveur écrit affaires et situations. */

type Result<T> = { success: true; data: T } | { success: false; error: string };

async function run<T>(action: (by: string) => Promise<T>): Promise<Result<T>> {
    try {
        const user = await requireUser();
        return { success: true, data: await action(user.email) };
    } catch (error) {
        console.error('Action affaire :', error);
        return { success: false, error: error instanceof Error ? error.message : 'Action impossible.' };
    }
}

export async function createProjectAction(quoteId: string, options: { retentionPct: number; retentionBond?: boolean }): Promise<Result<Project>> {
    return run(by => createProjectFromQuote(quoteId, options, by));
}

/** Affaire à facturation directe d'un devis accepté (P5) : créée à l'acceptation ; ici pour un devis accepté avant. */
export async function createDirectProjectAction(quoteId: string): Promise<Result<Project>> {
    return run(by => createDirectProject(quoteId, by));
}

/** Rattache un devis complémentaire accepté à une affaire existante du même client. */
export async function attachQuoteAction(quoteId: string, projectId: string): Promise<Result<Project>> {
    return run(by => attachQuoteToProject(quoteId, projectId, by));
}

/** Code analytique externe de l'affaire (vide : code généré). */
export async function setProjectAnalyticExternalAction(projectId: string, valeur: string): Promise<Result<null>> {
    return run(async by => { await setAnalytiqueExterneAffaire(projectId, valeur, by ?? 'inconnu'); return null; });
}

export async function saveSituationAction(projectId: string, input: { period: string; progress: Progress }): Promise<Result<ProjectSituation>> {
    return run(by => saveSituationDraft(projectId, input, by));
}

export async function deleteSituationAction(situationId: string): Promise<Result<null>> {
    return run(async () => { await deleteSituationDraft(situationId); return null; });
}

export async function invoiceSituationAction(situationId: string): Promise<Result<{ invoiceId: string; invoiceNumber: string }>> {
    return run(by => invoiceSituation(situationId, by));
}

export async function projectMilestoneAction(projectId: string, milestone: 'completed' | 'retentionReleased' | 'closed', date: string): Promise<Result<Project>> {
    return run(() => setProjectMilestone(projectId, milestone, date));
}

/** Rentabilité d'une affaire : prévu, engagé, réel, facturé par nature ; ses commandes et ses heures. */
export async function rentabiliteAffaireAction(projectId: string): Promise<Result<RentabiliteAffaire>> {
    return run(async () => JSON.parse(JSON.stringify(await rentabiliteAffaire(projectId))));
}

export async function rentabiliteAffairesAction(): Promise<Result<Record<string, ResumeRentabilite>>> {
    return run(async () => JSON.parse(JSON.stringify(await rentabiliteAffaires())));
}
