import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/constants';

/**
 * Premier filtre (edge) : sans cookie de session, les pages redirigent vers /login.
 * La vérification cryptographique du cookie et des droits est faite côté serveur
 * (routes API, server actions) et par les règles Firestore côté client.
 */
export function middleware(request: NextRequest) {
    if (request.cookies.has(SESSION_COOKIE)) {
        return NextResponse.next();
    }

    const loginUrl = new URL('/login', request.url);
    const target = request.nextUrl.pathname + request.nextUrl.search;
    if (target !== '/') loginUrl.searchParams.set('next', target);
    return NextResponse.redirect(loginUrl);
}

export const config = {
    // Tout sauf : /login, les routes API (protégées individuellement), les fichiers Next.js et statiques.
    matcher: ['/((?!login|api/|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)'],
};
