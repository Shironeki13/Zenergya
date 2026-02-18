import { getIndices, createIndex, getIndexValues, createIndexValue } from './firestore';
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

    const existingIndices = await getIndices();
    const existingValues = await getIndexValues();

    for (const fetcher of indexFetchers) {
        try {
            // 1. Fetch data
            const results = await fetcher.fetch();

            // 2. Ensure index exists
            let index = existingIndices.find(i => i.code === fetcher.code);
            if (!index) {
                console.log(`Creating missing index: ${fetcher.code}`);
                index = await createIndex({
                    code: fetcher.code,
                    label: `Indice ${fetcher.code} (Auto)`,
                    unit: '€/MWh',
                    active: true,
                    description: `Dernière synchronisation automatique le ${new Date().toLocaleDateString()}`
                });
                if (!index || !index.id) {
                    throw new Error(`Failed to create index ${fetcher.code}`);
                }
                stats.newIndices++;
                existingIndices.push(index!);
            }


            // 3. Save new values
            for (const res of results) {
                const alreadyExists = existingValues.some(v =>
                    v.indexId === index!.id &&
                    v.period === res.period
                );

                if (!alreadyExists) {
                    const newValue: Omit<IndexValue, 'id'> = {
                        indexId: index!.id,
                        period: res.period,
                        value: res.value,
                        source: res.source,
                        comment: 'Synchronisation automatique'
                    };

                    console.log(`Adding value: ${index!.code} ${res.period} = ${res.value}`);

                    // Final defensive check against undefined/NaN
                    if (!newValue.indexId || !newValue.period || isNaN(newValue.value)) {
                        console.warn('Skipping invalid value:', newValue);
                        continue;
                    }

                    await createIndexValue(newValue);
                    stats.newValues++;
                    existingValues.push({ ...newValue, id: 'temp' } as IndexValue);
                }

            }
        } catch (error: any) {
            console.error(`Error syncing index ${fetcher.code}:`, error);
            stats.errors.push(`${fetcher.code}: ${error.message}`);
        }
    }

    return stats;
}
