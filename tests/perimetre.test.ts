// Périmètre d'un utilisateur : société, agence, secteur ; filtrage des collections ; modules : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERIMETRE_TOTAL, accesRoute, clientsDuPerimetre, dansPerimetre, estTotal, filtrerPerimetre, moduleDeRoute } from '../src/lib/perimetre';

const lyon = { companyIds: ['*'], agencyIds: ['ag-lyon'], sectorIds: ['*'] };
const lyonNord = { companyIds: ['zen'], agencyIds: ['ag-lyon'], sectorIds: ['se-ln'] };

test('règle : les trois axes se cumulent ; « * » ouvre un axe ; administrateur : tout ; rattachement incomplet : hors périmètre', () => {
    const c = (agencyId: string, sectorId: string, companyId = 'zen') => ({ companyId, agencyId, sectorId });
    assert.deepEqual([dansPerimetre(lyon, c('ag-lyon', 'se-ls')), dansPerimetre(lyon, c('ag-paris', 'se-p')), dansPerimetre(lyonNord, c('ag-lyon', 'se-ln')), dansPerimetre(lyonNord, c('ag-lyon', 'se-ls')), dansPerimetre(lyonNord, c('ag-lyon', 'se-ln', 'autre'))], [true, false, true, false, false]);
    assert.deepEqual([dansPerimetre(lyonNord, c('ag-paris', 'se-p'), true), dansPerimetre(PERIMETRE_TOTAL, {}), dansPerimetre(lyon, { companyId: 'zen' }), dansPerimetre(null, c('ag-lyon', 'se-ln')), dansPerimetre({ companyIds: [], agencyIds: [], sectorIds: [] }, c('ag-lyon', 'se-ln'))], [true, true, false, false, false]);
    assert.deepEqual([estTotal(PERIMETRE_TOTAL), estTotal(lyon), estTotal(undefined)], [true, false, false]);
});

const D = {
    clients: [{ id: 'c1', companyId: 'zen', agencyId: 'ag-lyon', sectorId: 'se-ln' }, { id: 'c2', companyId: 'zen', agencyId: 'ag-paris', sectorId: 'se-p' }],
    contracts: [{ id: 'k1', clientId: 'c1' }, { id: 'k2', clientId: 'c2' }, { id: 'k3' }],
    sites: [{ id: 's1', clientId: 'c1', contractId: 'k1' }, { id: 's2', contractId: 'k2' }, { id: 's3', contractId: 'k1' }],
    services: [{ id: 'p1', contractId: 'k1', siteId: 's1' }, { id: 'p2', contractId: 'k2', siteId: 's2' }, { id: 'p3', siteId: 's3' }],
    meters: [{ id: 'm1', siteId: 's1' }, { id: 'm2', siteId: 's2' }],
    contacts: [{ id: 'ct1', clientId: 'c1' }, { id: 'ct2', clientId: 'c2' }],
    activities: [{ id: 'P2' }],
};
const ids = (d: typeof D) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, (v as { id: string }[]).map(x => x.id).join()]));

test('filtrage : chaque objet suit son client (contrat, site, prestation, compteur, contact) ; référentiels intacts', () => {
    assert.deepEqual(ids(filtrerPerimetre(D, lyon)), { clients: 'c1', contracts: 'k1', sites: 's1,s3', services: 'p1,p3', meters: 'm1', contacts: 'ct1', activities: 'P2' });
    assert.equal(filtrerPerimetre(D, PERIMETRE_TOTAL), D);
    assert.equal(filtrerPerimetre(D, lyonNord, true), D);
    assert.deepEqual(ids(filtrerPerimetre(D, null)), { clients: '', contracts: '', sites: '', services: '', meters: '', contacts: '', activities: 'P2' });
    assert.deepEqual([...clientsDuPerimetre(D.clients, { companyIds: ['zen'], agencyIds: ['*'], sectorIds: ['se-p'] })], ['c2']);
});

test('modules : adresse → module ; administrateur : tout ; utilisateurs et clés API : administrateur seulement', () => {
    assert.deepEqual(['/dashboard', '/billing/suivi', '/clients/abc', '/contracts', '/admin/validations', '/invoices/x', '/billing/p1', '/meters', '/quotes/1', '/projects', '/timesheets', '/purchases/nouvelle', '/settings', '/imports', '/users', '/api-keys'].map(moduleDeRoute),
        [null, null, 'contracts', 'contracts', 'contracts', 'billing', 'billing', 'billing', 'works', 'works', 'works', 'purchases', 'settings', 'settings', 'admin', 'admin']);
    assert.deepEqual([accesRoute('/invoices', ['contracts'], false), accesRoute('/invoices', ['billing'], false), accesRoute('/dashboard', [], false), accesRoute('/users', ['settings'], false), accesRoute('/users', [], true), accesRoute('/purchases', undefined, false)], [false, true, true, false, true, false]);
});
