// Commandes d'achat : seuils, étapes, droits de valider, décisions, engagé et réel : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    controleSeuils, decider, engagements, etapeEnCours, etapesPour, peutDecider, rolesRequis, totalCommande, type Commande, type EtapeValidation, type LigneCommande,
} from '../src/lib/commandes';

const S = { auto: 500, n2: 5000, achats: 10000 };
const U = [{ id: 'tech', name: 'Technicien', managerId: 'chef' }, { id: 'chef', name: 'Chef de secteur', managerId: 'dir' }, { id: 'dir', name: 'Directrice', managerId: null }, { id: 'ach', name: 'Acheteuse' }];

test('seuils : autovalidation, N+1, N+2, achats ; contrôle des seuils', () => {
    assert.deepEqual([rolesRequis(500, S), rolesRequis(500.01, S), rolesRequis(5000, S), rolesRequis(5000.01, S), rolesRequis(10000.01, S)], [[], ['n1'], ['n1'], ['n1', 'n2'], ['n1', 'n2', 'achats']]);
    // Seuil achats inférieur au seuil N+2 : achats sans N+2.
    assert.deepEqual(rolesRequis(3000, { auto: 500, n2: 5000, achats: 2000 }), ['n1', 'achats']);
    assert.equal(controleSeuils(S), null);
    assert.match(String(controleSeuils({ auto: 1000, n2: 500, achats: 0 })), /N\+2/);
    assert.equal(totalCommande([{ quantity: 3, unitPrice: 19.99 }, { quantity: 1, unitPrice: 0.335 }]), 60.31);
});

test('étapes : valideurs d\'après la hiérarchie ; responsable manquant signalé', () => {
    const e = etapesPour(12000, S, U[0], U);
    assert.ok(typeof e !== 'string');
    assert.deepEqual(e.map(x => [x.role, x.approverId ?? null]), [['n1', 'chef'], ['n2', 'dir'], ['achats', null]]);
    assert.deepEqual(etapesPour(100, S, U[0], U), []);
    assert.match(String(etapesPour(800, S, { id: 'x', name: 'Sans chef' }, U)), /Responsable \(N\+1\) de Sans chef non renseigné/);
    assert.match(String(etapesPour(8000, S, U[1], U)), /Responsable N\+2 non renseigné/);   // la directrice n'a pas de responsable
});

const cmd = (etapes: EtapeValidation[]): Pick<Commande, 'status' | 'etapes' | 'requesterId'> => ({ status: 'a_valider', requesterId: 'tech', etapes });

test('droits : étapes dans l\'ordre, pas sa propre commande, achats réservés, administrateur en secours', () => {
    const c = cmd(etapesPour(12000, S, U[0], U) as EtapeValidation[]);
    assert.equal(etapeEnCours(c)!.role, 'n1');
    assert.deepEqual(peutDecider(c, { id: 'chef' }), { ok: true });
    assert.match(peutDecider(c, { id: 'dir' }).raison!, /à valider par Chef de secteur/);
    assert.match(peutDecider(c, { id: 'tech', isAdmin: true }).raison!, /propre commande/);
    assert.deepEqual(peutDecider(c, { id: 'admin', isAdmin: true }), { ok: true, secours: true });
    // N+1 puis N+2 validés : l'étape achats est ouverte aux acheteurs seulement.
    const r1 = decider(c, { id: 'chef', name: 'Chef' }, 'validee', '', '2026-11-10T10:00:00Z');
    assert.ok(typeof r1 !== 'string');
    assert.deepEqual([r1.status, r1.etapes[0].decision, r1.etapes[0].decideParNom], ['a_valider', 'validee', 'Chef']);
    const r2 = decider({ ...c, ...r1 }, { id: 'dir' }, 'validee', 'ok', '2026-11-10T11:00:00Z');
    assert.ok(typeof r2 !== 'string');
    assert.match(peutDecider({ ...c, ...r2 }, { id: 'dir' }).raison!, /réservée aux achats/);
    const r3 = decider({ ...c, ...r2 }, { id: 'ach', isAcheteur: true }, 'validee', '', '2026-11-10T12:00:00Z');
    assert.ok(typeof r3 !== 'string');
    assert.equal(r3.status, 'validee');
});

test('refus : motif obligatoire, la commande est refusée ; rien à décider ensuite', () => {
    const c = cmd(etapesPour(800, S, U[0], U) as EtapeValidation[]);
    assert.match(String(decider(c, { id: 'chef' }, 'refusee', ' ', '')), /Motif du refus/);
    const r = decider(c, { id: 'chef' }, 'refusee', 'Hors budget', '2026-11-10T10:00:00Z');
    assert.ok(typeof r !== 'string');
    assert.deepEqual([r.status, r.etapes[0].commentaire], ['refusee', 'Hors budget']);
    assert.match(peutDecider({ ...c, ...r }, { id: 'chef' }).raison!, /Aucune validation en attente/);
});

test('engagé, réel et en cours de validation, par nature', () => {
    const l = (nature: LigneCommande['nature'], total: number, projectId = 'p'): LigneCommande => ({ id: `${nature}${total}`, label: 'x', quantity: 1, unitPrice: total, total, nature, cible: { type: 'affaire', projectId } });
    const commandes = [
        { status: 'recue' as const, totalHT: 1000, lines: [l('FOURNITURE', 600), l('SOUS_TRAITANCE', 400)], factures: [{ id: 'f', numero: 'F1', date: '2026-11-01', montantHT: 900, saisiLe: '' }] },
        { status: 'validee' as const, totalHT: 250, lines: [l('FOURNITURE', 250)] },
        { status: 'a_valider' as const, totalHT: 3000, lines: [l('SOUS_TRAITANCE', 3000)] },
        { status: 'refusee' as const, totalHT: 99, lines: [l('DIVERS', 99)] },
        { status: 'recue' as const, totalHT: 70, lines: [l('DIVERS', 70, 'autre')] },
    ];
    const e = engagements(commandes, x => x.cible.type === 'affaire' && x.cible.projectId === 'p');
    assert.deepEqual(e.FOURNITURE, { engage: 850, reel: 540, enValidation: 0 });
    assert.deepEqual(e.SOUS_TRAITANCE, { engage: 400, reel: 360, enValidation: 3000 });
    assert.deepEqual([e.DIVERS.engage, e.total], [0, { engage: 1250, reel: 900, enValidation: 3000 }]);
});
