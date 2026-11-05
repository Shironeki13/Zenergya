import { daysIn } from '@/lib/billing/contract-billing';

/**
 * Alertes des compteurs (calcul pur), à partir de leurs relevés.
 *
 * - **Index en baisse** (critique) : un relevé plus bas que le précédent, sans être un relevé « corrigé ».
 * - **Relevé ECS manquant** (critique) : compteur d'une ECS facturée au relevé sans relevé du dernier mois échu
 *   (la facture est bloquée).
 * - **Dérive de consommation** (attention) : consommation journalière du dernier intervalle comparée à celle de la
 *   même période l'an passé, sinon à la médiane des intervalles précédents ; au-delà de ×2 ou en deçà de ×0,5.
 * - **Relevés contradictoires** (attention) : deux relevés le même jour avec des index différents.
 * - **Sans relevé** (attention) : compteur en service sans relevé depuis 45 jours (ou jamais relevé).
 * - **Relevé estimé non remplacé** (info) : le dernier relevé est estimé, depuis plus de 30 jours.
 * - **Consommation nulle** (info) : compteur d'ECS sans consommation depuis 60 jours.
 */

export type Gravite = 'critique' | 'attention' | 'info';
export type TypeAlerte = 'index_baisse' | 'releve_ecs_manquant' | 'derive' | 'doublon' | 'sans_releve' | 'estime' | 'conso_nulle';

export type CompteurSuivi = {
    id: string; code: string; name: string; siteId: string; site: string; client: string; unit?: string; status?: string;
    /** Usage P1 (entrant, vente, ecs…) en vigueur, s'il est renseigné. */
    usage?: string | null;
    /** Compteur d'une ECS facturée au relevé. */
    ecsAuReleve?: boolean;
};
export type RelevePilotage = { id: string; date: string; value: number; type?: string };

export type Alerte = {
    meterId: string; code: string; site: string; siteId: string; client: string;
    type: TypeAlerte; gravite: Gravite; message: string; date: string;
};

export const SEUILS = {
    sansReleveJours: 45,
    facteurHaut: 2,
    facteurBas: 0.5,
    intervalleMinJours: 7,
    toleranceAnPasseJours: 20,
    estimeJours: 30,
    nulleJours: 60,
};

const fr = (d: string) => d.split('-').reverse().join('/');
const n = (x: number) => x.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const addDays = (day: string, k: number) => new Date(Date.parse(day) + k * 86_400_000).toISOString().slice(0, 10);

/** Consommation journalière entre deux relevés (null si l'intervalle est trop court ou l'index baisse). */
function rythme(a: RelevePilotage, b: RelevePilotage, minJours: number): number | null {
    const jours = daysIn(a.date, b.date) - 1;
    if (jours < minJours || b.value < a.value) return null;
    return (b.value - a.value) / jours;
}

/** Relevé le plus proche d'une date, à la tolérance près. */
function proche(readings: RelevePilotage[], date: string, tolerance: number): RelevePilotage | null {
    let best: RelevePilotage | null = null;
    let dist = Infinity;
    for (const r of readings) {
        const d = Math.abs(Date.parse(r.date) - Date.parse(date)) / 86_400_000;
        if (d <= tolerance && d < dist) { best = r; dist = d; }
    }
    return best;
}

