import { db } from '@/lib/firebase';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import type { Project, ProjectSituation } from '@/lib/projects/types';
import type { Invoice } from '@/lib/types';

/** Lectures des affaires P6 (navigateur) ; les écritures passent par les actions serveur. */

const iso = (v: any) => (v?.toDate ? v.toDate().toISOString() : v);

export async function getProjects(): Promise<Project[]> {
    const snap = await getDocs(collection(db, 'projects'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Project);
}

export async function getProject(id: string): Promise<Project | null> {
    const snap = await getDoc(doc(db, 'projects', id));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as Project) : null;
}

export async function getProjectSituations(projectId: string): Promise<ProjectSituation[]> {
    const snap = await getDocs(query(collection(db, 'projectSituations'), where('projectId', '==', projectId)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as ProjectSituation).sort((a, b) => a.number - b.number);
}

export async function getProjectInvoices(projectId: string): Promise<Invoice[]> {
    const snap = await getDocs(query(collection(db, 'invoices'), where('projectId', '==', projectId)));
    return snap.docs.map(d => { const data = d.data(); return { ...data, id: d.id, date: iso(data.date), dueDate: iso(data.dueDate) } as Invoice; });
}
