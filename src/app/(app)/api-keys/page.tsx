'use client';

import { useConfirm } from '@/components/confirm-provider';
import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Loader2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import { NumberField } from '@/components/quotes/number-field';
import { API_RESOURCES, API_RESOURCE_LABELS, type ApiScope } from '@/lib/api/scopes';
import { createApiKeyAction, listApiKeysAction, recentApiLogsAction, revokeApiKeyAction } from '@/lib/api/actions';

type Keys = Extract<Awaited<ReturnType<typeof listApiKeysAction>>, { success: true }>['data'];
type Logs = Extract<Awaited<ReturnType<typeof recentApiLogsAction>>, { success: true }>['data'];
const frDateTime = (d?: string) => (d ? new Date(d).toLocaleString('fr-FR') : '—');

export default function ApiKeysPage() {
    const confirmer = useConfirm();
    const { toast } = useToast();
    const { isAdmin } = useData();
    const [keys, setKeys] = useState<Keys>([]);
    const [logs, setLogs] = useState<Logs>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState<{ name: string; scopes: ApiScope[]; expiresAt: string; rate: number | null }>({ name: '', scopes: [], expiresAt: '', rate: 120 });
    const [newKey, setNewKey] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const [k, l] = await Promise.all([listApiKeysAction(), recentApiLogsAction()]);
        if (k.success) setKeys(k.data);
        if (l.success) setLogs(l.data);
        setLoading(false);
    }, []);
    useEffect(() => { if (isAdmin) load(); else setLoading(false); }, [isAdmin, load]);

    if (!isAdmin) return <p className="text-muted-foreground">Réservé aux administrateurs.</p>;
    if (loading) return <Loader2 className="mx-auto mt-24 h-8 w-8 animate-spin" />;

    const toggle = (scope: ApiScope) => setForm(f => ({ ...f, scopes: f.scopes.includes(scope) ? f.scopes.filter(s => s !== scope) : [...f.scopes, scope] }));

    const create = async () => {
        setBusy(true);
        const result = await createApiKeyAction({ name: form.name, scopes: form.scopes, expiresAt: form.expiresAt || undefined, rateLimitPerMinute: form.rate ?? undefined });
        setBusy(false);
        if (!result.success) { toast({ title: 'Création impossible', description: result.error, variant: 'destructive' }); return; }
        setCreating(false);
        setNewKey(result.data.key);
        setForm({ name: '', scopes: [], expiresAt: '', rate: 120 });
        load();
    };

    const origin = typeof window !== 'undefined' ? window.location.origin : '';

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Accès API</h1>
                    <p className="text-muted-foreground">
                        Clés des systèmes externes autorisés à lire ou écrire des données. Documentation :{' '}
                        <a className="underline" href="/api/v1/openapi.json" target="_blank" rel="noopener noreferrer">spécification OpenAPI</a>.
                    </p>
                </div>
                <Button onClick={() => setCreating(true)}><Plus className="mr-2 h-4 w-4" />Nouvelle clé</Button>
            </div>

            <Card>
                <CardHeader><CardTitle className="text-base">Clés</CardTitle></CardHeader>
                <CardContent>
                    {keys.length === 0 ? <p className="text-sm text-muted-foreground">Aucune clé.</p> : (
                        <Table>
                            <TableHeader><TableRow>
                                <TableHead>Système</TableHead><TableHead>Préfixe</TableHead><TableHead>Droits</TableHead><TableHead>Débit</TableHead>
                                <TableHead>Expiration</TableHead><TableHead>Dernier appel</TableHead><TableHead>Statut</TableHead><TableHead />
                            </TableRow></TableHeader>
                            <TableBody>
                                {keys.map(k => {
                                    const expired = !!k.expiresAt && k.expiresAt < new Date().toISOString().slice(0, 10);
                                    return (
                                        <TableRow key={k.id} className={k.active && !expired ? '' : 'text-muted-foreground'}>
                                            <TableCell>{k.name}<span className="block text-xs text-muted-foreground">créée le {frDateTime(k.createdAt)}{k.createdBy ? ` par ${k.createdBy}` : ''}</span></TableCell>
                                            <TableCell className="font-mono text-xs">zen_{k.prefix}_…</TableCell>
                                            <TableCell><div className="flex flex-wrap gap-1">{k.scopes.map(s => <Badge key={s} variant="outline" className="font-mono text-[10px]">{s}</Badge>)}</div></TableCell>
                                            <TableCell className="text-sm">{k.rateLimitPerMinute}/min</TableCell>
                                            <TableCell className="text-sm">{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString('fr-FR') : '—'}</TableCell>
                                            <TableCell className="text-sm">{frDateTime(k.lastUsedAt)}</TableCell>
                                            <TableCell>{!k.active ? <Badge variant="outline">Révoquée</Badge> : expired ? <Badge variant="outline">Expirée</Badge> : <Badge>Active</Badge>}</TableCell>
                                            <TableCell className="text-right">
                                                {k.active && (
                                                    <Button size="sm" variant="ghost" onClick={async () => {
                                                        if (!(await confirmer({ title: `Révoquer la clé « ${k.name} » ?`, description: "Le système qui l'utilise perdra l'accès immédiatement.", confirmLabel: 'Révoquer', destructive: true }))) return;
                                                        const r = await revokeApiKeyAction(k.id);
                                                        if (!r.success) toast({ title: 'Révocation impossible', description: r.error, variant: 'destructive' });
                                                        load();
                                                    }}>Révoquer</Button>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Derniers appels</CardTitle>
                    <CardDescription>50 derniers appels, toutes clés confondues.</CardDescription>
                </CardHeader>
                <CardContent>
                    {logs.length === 0 ? <p className="text-sm text-muted-foreground">Aucun appel.</p> : (
                        <Table>
                            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Clé</TableHead><TableHead>Requête</TableHead><TableHead>Statut</TableHead><TableHead className="text-right">Durée</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {logs.map(l => (
                                    <TableRow key={l.id}>
                                        <TableCell className="text-sm">{frDateTime(l.at)}</TableCell>
                                        <TableCell className="text-sm">{l.keyName ?? <span className="text-muted-foreground">non authentifié</span>}</TableCell>
                                        <TableCell className="font-mono text-xs">{l.method} {l.path}</TableCell>
                                        <TableCell><Badge variant={l.status < 400 ? 'secondary' : 'destructive'}>{l.status}{l.error ? ` ${l.error}` : ''}</Badge></TableCell>
                                        <TableCell className="text-right text-sm">{l.durationMs} ms</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Dialog open={creating} onOpenChange={setCreating}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Nouvelle clé d'API</DialogTitle>
                        <DialogDescription>Une clé par système externe ; accordez seulement les droits nécessaires.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-1"><Label htmlFor="k-name">Système *</Label>
                            <Input id="k-name" placeholder="ex. ERP achats, GTB, télérelève" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
                        <div className="space-y-2">
                            <Label>Droits</Label>
                            <table className="w-full text-sm">
                                <thead><tr className="text-xs text-muted-foreground"><th className="text-left font-normal" /><th className="font-normal">Lecture</th><th className="font-normal">Écriture</th></tr></thead>
                                <tbody>
                                    {API_RESOURCES.map(r => (
                                        <tr key={r}>
                                            <td className="py-1">{API_RESOURCE_LABELS[r]}</td>
                                            <td className="text-center"><Checkbox checked={form.scopes.includes(`${r}:read`)} onCheckedChange={() => toggle(`${r}:read`)} aria-label={`${r} lecture`} /></td>
                                            <td className="text-center"><Checkbox checked={form.scopes.includes(`${r}:write`)} onCheckedChange={() => toggle(`${r}:write`)} aria-label={`${r} écriture`} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1"><Label htmlFor="k-exp">Expiration (facultative)</Label>
                                <Input id="k-exp" type="date" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} /></div>
                            <div className="space-y-1"><Label>Appels par minute</Label>
                                <NumberField value={form.rate} onChange={v => setForm(f => ({ ...f, rate: v }))} /></div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreating(false)}>Annuler</Button>
                        <Button disabled={busy || !form.name.trim() || form.scopes.length === 0} onClick={create}>
                            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Créer la clé
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!newKey} onOpenChange={o => !o && setNewKey(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" />Clé créée</DialogTitle>
                        <DialogDescription>
                            Copiez-la maintenant et transmettez-la au système concerné par un canal sûr : <strong>elle ne sera plus jamais affichée</strong>
                            {' '}(seule son empreinte est conservée). En cas de perte, révoquez-la et créez-en une nouvelle.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex gap-2">
                        <Input readOnly className="font-mono text-xs" value={newKey ?? ''} onFocus={e => e.target.select()} />
                        <Button variant="outline" size="icon" aria-label="Copier" onClick={async () => {
                            await navigator.clipboard.writeText(newKey ?? '');
                            toast({ title: 'Clé copiée' });
                        }}><Copy className="h-4 w-4" /></Button>
                    </div>
                    <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{`curl -H "Authorization: Bearer ${newKey?.slice(0, 18) ?? ''}…" \\\n  ${origin}/api/v1/clients?limit=10`}</pre>
                    <DialogFooter><Button onClick={() => setNewKey(null)}>J'ai copié la clé</Button></DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
