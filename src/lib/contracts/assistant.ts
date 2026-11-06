import type { Client, ExtractContractInfoOutput } from '@/lib/types';

/**
 * Assistant de création de contrat (logique pure) : brouillon, contrôles par étape, doublons de client, reprise d'une
 * lecture de PDF. L'écriture (client, contrat, sites, prestations) est faite par le serveur
 * (services/contrat-assistant-admin).
 */

export const ETAPES = ['source', 'client', 'contrat', 'sites', 'prestations', 'recapitulatif'] as const;
export type Etape = typeof ETAPES[number];
export const LIBELLES_ETAPES: Record<Etape, string> = {
    source: 'Source', client: 'Client', contrat: 'Contrat', sites: 'Sites', prestations: 'Prestations', recapitulatif: 'Récapitulatif',
};

export type NouveauClient = {
    name: string; clientType: 'private' | 'public'; typologyId: string; companyId: string; agencyId: string; sectorId: string;
    address: string; postalCode: string; city: string; siret: string; representedBy: string;
    contactFacturation: { name: string; email: string; phone: string };
};

export type NouveauSite = { cle: string; name: string; address: string; postalCode: string; city: string };

export type LignePrestation = {
    /** Site (clé du brouillon pour un nouveau site, identifiant pour un site existant) × activité. */
    site: string; activityId: string;
    montant: string; scheduleId: string; termId: string; vatRateId: string; startDate: string;
};

export type Brouillon = {
    source: 'saisie' | 'pdf-prive' | 'pdf-public';
    /** Champs lus dans le PDF (à vérifier) : « client.name », « contrat.startDate »… */
    lusDansPdf: string[];
    client: { mode: 'existant' | 'nouveau'; clientId: string; nouveau: NouveauClient };
    contrat: {
        label: string; startDate: string; endDate: string; marketType: '' | 'Marché Privé' | 'Marché Public'; activityIds: string[];
        invoicingType: 'multi-site' | 'global'; scheduleId: string; termId: string; vatRateId: string;
        renewal: boolean; tacitRenewal: boolean; renewalDuration: string; noticePeriod: string; billingManagerId: string;
    };
    /** Sites existants du client à rattacher (sans contrat) et nouveaux sites. */
    sites: { existants: string[]; nouveaux: NouveauSite[] };
    prestations: { saisir: boolean; lignes: LignePrestation[] };
};

export const brouillonVide = (clientId = ''): Brouillon => ({
    source: 'saisie', lusDansPdf: [],
    client: {
        mode: 'existant', clientId,
        nouveau: { name: '', clientType: 'private', typologyId: '', companyId: '', agencyId: '', sectorId: '', address: '', postalCode: '', city: '', siret: '', representedBy: '', contactFacturation: { name: '', email: '', phone: '' } },
    },
    contrat: {
        label: '', startDate: '', endDate: '', marketType: '', activityIds: [], invoicingType: 'multi-site', scheduleId: '', termId: '', vatRateId: '',
        renewal: false, tacitRenewal: true, renewalDuration: '', noticePeriod: '', billingManagerId: '',
    },
    sites: { existants: [], nouveaux: [] },
    prestations: { saisir: true, lignes: [] },
});

/** Le brouillon contient-il une saisie (proposé à la reprise) ? */
export const brouillonEntame = (b: Brouillon) =>
    !!(b.client.clientId || b.client.nouveau.name || b.contrat.label || b.contrat.startDate || b.sites.nouveaux.length || b.sites.existants.length);

const vide = (s: unknown) => String(s ?? '').trim() === '';
const jourValide = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const montantValide = (s: string) => /^\d+([.,]\d{1,2})?$/.test(String(s).replace(/\s/g, '')) && Number(String(s).replace(/\s/g, '').replace(',', '.')) > 0;
export const montantNombre = (s: string) => Number(String(s).replace(/\s/g, '').replace(',', '.'));

