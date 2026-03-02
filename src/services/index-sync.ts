import { getIndices, createIndex, getIndexValues, createIndexValue, updateIndex, updateIndexValue } from './firestore';
import { indexFetchers } from '@/lib/indices/registry';
import { Index, IndexValue } from '@/lib/types';

export interface SyncStats {
    totalIndices: number;
    newIndices: number;
    newValues: number;
    errors: string[];
}

export async function syncAllIndices(): Promise<SyncStats> {
    const stats: SyncStats = {
        totalIndices: indexFetchers.length,
        newIndices: 0,
        newValues: 0,
        errors: []
    };

    console.log(`Sync Service: Starting sync for ${indexFetchers.length} indices`);

    let existingIndices: Index[] = [];
    let existingValues: IndexValue[] = [];

    try {
        existingIndices = await getIndices();
        existingValues = await getIndexValues();
        console.log(`Sync Service: Found ${existingIndices.length} existing indices and ${existingValues.length} values`);
    } catch (dbError: any) {
        console.error('Sync Service: Database error while fetching initial data:', dbError);
        throw new Error(`Database error: ${dbError.message}`);
    }

    for (const fetcher of indexFetchers) {
        console.log(`Sync Service: Syncing ${fetcher.code}...`);
        try {
            // 1. Fetch data
            const results = await fetcher.fetch();
            console.log(`Sync Service: ${fetcher.code} fetched ${results.length} results`);

            // 2. Ensure index exists
            let index = existingIndices.find(i => i.code === fetcher.code);
            if (!index) {
                console.log(`Sync Service: Creating missing index ${fetcher.code}`);
                index = await createIndex({
                    code: fetcher.code,
                    label: `Indice ${fetcher.code} (Auto)`,
                    unit: fetcher.code === 'PEG' ? '€/MWh' : 'Index',
                    active: true,
                    decimals: 2,
                    description: `Dernière synchronisation automatique le ${new Date().toLocaleDateString()}`
                });
                if (!index || !index.id) {
                    throw new Error(`Failed to create index ${fetcher.code}`);
                }
                stats.newIndices++;
                existingIndices.push(index!);
            } else if (index.decimals === undefined) {
                // Patch existing index if decimals property is missing
                console.log(`Sync Service: Patching decimals for index ${fetcher.code}`);
                await updateIndex(index.id, { decimals: 2 });
                index.decimals = 2;
            }


            // 3. Save new values (create or update if value changed)
            let newValuesForIndex = 0;
            for (const res of results) {
                if (!index!.id || !res.period || isNaN(res.value)) continue;

                const existing = existingValues.find(v =>
                    v.indexId === index!.id && v.period === res.period
                );

                if (!existing) {
                    await createIndexValue({
                        indexId: index!.id,
                        period: res.period,
                        value: res.value,
                        source: res.source,
                        comment: 'Synchronisation automatique'
                    });
                    stats.newValues++;
                    newValuesForIndex++;
                    existingValues.push({ indexId: index!.id, period: res.period, value: res.value, source: res.source, comment: 'Synchronisation automatique', id: 'temp' });
                } else if (existing.value !== res.value) {
                    await updateIndexValue(existing.id, { value: res.value, source: res.source });
                    stats.newValues++;
                    newValuesForIndex++;
                    existing.value = res.value;
                }
            }
            console.log(`Sync Service: ${fetcher.code} sync complete (+${newValuesForIndex} values)`);
        } catch (error: any) {
            console.error(`Sync Service: Error syncing ${fetcher.code}:`, error);
            stats.errors.push(`${fetcher.code}: ${error.message}`);
        }
    }

    return stats;
}
