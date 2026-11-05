import 'server-only';
import type { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';

/** Appel planifié (Cloud Scheduler…) : en-tête `Authorization: Bearer <CRON_SECRET>`. */
export function isCronRequest(req: NextRequest): boolean {
    const secret = process.env.CRON_SECRET;
    const header = req.headers.get('authorization');
    if (!secret || !header) return false;
    const expected = Buffer.from(`Bearer ${secret}`);
    const received = Buffer.from(header);
    return expected.length === received.length && timingSafeEqual(expected, received);
}
