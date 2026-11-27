import test from 'node:test';
import assert from 'node:assert/strict';
import { datePublication, estProvisoire } from '../src/lib/indices/publication';

test('date de publication : celle de la source pour la valeur la plus récente, sinon le jour de lecture ; historique : inconnue', () => {
    assert.deepEqual(datePublication('2026-09', '2026-09', '2026-11-13', '2026-11-27'), { publicationDate: '2026-11-13', origine: 'source' });
    assert.deepEqual(datePublication('2026-09', '2026-09', '2026-11-13T08:45:00', '2026-11-27'), { publicationDate: '2026-11-13', origine: 'source' });
    // Source sans date (CEE, PEG) ou date illisible / future : le jour où la synchronisation voit la valeur.
    assert.deepEqual(datePublication('2026-10', '2026-10', undefined, '2026-11-27'), { publicationDate: '2026-11-27', origine: 'detection' });
    assert.deepEqual(datePublication('2026-10', '2026-10', 'hier', '2026-11-27'), { publicationDate: '2026-11-27', origine: 'detection' });
    assert.deepEqual(datePublication('2026-10', '2026-10', '2026-12-01', '2026-11-27'), { publicationDate: '2026-11-27', origine: 'detection' });
    // Reprise d'historique : les périodes plus anciennes n'ont pas de date connue.
    assert.equal(datePublication('2026-08', '2026-09', '2026-11-13', '2026-11-27'), null);
});

test('statut INSEE : définitive ou provisoire', () => {
    assert.equal(estProvisoire('DEF'), false);
    assert.equal(estProvisoire('def'), false);
    assert.equal(estProvisoire('P'), true);
    assert.equal(estProvisoire('SD'), true);
    assert.equal(estProvisoire(undefined), false);
});

test('lecture INSEE : date de mise à jour de la série et statut de chaque valeur (réponse SDMX type)', async () => {
    const { createInseeFetcher } = await import('../src/lib/indices/fetchers/insee');
    const xml = `<?xml version='1.0'?><message:StructureSpecificData xmlns:message="m"><message:DataSet><Series IDBANK="001565183" FREQ="M" LAST_UPDATE="2026-09-15"><Obs TIME_PERIOD="2026-06" OBS_VALUE="148.5" OBS_STATUS="A" OBS_QUAL="P" OBS_TYPE="A"/><Obs TIME_PERIOD="2026-05" OBS_VALUE="148.3" OBS_STATUS="A" OBS_QUAL="DEF" OBS_TYPE="A"/></Series></message:DataSet></message:StructureSpecificData>`;
    const avant = globalThis.fetch;
    let url = '';
    globalThis.fetch = (async (u: string) => { url = u; return new Response(xml, { status: 200 }); }) as typeof fetch;
    try {
        const r = await createInseeFetcher('ICHT-TS', '001565183').fetch();
        assert.doesNotMatch(url, /detail=dataonly/);
        assert.deepEqual(r.map(x => [x.period, x.value, x.publishedAt, x.provisoire]), [['2026-06', 148.5, '2026-09-15', true], ['2026-05', 148.3, '2026-09-15', false]]);
    } finally { globalThis.fetch = avant; }
});
