import { IMPORT_ENTITIES, type ImportField } from '@/lib/imports/definitions';
import { API_RESOURCES, API_RESOURCE_LABELS, type ApiResource } from '@/lib/api/scopes';

/**
 * Spécification OpenAPI 3.1 de l'API externe, générée depuis la description des imports :
 * les champs, formats et valeurs possibles sont ceux de l'import, sans double maintenance.
 */

const LIST_FILTERS: Record<ApiResource, Record<string, string>> = {
    clients: { siret: 'SIRET exact', relation: 'client ou prospect' },
    sites: { client: 'Code client (CLI-…)' },
    contacts: { client: 'Code client (CLI-…)' },
    meters: { site: 'Code site (SIT-…)' },
    readings: {
        meter: 'Code compteur (CPT-…)', site: 'Code site (SIT-…) : relevés de ses compteurs',
        from: 'Depuis cette date (incluse) : AAAA-MM-JJ (minuit, heure de Paris) ou ISO 8601', to: "Jusqu'à cette date (exclue)",
    },
};
const READ_ONLY_PROPS: Record<ApiResource, Record<string, object>> = {
    clients: {}, sites: {}, contacts: { id: { type: 'string', readOnly: true, description: 'Identifiant du contact.' } },
    meters: { unit: { type: 'string', readOnly: true, description: 'Unité (du type de compteur).' } },
    readings: {
        id: { type: 'string', readOnly: true, description: 'Identifiant du relevé.' },
        unit: { type: 'string', readOnly: true, description: 'Unité (celle du compteur).' },
        source: { type: 'string', readOnly: true, enum: ['MANUEL', 'IMPORT', 'API'], description: 'Origine du relevé.' },
        contract: { type: 'string', readOnly: true, description: 'Contrat du site à la création du relevé (CTN-…).' },
    },
};
/** Ressources désignées par leur identifiant (pas de code Zenergya). */
const BY_ID: ApiResource[] = ['contacts', 'readings'];

function schemaOf(f: ImportField): Record<string, unknown> {
    const description = [f.label, f.help].filter(Boolean).join(' — ');
    switch (f.type) {
        case 'number': return { type: 'number', ...(f.allowZero ? { minimum: 0 } : { exclusiveMinimum: 0 }), description };
        case 'date': return { type: 'string', examples: ['2025-01-31', '2025-01-31T08:30:00+01:00'], description };
        case 'boolean': return { type: 'boolean', description };
        case 'enum': return { type: 'string', enum: f.options!.map(o => o.value), description: `${description} (${f.options!.map(o => `${o.value} = ${o.label}`).join(', ')})` };
        case 'siret': return { type: 'string', pattern: '^\\d{14}$', description };
        case 'email': return { type: 'string', format: 'email', description };
        case 'postalCode': return { type: 'string', pattern: '^\\d{5}$', description };
        default: return { type: 'string', description };
    }
}

export function buildOpenApi(serverUrl: string) {
    const schemas: Record<string, unknown> = {
        Error: {
            type: 'object',
            properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} }, required: ['code', 'message'] } },
        },
        WriteResult: {
            type: 'object',
            properties: {
                summary: { type: 'object', properties: { created: { type: 'integer' }, updated: { type: 'integer' }, unchanged: { type: 'integer' }, errors: { type: 'integer' } } },
                results: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            index: { type: 'integer' }, status: { type: 'string', enum: ['created', 'updated', 'unchanged', 'error', 'ignored'] },
                            code: { type: 'string' }, id: { type: 'string' }, errors: { type: 'array', items: { type: 'string' } },
                            warnings: { type: 'array', items: { type: 'string' }, description: 'Avertissements (élément écrit), ex. index inférieur au relevé précédent.' },
                        },
                    },
                },
            },
        },
    };
    const paths: Record<string, unknown> = {};
    const errors = (codes: number[]) => Object.fromEntries(codes.map(c => [String(c), { description: ({ 400: 'Requête invalide', 401: 'Clé absente, invalide, révoquée ou expirée', 403: 'Droit non accordé', 404: 'Introuvable', 413: 'Trop volumineux', 422: 'Clé d\'idempotence réutilisée', 429: 'Limite de débit atteinte (voir Retry-After)' } as Record<number, string>)[c], content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }]));

    for (const resource of API_RESOURCES) {
        const entity = IMPORT_ENTITIES[resource];
        const name = resource[0].toUpperCase() + resource.slice(1);
        schemas[name] = {
            type: 'object',
            description: `${entity.description} Correspondance à l'écriture : ${entity.matching} Un champ absent ou vide conserve la valeur existante.`,
            properties: { ...Object.fromEntries(entity.fields.map(f => [f.key, schemaOf(f)])), ...READ_ONLY_PROPS[resource] },
        };
        const label = API_RESOURCE_LABELS[resource];
        paths[`/${resource}`] = {
            get: {
                summary: `${label} : liste`, tags: [label], security: [{ apiKey: [] }],
                description: `Droit requis : ${resource}:read. Pagination par curseur (nextCursor).`
                    + (resource === 'readings' ? ' Tri par date croissante.' : ''),
                parameters: [
                    { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
                    { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'nextCursor de la page précédente.' },
                    ...Object.entries(LIST_FILTERS[resource]).map(([n, d]) => ({ name: n, in: 'query', schema: { type: 'string' }, description: d })),
                ],
                responses: {
                    200: { description: 'Page', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: `#/components/schemas/${name}` } }, nextCursor: { type: ['string', 'null'] } } } } } },
                    ...errors([400, 401, 403, 429]),
                },
            },
            post: {
                summary: `${label} : création / mise à jour par lot (500 au plus)`, tags: [label], security: [{ apiKey: [] }],
                description: `Droit requis : ${resource}:write. Mêmes contrôles que l'import de fichiers. ${entity.matching} `
                    + 'En-tête Idempotency-Key recommandé : un envoi répété rend la même réponse sans rien réécrire.',
                parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string', maxLength: 200 } }],
                requestBody: { required: true, content: { 'application/json': { schema: { type: 'array', maxItems: 500, items: { $ref: `#/components/schemas/${name}` } } } } },
                responses: { 200: { description: 'Résultat par élément', content: { 'application/json': { schema: { $ref: '#/components/schemas/WriteResult' } } } }, ...errors([400, 401, 403, 413, 422, 429]) },
            },
        };
        paths[`/${resource}/{ref}`] = {
            get: {
                summary: `${label} : détail`, tags: [label], security: [{ apiKey: [] }],
                parameters: [{ name: 'ref', in: 'path', required: true, schema: { type: 'string' }, description: BY_ID.includes(resource) ? 'Identifiant' : 'Code Zenergya' }],
                responses: { 200: { description: 'Élément', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: `#/components/schemas/${name}` } } } } } }, ...errors([401, 403, 404, 429]) },
            },
        };
    }
    return {
        openapi: '3.1.0',
        info: {
            title: 'Zenergya — API externe', version: '1.0.0',
            description: 'Lecture et écriture des clients, sites, contacts, compteurs et relevés de compteurs. Authentification : en-tête '
                + '« Authorization: Bearer <clé> » (clé créée par un administrateur, droits par ressource). '
                + 'Limite de débit par clé (en-têtes X-RateLimit-*). Erreurs : { "error": { "code", "message", "details" } }.',
        },
        servers: [{ url: serverUrl }],
        components: { securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'zen_<préfixe>_<secret>' } }, schemas },
        paths,
    };
}
