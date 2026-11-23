// Commandes d'achat : seuils, étapes, droits de valider, décisions, engagé et réel : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    autovalidationDe, controleSeuils, decider, engagements, etapeEnCours, etapesPour, libelleEtape, peutDecider, plafondDe, totalCommande, type Commande, type EtapeValidation, type Hierarchie, type LigneCommande,
} from '../src/lib/commandes';

const S = { auto: 500, n2: 5000, achats: 10000 };
// La directrice, en haut de la hiérarchie, a un plafond de validation élevé ; les autres ont ceux de la société.
const U: Hierarchie[] = [{ id: 'tech', name: 'Technicien', managerId: 'chef' }, { id: 'chef', name: 'Chef de secteur', managerId: 'dir' }, { id: 'dir', name: 'Directrice', managerId: null, validationLimit: 50000 }, { id: 'ach', name: 'Acheteuse' }];
const circuit = (total: number, demandeur = U[0], utilisateurs = U, seuils = S) => { const e = etapesPour(total, seuils, demandeur, utilisateurs); return typeof e === 'string' ? e : e.map(x => `${x.role}:${x.approverId ?? '*'}`).join(' '); };
const texte = (x: string) => x.replace(/[\u202f\u00a0]/g, ' ');

test('valeurs par défaut de la société : autovalidation, N+1 toujours, montée au N+2 si le plafond du N+1 ne suffit pas, achats', () => {
    assert.deepEqual([circuit(500), circuit(500.01), circuit(5000), circuit(5000.01), circuit(10000.01)], ['', 'n1:chef', 'n1:chef', 'n1:chef n2:dir', 'n1:chef n2:dir achats:*']);
    // Le plafond de chaque valideur est gardé sur l'étape.
    const e = etapesPour(8000, S, U[0], U);
    assert.ok(typeof e !== 'string');
    assert.deepEqual(e.map(x => [x.role, x.approverName, x.plafond]), [['n1', 'Chef de secteur', 5000], ['n2', 'Directrice', 50000]]);
    assert.deepEqual([libelleEtape('n1'), libelleEtape('n2'), libelleEtape('n3'), libelleEtape('achats')], ['Responsable (N+1)', 'Responsable N+2', 'Responsable N+3', 'Achats']);
    assert.equal(controleSeuils(S), null);
    assert.match(String(controleSeuils({ auto: 1000, n2: 500, achats: 0 })), /plafond de validation par défaut/);
    assert.equal(totalCommande([{ quantity: 3, unitPrice: 19.99 }, { quantity: 1, unitPrice: 0.335 }]), 60.31);
});

test('par utilisateur : montant d\'autovalidation et plafond de validation propres ; zéro est une vraie valeur', () => {
    const avec = (id: string, plus: object) => U.map(u => (u.id === id ? { ...u, ...plus } : u));
    // Autovalidation propre au demandeur : plus haute, plus basse, nulle.
    assert.deepEqual([circuit(1500, { ...U[0], autoValidationLimit: 2000 }), circuit(2000.01, { ...U[0], autoValidationLimit: 2000 }), circuit(300, { ...U[0], autoValidationLimit: 100 }), circuit(10, { ...U[0], autoValidationLimit: 0 })], ['', 'n1:chef', 'n1:chef', 'n1:chef']);
    assert.deepEqual([autovalidationDe({ autoValidationLimit: 2000 }, S), autovalidationDe({}, S), autovalidationDe({ autoValidationLimit: null }, S), plafondDe({ validationLimit: 0 }, S), plafondDe({}, S)], [2000, 500, 500, 0, 5000]);
    // Plafond du N+1 relevé : il suffit seul. Abaissé à zéro : il valide quand même, puis la commande monte.
    assert.deepEqual([circuit(8000, U[0], avec('chef', { validationLimit: 20000 })), circuit(600, U[0], avec('chef', { validationLimit: 0 }))], ['n1:chef', 'n1:chef n2:dir']);
    // Trois niveaux : la commande monte jusqu'au premier plafond suffisant.
    const trois = [...avec('dir', { validationLimit: 8000, managerId: 'pdg' }), { id: 'pdg', name: 'Présidente', validationLimit: 1000000 }];
    assert.deepEqual([circuit(7000, U[0], trois), circuit(9000, U[0], trois), circuit(60000, U[0], trois)], ['n1:chef n2:dir', 'n1:chef n2:dir n3:pdg', 'n1:chef n2:dir n3:pdg achats:*']);
    // Seuil global des achats : il s'applique même à une commande que la hiérarchie n'a pas à valider.
    assert.equal(circuit(15000, { ...U[0], autoValidationLimit: 20000 }), 'achats:*');
    assert.equal(circuit(3000, U[0], U, { auto: 500, n2: 5000, achats: 2000 }), 'n1:chef achats:*');
});

test('hiérarchie incomplète : responsable manquant, personne avec un plafond suffisant, boucle — la soumission est refusée avec un message', () => {
    assert.match(circuit(800, { id: 'x', name: 'Sans chef' }), /Responsable \(N\+1\) de Sans chef non renseigné/);
    // La directrice valide jusqu'à 50 000 € et n'a pas de responsable.
    assert.match(texte(circuit(60000)), /Aucun valideur n'a un plafond suffisant pour 60 000,00 € : Directrice, en haut de la hiérarchie, valide jusqu'à 50 000,00 €/);
    // Commande du chef : sa responsable est la directrice (N+1), seule.
    assert.deepEqual([circuit(8000, U[1]), /Aucun valideur/.test(circuit(80000, U[1]))], ['n1:dir', true]);
    // Hiérarchie en boucle (A → B → A) : pas de boucle sans fin.
    const boucle = [{ id: 'a', name: 'A', managerId: 'b' }, { id: 'b', name: 'B', managerId: 'a' }];
    assert.match(circuit(9000, boucle[0], boucle), /Aucun valideur n'a un plafond suffisant/);
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
