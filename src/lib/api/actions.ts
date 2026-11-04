'use server';

import { requireAdmin } from '@/lib/auth/server';
import { createApiKey, listApiKeys, recentApiLogs, revokeApiKey, type ApiKeyRecord, type ApiLogEntry } from '@/services/api-admin';

/** Administration des clés de l'API externe (administrateurs uniquement). */

type Result<T> = { success: true; data: T } | { success: false; error: string };

async function run<T>(action: (by: string) => Promise<T>): Promise<Result<T>> {
    try {
        const user = await requireAdmin();
        return { success: true, data: await action(user.email) };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Action impossible.' };
    }
}

export async function listApiKeysAction(): Promise<Result<ApiKeyRecord[]>> {
    return run(() => listApiKeys());
}

/** La clé complète n'est rendue qu'à la création : elle ne pourra plus être affichée ensuite. */
export async function createApiKeyAction(input: { name: string; scopes: string[]; expiresAt?: string; rateLimitPerMinute?: number }):
    Promise<Result<{ record: ApiKeyRecord; key: string }>> {
    return run(by => createApiKey(input, by));
}

export async function revokeApiKeyAction(id: string): Promise<Result<null>> {
    return run(async by => { await revokeApiKey(id, by); return null; });
}

export async function recentApiLogsAction(): Promise<Result<(ApiLogEntry & { id: string })[]>> {
    return run(() => recentApiLogs(50));
}
