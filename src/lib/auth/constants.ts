// Partagé entre le middleware (edge), les routes serveur et le client.

/** Nom du cookie de session. `__session` est le seul cookie transmis par Firebase Hosting / App Hosting. */
export const SESSION_COOKIE = '__session';

/** Durée de vie du cookie de session (5 jours ; Firebase accepte entre 5 min et 14 jours). */
export const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;