/** Erreurs bloquantes d'une étape (messages en clair). */
export function erreursEtape(e: Etape, b: Brouillon): string[] {
    const out: string[] = [];
    if (e === 'client') {
        if (b.client.mode === 'existant') { if (vide(b.client.clientId)) out.push('Choisissez le client.'); }
        else {
            const n = b.client.nouveau;
            if (vide(n.name)) out.push('Raison sociale du client obligatoire.');
            if (vide(n.typologyId)) out.push('Typologie obligatoire.');
            if (vide(n.companyId) || vide(n.agencyId) || vide(n.sectorId)) out.push('Société, agence et secteur obligatoires.');
            if (vide(n.address) || vide(n.postalCode) || vide(n.city)) out.push('Adresse complète obligatoire (adresse, code postal, ville).');
            if (!vide(n.postalCode) && !/^\d{5}$/.test(n.postalCode.trim())) out.push('Code postal : 5 chiffres.');
            if (n.clientType === 'public' && vide(n.siret)) out.push('SIRET obligatoire pour un client public.');
            if (!vide(n.siret) && !/^\d{14}$/.test(n.siret.replace(/\s/g, ''))) out.push('SIRET : 14 chiffres.');
            if (!vide(n.contactFacturation.email) && !/^\S+@\S+\.\S+$/.test(n.contactFacturation.email.trim())) out.push('E-mail du contact de facturation invalide.');
        }
    }
    if (e === 'contrat') {
        const c = b.contrat;
        if (vide(c.label)) out.push('Libellé du contrat obligatoire.');
        if (!jourValide(c.startDate)) out.push('Date de début obligatoire.');
        if (!jourValide(c.endDate)) out.push('Date de fin obligatoire.');
        if (jourValide(c.startDate) && jourValide(c.endDate) && c.endDate <= c.startDate) out.push('La date de fin doit être après la date de début.');
        if (!c.activityIds.length) out.push('Au moins une activité.');
    }
    if (e === 'sites') {
        if (!b.sites.existants.length && !b.sites.nouveaux.length) out.push('Au moins un site (sinon rien n\'est facturé).');
        b.sites.nouveaux.forEach((s, i) => {
            if (vide(s.name) || vide(s.address)) out.push(`Site ${i + 1} : nom et adresse obligatoires.`);
            if (!vide(s.postalCode) && !/^\d{5}$/.test(s.postalCode.trim())) out.push(`Site ${i + 1} : code postal à 5 chiffres.`);
        });
    }
    if (e === 'prestations' && b.prestations.saisir) {
        lignesPrestations(b).forEach(l => {
            if (vide(l.montant)) return; // ligne laissée vide : pas de prestation
            if (!montantValide(l.montant)) out.push('Montants annuels : nombres positifs (ex. 12000 ou 12 000,50).');
            if (vide(l.scheduleId) || vide(l.termId) || vide(l.vatRateId)) out.push('Chaque prestation renseignée doit avoir sa périodicité, son terme et sa TVA.');
            if (!jourValide(l.startDate)) out.push('Chaque prestation renseignée doit avoir une date de début.');
        });
    }
    return [...new Set(out)];
}

/** Brouillon prêt à envoyer : lignes de prestations recalculées (sites et activités en cours, valeurs saisies gardées). */
export const brouillonFinal = (b: Brouillon): Brouillon => ({ ...b, prestations: { ...b.prestations, lignes: b.prestations.saisir ? lignesPrestations(b) : [] } });

/** Toutes les erreurs, par étape (récapitulatif, création). */
export const erreursBrouillon = (b: Brouillon) =>
    Object.fromEntries(ETAPES.map(e => [e, erreursEtape(e, b)])) as Record<Etape, string[]>;

/** Lignes de prestations à proposer : site × activité du contrat, valeurs par défaut du contrat ; saisies conservées. */
export function lignesPrestations(b: Brouillon): LignePrestation[] {
    const sites = [...b.sites.existants, ...b.sites.nouveaux.map(s => s.cle)];
    return sites.flatMap(site => b.contrat.activityIds.map(activityId => {
        const deja = b.prestations.lignes.find(l => l.site === site && l.activityId === activityId);
        return deja ?? {
            site, activityId, montant: '', scheduleId: b.contrat.scheduleId, termId: b.contrat.termId, vatRateId: b.contrat.vatRateId, startDate: b.contrat.startDate,
        };
    }));
}

// ── Doublons de client ───────────────────────────────────────────────────────────────────────────────────────────

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Clients existants qui ressemblent au nouveau : même SIRET, ou même nom (au même code postal si renseigné). */
export function doublonsClient(n: Pick<NouveauClient, 'name' | 'siret' | 'postalCode'>, clients: Client[]): Client[] {
    const siret = n.siret.replace(/\s/g, '');
    const nom = norm(n.name);
    return clients.filter(c =>
        (siret.length === 14 && (c.siret ?? '').replace(/\s/g, '') === siret)
        || (nom.length >= 3 && norm(c.name) === nom && (!n.postalCode || !c.postalCode || c.postalCode === n.postalCode)));
}

