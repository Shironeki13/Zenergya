import { redirect } from 'next/navigation';

/** Ancienne page de validation : remplacée par la validation des documents (administrateurs), par type. */
export default function Page() {
    redirect('/admin/validations?onglet=contrat');
}
