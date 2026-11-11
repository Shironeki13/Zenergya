import type { Project, ProjectSituation } from '@/lib/projects/types';
import type { Invoice } from '@/lib/types';
import { lireServeur } from '@/services/lecture';

/**
 * Lectures des affaires (navigateur) : faites par le serveur, qui ne renvoie que les affaires des clients du périmètre
 * de l'utilisateur ; les écritures passent par les actions serveur.
 */

export const getProjects = (): Promise<Project[]> => lireServeur<Project[]>('affaires', {}, []);
export const getProject = (id: string): Promise<Project | null> => lireServeur<Project | null>('affaire', { id }, null);
export const getProjectSituations = (projectId: string): Promise<ProjectSituation[]> => lireServeur<ProjectSituation[]>('situationsDeLAffaire', { id: projectId }, []);
export const getProjectInvoices = (projectId: string): Promise<Invoice[]> => lireServeur<Invoice[]>('facturesDeLAffaire', { id: projectId }, []);