// ── Lecture d'un PDF ─────────────────────────────────────────────────────────────────────────────────────────────

type Refs = { typologies: { id: string; name: string }[]; clients: Client[] };

/** Reprend la lecture d'un PDF dans le brouillon ; les champs remplis sont marqués « lus dans le PDF ». */
export function depuisExtraction(b: Brouillon, x: ExtractContractInfoOutput, refs: Refs): Brouillon {
    const lus: string[] = [];
    const prend = <T>(cle: string, v: T | undefined | null, defaut: T): T => {
        if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return defaut;
        lus.push(cle);
        return v;
    };
    const c = x.client ?? {};
    const typo = c.typologyName ? refs.typologies.find(t => norm(t.name).includes(norm(c.typologyName)) || norm(c.typologyName).includes(norm(t.name))) : undefined;
    const nouveau: NouveauClient = {
        ...b.client.nouveau,
        name: prend('client.name', c.name, b.client.nouveau.name),
        clientType: prend('client.clientType', c.clientType, b.client.nouveau.clientType),
        typologyId: typo ? (lus.push('client.typologyId'), typo.id) : b.client.nouveau.typologyId,
        address: prend('client.address', c.address, b.client.nouveau.address),
        postalCode: prend('client.postalCode', c.postalCode, b.client.nouveau.postalCode),
        city: prend('client.city', c.city, b.client.nouveau.city),
        siret: prend('client.siret', c.siret?.replace(/\s/g, ''), b.client.nouveau.siret),
        representedBy: prend('client.representedBy', c.representativeName, b.client.nouveau.representedBy),
        contactFacturation: {
            name: prend('client.contactFacturation.name', c.contactFacturation?.name, b.client.nouveau.contactFacturation.name),
            email: prend('client.contactFacturation.email', c.contactFacturation?.email, b.client.nouveau.contactFacturation.email),
            phone: prend('client.contactFacturation.phone', c.contactFacturation?.phone, b.client.nouveau.contactFacturation.phone),
        },
    };
    const existant = doublonsClient(nouveau, refs.clients)[0];
    const k = x.contrat ?? {};
    const contrat = {
        ...b.contrat,
        label: prend('contrat.label', k.label || k.objet || k.name, b.contrat.label),
        startDate: prend('contrat.startDate', /^\d{4}-\d{2}-\d{2}$/.test(k.startDate ?? '') ? k.startDate : undefined, b.contrat.startDate),
        endDate: prend('contrat.endDate', /^\d{4}-\d{2}-\d{2}$/.test(k.endDate ?? '') ? k.endDate : undefined, b.contrat.endDate),
        tacitRenewal: prend('contrat.tacitRenewal', k.tacitRenewal, b.contrat.tacitRenewal),
        noticePeriod: prend('contrat.noticePeriod', k.noticePeriod, b.contrat.noticePeriod),
        invoicingType: prend('contrat.invoicingType', k.invoicingType ?? c.invoicingType, b.contrat.invoicingType),
        activityIds: x.activityIds?.length ? (lus.push('contrat.activityIds'), [...new Set(x.activityIds)]) : b.contrat.activityIds,
        marketType: (b.source === 'pdf-public' ? 'Marché Public' : b.source === 'pdf-prive' ? 'Marché Privé' : b.contrat.marketType) as Brouillon['contrat']['marketType'],
    };
    const sitesLus = (x.sites ?? []).filter(s => s.name || s.address).map((s, i) => ({
        cle: `pdf-${i}`, name: s.name ?? '', address: s.address ?? '', postalCode: s.postalCode ?? '', city: s.city ?? '',
    }));
    if (sitesLus.length) lus.push('sites');
    return {
        ...b,
        lusDansPdf: [...new Set([...b.lusDansPdf, ...lus])],
        // Client déjà connu (même SIRET ou même nom) : on le propose plutôt que d'en créer un doublon.
        client: existant ? { mode: 'existant', clientId: existant.id, nouveau } : { mode: 'nouveau', clientId: '', nouveau },
        contrat,
        sites: { existants: b.sites.existants, nouveaux: sitesLus.length ? sitesLus : b.sites.nouveaux },
    };
}
