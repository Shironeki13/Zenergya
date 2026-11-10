// Données simulées de la démo : DJU journaliers de deux stations fictives et indices mensuels (révision P1).
// Séries déterministes (mêmes valeurs à chaque génération), plausibles mais inventées.

export const STATIONS = [
    { code: 'DEMO-LYON', name: 'Lyon-Bron (démo)', decalage: 0 },
    { code: 'DEMO-PARIS', name: 'Paris-Montsouris (démo)', decalage: 0.8 },
] as const;
export type CodeStation = typeof STATIONS[number]['code'];

/** Bruit pseudo-aléatoire stable dans [-1, 1]. */
function bruit(n: number): number {
    const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
}
const jours = (debut: string, fin: string) => {
    const out: string[] = [];
    for (let t = Date.parse(`${debut}T00:00:00Z`); t <= Date.parse(`${fin}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
};

/** DJU journaliers (base 18 °C) d'une station, du `debut` au `fin` inclus. */
export function djuJournaliers(station: CodeStation, debut: string, fin: string): { date: string; value: number }[] {
    const s = STATIONS.find(x => x.code === station)!;
    return jours(debut, fin).map((date, i) => {
        const t = new Date(`${date}T00:00:00Z`);
        const doy = Math.floor((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000);
        const temperature = 11.8 + s.decalage - 9.5 * Math.cos((2 * Math.PI * (doy - 15)) / 365) + 3 * bruit(i + (station === 'DEMO-PARIS' ? 5000 : 0));
        return { date, value: Math.round(Math.max(0, 18 - temperature) * 10) / 10 };
    });
}

/** DJU par mois (AAAA-MM) à partir des journaliers. */
export function djuMensuels(journaliers: { date: string; value: number }[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const d of journaliers) m.set(d.date.slice(0, 7), Math.round(((m.get(d.date.slice(0, 7)) ?? 0) + d.value) * 10) / 10);
    return m;
}

/** Indices mensuels fictifs (AAAA-MM → valeur) : gaz (PEG, €/MWh) et acheminement (ATRD, indice). */
export const INDICES = [
    { code: 'PEGFM', label: 'Prix du gaz PEG fin de mois (démo)', unit: '€/MWh' },
    { code: 'ATRDFM', label: 'Tarif d\'acheminement gaz ATRD (démo)', unit: 'indice' },
] as const;
export function valeursIndice(code: typeof INDICES[number]['code'], debut: string, fin: string): { period: string; value: number }[] {
    const out: { period: string; value: number }[] = [];
    let [y, m] = debut.split('-').map(Number);
    let k = 0;
    while (`${y}-${String(m).padStart(2, '0')}` <= fin) {
        const period = `${y}-${String(m).padStart(2, '0')}`;
        const value = code === 'PEGFM'
            ? 32 + 6 * Math.sin(k / 4) + 0.15 * k + 2 * bruit(k + 900)          // ≈ 26 à 45 €/MWh
            : 100 + 0.35 * k + 0.6 * bruit(k + 1700);                            // dérive lente
        out.push({ period, value: Math.round(value * 100) / 100 });
        k++;
        m++; if (m > 12) { m = 1; y++; }
    }
    return out;
}
