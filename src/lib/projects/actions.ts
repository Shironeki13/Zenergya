'use server';

import { requireUser } from '@/lib/auth/server';
import type { Progress, Project, ProjectSituation } from '@/lib/projects/types';
import {
    createProjectFromQuote, deleteSituationDraft, invoiceSituation, saveSituationDraft, setProjectMilestone,
} from '@/services/projects-admin';

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
