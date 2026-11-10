import type { AccountingDocumentData } from '@/lib/pdf/accounting-document';

/**
 * Annexe P1 en tableur : un onglet par annexe (formule, révision des prix, détail par site et par mois, totaux),
 * valeurs numériques brutes (à retravailler par le client) et formats d'affichage.
 */
export async function annexeXlsx(data: AccountingDocumentData): Promise<Buffer> {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const jour = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'UTC' }) : '');
    const doc = `${data.kind === 'creditNote' ? 'Avoir' : data.kind === 'proforma' ? 'Facture proforma' : 'Facture'}${data.number ? ` n° ${data.number}` : ''} du ${jour(data.date)}`;
    const FORMATS: Record<string, string> = { eur: '#,##0.00 "€"', pct: '0.##" %"', coef: '0.00000', prix: '#,##0.0000', nombre: '#,##0.###' };
    (data.annexes ?? []).forEach((a, k) => {
        const rows: (string | number | null)[][] = [
            [`Annexe ${k + 1}/${data.annexes!.length} — ${a.titre}`],
            [`${doc} — ${data.company.name} — ${data.client.name}`],
            [data.periodStartDate && data.periodEndDate ? `Période du ${jour(data.periodStartDate)} au ${jour(data.periodEndDate)}` : ''],
            [a.formule],
            ...a.references.map(([l, v]) => [`${l} : ${v}`]),
            [],
        ];
        if (a.revisions.length) {
            rows.push(['Révision des prix'], ['Mois', 'Sites', 'Indice', 'Valeur de base', 'Valeur du mois', 'C/C0']);
            for (const r of a.revisions) {
                const mois = `${r.mois.slice(5, 7)}/${r.mois.slice(0, 4)}`;
                if (!r.termes.length) rows.push([mois, r.sites.join(', '), 'prix non révisé', null, null, r.coefficient]);
                r.termes.forEach((t, i) => rows.push([mois, r.sites.join(', '), t.indice ?? t.terme, t.base, t.valeur, i === r.termes.length - 1 ? r.coefficient : null]));
            }
            rows.push([]);
        }
        const entete = rows.length;
        const net = (v: string | number | null) => (typeof v === 'string' ? v.trim() : v);   // retraits d'affichage du PDF
        rows.push(a.colonnes.map(c => c.libelle.trim()));
        for (const l of a.lignes) rows.push(a.colonnes.map(c => net(l.valeurs[c.cle] ?? null)));
        rows.push(a.colonnes.map((c, i) => (i === 0 ? `TOTAL — ${a.titre}` : c.cle === 'ht' ? a.totaux.ht : c.cle === 'tva' ? a.totaux.tva : c.cle === 'ttc' ? a.totaux.ttc : null)));
        for (const n of [...a.notes, 'TVA indicative par ligne ; la TVA de la facture est calculée sur le total HT par taux.']) rows.push([n]);
        const sheet = XLSX.utils.aoa_to_sheet(rows);
        // Formats d'affichage des colonnes du détail.
        a.colonnes.forEach((c, j) => {
            const z = FORMATS[c.format];
            if (!z) return;
            for (let r = entete + 1; r <= entete + a.lignes.length + 1; r++) {
                const cell = sheet[XLSX.utils.encode_cell({ r, c: j })];
                if (cell && typeof cell.v === 'number') cell.z = z;
            }
        });
        sheet['!cols'] = a.colonnes.map(c => ({ wch: Math.max(10, Math.round(c.largeur * 1.6)) }));
        const nom = `${k + 1} ${a.titre}`.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
        XLSX.utils.book_append_sheet(wb, sheet, nom);
    });
    return Buffer.from(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);
}
