// Relais de la démo (données simulées, émulateurs Firebase) : une seule adresse pour l'application et les émulateurs,
// pour l'aperçu Cloud Shell qui n'expose qu'une adresse https par port. Les appels du SDK Firebase du navigateur sont
// renvoyés vers l'émulateur concerné, tout le reste vers l'application (next start), en-têtes inchangés.
//   node scripts/demo/relais.mjs   (PORT=3100, APP=3101 par défaut)
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 3100);
const CIBLES = [
    // Authentification (émulateur Auth)
    [/^\/(identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|emulator\/)/, 9099],
    // Firestore (canaux d'écoute et d'écriture, requêtes REST)
    [/^\/(google\.firestore\.v1\.Firestore\/|v1\/projects\/)/, 8080],
    // Stockage (téléversement, téléchargement)
    [/^\/(v0\/b\/|upload\/storage\/)/, 9199],
];
const APP = Number(process.env.APP ?? 3101);

const serveur = http.createServer((req, res) => {
    const port = CIBLES.find(([re]) => re.test(req.url ?? '/'))?.[1] ?? APP;
    const vers = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers: port === APP ? req.headers : { ...req.headers, host: `127.0.0.1:${port}` } }, r => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
    });
    vers.on('error', e => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end(`Relais : ${port} injoignable (${e.message})`); });
    req.pipe(vers);
});
serveur.keepAliveTimeout = 120_000;
serveur.listen(PORT, () => console.log(`Relais démo prêt sur le port ${PORT} (application : ${APP})`));