export function alertesCompteur(m: CompteurSuivi, relevesBruts: RelevePilotage[], today: string, seuils = SEUILS): Alerte[] {
    const base = { meterId: m.id, code: m.code, site: m.site, siteId: m.siteId, client: m.client };
    const out: Alerte[] = [];
    const readings = [...relevesBruts].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const unite = m.unit ?? '';
    const enService = m.status !== 'off';

    // Anomalies d'index des douze derniers mois (les plus anciennes ont été traitées ou sont sans objet).
    const depuisUnAn = addDays(today, -365);
    // Relevés contradictoires le même jour.
    for (let i = 1; i < readings.length; i++) {
        const [a, b] = [readings[i - 1], readings[i]];
        if (b.date >= depuisUnAn && a.date === b.date && a.value !== b.value) {
            out.push({ ...base, type: 'doublon', gravite: 'attention', date: b.date, message: `Deux relevés le ${fr(b.date)} : ${n(a.value)} et ${n(b.value)} ${unite}.` });
        }
    }
    // Index en baisse (un relevé « corrigé » peut légitimement baisser : changement ou remise à zéro tracés).
    for (let i = 1; i < readings.length; i++) {
        const [a, b] = [readings[i - 1], readings[i]];
        if (b.date >= depuisUnAn && a.date !== b.date && b.value < a.value && b.type !== 'CORRIGE') {
            out.push({ ...base, type: 'index_baisse', gravite: 'critique', date: b.date, message: `Index en baisse : ${n(a.value)} le ${fr(a.date)} puis ${n(b.value)} le ${fr(b.date)} (compteur changé, remis à zéro, ou erreur de saisie ?).` });
        }
    }

    const last = readings[readings.length - 1];
    if (enService) {
        if (!last) out.push({ ...base, type: 'sans_releve', gravite: 'attention', date: today, message: 'Aucun relevé.' });
        else {
            const age = daysIn(last.date, today) - 1;
            if (age > seuils.sansReleveJours) out.push({ ...base, type: 'sans_releve', gravite: 'attention', date: last.date, message: `Sans relevé depuis ${age} jours (dernier le ${fr(last.date)}).` });
        }
    }
    // ECS au relevé : le mois échu doit avoir son relevé.
    if (m.ecsAuReleve) {
        const moisEchu = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
        if (!readings.some(r => r.date.slice(0, 7) === moisEchu)) {
            out.push({ ...base, type: 'releve_ecs_manquant', gravite: 'critique', date: today, message: `Relevé de ${moisEchu.slice(5)}/${moisEchu.slice(0, 4)} manquant : la facture ECS au relevé de ce mois est bloquée.` });
        }
    }
    if (last && last.type === 'ESTIME' && daysIn(last.date, today) - 1 > seuils.estimeJours) {
        out.push({ ...base, type: 'estime', gravite: 'info', date: last.date, message: `Dernier relevé estimé (${fr(last.date)}), pas encore remplacé par un relevé réel.` });
    }

    // Dérive : dernier intervalle comparé à l'an passé, sinon à la médiane des intervalles précédents.
    if (readings.length >= 2) {
        const b = readings[readings.length - 1];
        const a = readings[readings.length - 2];
        const actuel = rythme(a, b, seuils.intervalleMinJours);
        if (actuel !== null) {
            let reference: number | null = null;
            let libelle = '';
            const a1 = proche(readings, addDays(a.date, -365), seuils.toleranceAnPasseJours);
            const b1 = proche(readings, addDays(b.date, -365), seuils.toleranceAnPasseJours);
            if (a1 && b1 && a1 !== b1) {
                reference = rythme(a1, b1, seuils.intervalleMinJours);
                libelle = `même période l'an passé (${fr(a1.date)} → ${fr(b1.date)})`;
            }
            if (reference === null) {
                const passes: number[] = [];
                for (let i = 1; i < readings.length - 1; i++) {
                    const r = rythme(readings[i - 1], readings[i], seuils.intervalleMinJours);
                    if (r !== null) passes.push(r);
                }
                if (passes.length >= 3) {
                    const tri = passes.slice(-6).sort((x, y) => x - y);
                    reference = tri[Math.floor(tri.length / 2)];
                    libelle = `médiane des ${tri.length} intervalles précédents`;
                }
            }
            if (reference !== null && reference > 0) {
                const ratio = actuel / reference;
                if (ratio > seuils.facteurHaut || ratio < seuils.facteurBas) {
                    out.push({
                        ...base, type: 'derive', gravite: 'attention', date: b.date,
                        message: `Consommation ${ratio > 1 ? 'en hausse' : 'en baisse'} : ${n(actuel)} ${unite}/jour du ${fr(a.date)} au ${fr(b.date)}, `
                            + `× ${n(ratio)} par rapport à la ${libelle} (${n(reference)} ${unite}/jour).`,
                    });
                }
            }
        }
    }

    // Consommation nulle durable (ECS : il y a toujours de l'eau chaude consommée).
    if (enService && m.usage === 'ecs' && last) {
        const debut = [...readings].reverse().find(r => r.value !== last.value);
        const depuis = debut ? readings[readings.indexOf(debut) + 1] : readings[0];
        if (depuis && depuis !== last && daysIn(depuis.date, last.date) - 1 >= seuils.nulleJours) {
            out.push({ ...base, type: 'conso_nulle', gravite: 'info', date: last.date, message: `Aucune consommation depuis le ${fr(depuis.date)} (index ${n(last.value)} ${unite} inchangé).` });
        }
    }
    return out;
}

const ORDRE: Record<Gravite, number> = { critique: 0, attention: 1, info: 2 };
export const trierAlertes = (alertes: Alerte[]) => [...alertes].sort((a, b) => ORDRE[a.gravite] - ORDRE[b.gravite] || b.date.localeCompare(a.date) || a.code.localeCompare(b.code));
