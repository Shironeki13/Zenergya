'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, AlarmClock, CheckCircle2, Loader2, MailWarning, Play, RefreshCw, RotateCcw, Save, TestTube2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { etatNotificationsAction, lancerRappelsAction, modifierNotificationsAction, type EtatNotifications } from '@/lib/notifications/actions';
import { BALISES, GROUPES_FAMILLE, LIBELLE_NATURE_DOCUMENT, NATURES, controlerModele, rendre, type Famille, type ModeleMail, type NatureDocument } from '@/lib/notifications/balises';
import { EVENEMENTS_DOCUMENT, FAMILLE_EVENEMENT, LIBELLE_EVENEMENT, LIBELLE_FAMILLE, LIBELLE_ROLE, ROLES_FAMILLE, contexteExemple, modeleDe, type Evenement, type ModeEnvoi, type RoleDestinataire } from '@/lib/notifications/modeles';
import type { Notification, StatutNotification } from '@/services/notifications-admin';

/**
 * Notifications par mail (administrateur) : réglages d'envoi, et pour chaque événement ses destinataires et son
 * modèle de mail. Un modèle s'écrit en texte avec des balises (« <<Numéro du contrat>> ») choisies dans une liste ;
 * il peut être propre à un type de document. L'aperçu se met à jour pendant la saisie. Le journal montre chaque mail
 * composé : en simulation, rien ne part.
 */

const MODE: Record<ModeEnvoi, { libelle: string; texte: string; classe: string }> = {
    simulation: { libelle: 'Simulation', texte: 'Les mails sont composés et journalisés, aucun ne part.', classe: 'border-amber-300 bg-amber-50 text-amber-900' },
    messagerie: { libelle: 'Envoi réel', texte: 'Les mails sont remis à la messagerie.', classe: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
    arret: { libelle: 'Arrêt', texte: 'Aucune notification n\'est composée.', classe: 'border-slate-300 bg-slate-50 text-slate-800' },
};
const STATUT: Record<StatutNotification, { libelle: string; classe: string }> = {
    simule: { libelle: 'Simulé', classe: 'border-amber-300 text-amber-800' }, a_envoyer: { libelle: 'À envoyer', classe: 'border-blue-300 text-blue-700' },
    envoye: { libelle: 'Envoyé', classe: 'border-emerald-300 text-emerald-700' }, echec: { libelle: 'Échec', classe: 'border-red-300 text-red-700' },
    sans_destinataire: { libelle: 'Sans destinataire', classe: 'border-red-300 text-red-700' },
};
const quand = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const TOUS = 'tous';

function Message({ sujet, html, destinataires, ecartes }: { sujet: string; html: string; destinataires?: string[]; ecartes?: Notification['ecartes'] }) {
    return (
        <div className="rounded-lg border bg-background">
            <div className="space-y-1 border-b px-4 py-3 text-sm">
                {destinataires && <p><span className="text-muted-foreground">À : </span>{destinataires.length ? destinataires.join(', ') : <span className="text-red-700">aucun destinataire</span>}</p>}
                {!!ecartes?.length && <p className="text-red-700"><span className="text-muted-foreground">Écartés : </span>{ecartes.map(e => `${e.adresse} (${e.motif})`).join(', ')}</p>}
                <p><span className="text-muted-foreground">Objet : </span><span className="font-medium">{sujet}</span></p>
            </div>
            {/* Corps composé à partir d'un modèle en texte : les valeurs et le modèle sont échappés, seuls <p>, <br> et les liens sont produits. */}
            <div className="space-y-2 px-4 py-3 text-sm [&_a]:break-all [&_a]:underline [&_p]:leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
    );
}

/** Éditeur du modèle d'un événement, pour tous les documents ou pour un type. */
function EditeurModele({ etat, evenement, onEnregistre }: { etat: EtatNotifications; evenement: Evenement; onEnregistre: () => Promise<void> }) {
    const { toast } = useToast();
    const parDocument = EVENEMENTS_DOCUMENT.includes(evenement);
    const [cible, setCible] = useState<string>(TOUS);
    const nature = cible === TOUS ? undefined : cible as NatureDocument;
    const enVigueur = useMemo(() => modeleDe(etat.modeles, evenement, nature), [etat.modeles, evenement, nature]);
    const propre = nature ? etat.modeles[evenement]?.parNature?.[nature] : etat.modeles[evenement]?.defaut;
    const [objet, setObjet] = useState(enVigueur.modele.objet);
    const [corps, setCorps] = useState(enVigueur.modele.corps);
    const [busy, setBusy] = useState(false);
    const champ = useRef<'objet' | 'corps'>('corps');
    const refObjet = useRef<HTMLInputElement>(null), refCorps = useRef<HTMLTextAreaElement>(null);
    useEffect(() => { setCible(TOUS); }, [evenement]);
    useEffect(() => { setObjet(enVigueur.modele.objet); setCorps(enVigueur.modele.corps); }, [enVigueur]);

    const modele: ModeleMail = { objet, corps };
    const erreurs = controlerModele(modele);
    const modifie = objet !== enVigueur.modele.objet || corps !== enVigueur.modele.corps;
    const apercu = useMemo(() => rendre({ objet, corps }, contexteExemple(evenement, etat.reglages.urlApplication || undefined, nature ?? 'avenant')), [objet, corps, evenement, nature, etat.reglages.urlApplication]);

    const inserer = (nom: string) => {
        const balise = `<<${nom}>>`;
        const el = champ.current === 'objet' ? refObjet.current : refCorps.current;
        const valeur = champ.current === 'objet' ? objet : corps;
        const debut = el?.selectionStart ?? valeur.length, fin = el?.selectionEnd ?? valeur.length;
        const suite = valeur.slice(0, debut) + balise + valeur.slice(fin);
        (champ.current === 'objet' ? setObjet : setCorps)(suite);
        requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(debut + balise.length, debut + balise.length); });
    };
    const enregistrer = async (m: ModeleMail | null) => {
        setBusy(true);
        const r = await modifierNotificationsAction({ modele: { evenement, ...(nature && { nature }), modele: m } });
        setBusy(false);
        if (!r.success) { toast({ title: 'Modèle refusé', description: r.error, variant: 'destructive' }); return; }
        toast({ title: m ? 'Modèle enregistré' : 'Modèle hérité rétabli' });
        await onEnregistre();
    };
    const origine = enVigueur.origine === 'origine' ? 'Modèle d\'origine' : enVigueur.origine === 'evenement' ? (nature ? 'Hérite du modèle « Tous les documents »' : 'Modèle propre') : 'Modèle propre à ce type';

    return (
        <div className="grid gap-6 xl:grid-cols-2">
            <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                    {parDocument && (
                        <div className="space-y-1">
                            <Label htmlFor="modele-cible">S&apos;applique à</Label>
                            <Select value={cible} onValueChange={setCible}>
                                <SelectTrigger id="modele-cible" className="w-64"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={TOUS}>Tous les documents</SelectItem>
                                    {NATURES.map(n => <SelectItem key={n} value={n}>{LIBELLE_NATURE_DOCUMENT[n]}{etat.modeles[evenement]?.parNature?.[n] ? ' — modèle propre' : ''}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <Badge variant="outline" className={cn('mb-1.5', enVigueur.origine !== 'origine' && 'border-blue-300 text-blue-700')}>{origine}</Badge>
                </div>
                <div className="space-y-1">
                    <Label htmlFor="modele-objet">Objet du mail</Label>
                    <Input id="modele-objet" ref={refObjet} value={objet} onChange={e => setObjet(e.target.value)} onFocus={() => { champ.current = 'objet'; }} />
                </div>
                <div className="space-y-1">
                    <Label htmlFor="modele-corps">Corps du mail</Label>
                    <Textarea id="modele-corps" ref={refCorps} rows={14} className="font-mono text-xs leading-relaxed" value={corps} onChange={e => setCorps(e.target.value)} onFocus={() => { champ.current = 'corps'; }} />
                    <p className="text-xs text-muted-foreground">Une ligne dont toutes les balises sont vides disparaît du mail (par exemple « Motif : &lt;&lt;Motif du refus&gt;&gt; » sans motif).</p>
                </div>
                <div>
                    <p className="mb-1.5 text-sm font-medium">Balises <span className="font-normal text-muted-foreground">— cliquez pour insérer à l&apos;endroit du curseur</span></p>
                    {[...GROUPES_FAMILLE[FAMILLE_EVENEMENT[evenement]], ...(FAMILLE_EVENEMENT[evenement] === 'contrat' ? [] : ['Dates et délais' as const])].map(g => (
                        <div key={g} className="mb-2">
                            <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{g}</p>
                            <div className="flex flex-wrap gap-1.5">
                                {BALISES.filter(b => b.groupe === g && (FAMILLE_EVENEMENT[evenement] === 'contrat' || g !== 'Dates et délais' || b.nom === 'Date du jour')).map(b => (
                                    <button key={b.nom} type="button" title={b.aide} onClick={() => inserer(b.nom)} className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs hover:border-primary hover:bg-primary/5">&lt;&lt;{b.nom}&gt;&gt;</button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
                {erreurs.length > 0 && <div className="rounded-md border border-destructive p-3 text-sm text-destructive">{erreurs.map(e => <p key={e}>{e}</p>)}</div>}
                <div className="flex flex-wrap gap-2">
                    <Button disabled={busy || !modifie || erreurs.length > 0} onClick={() => enregistrer(modele)}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Enregistrer le modèle</Button>
                    {modifie && <Button variant="ghost" disabled={busy} onClick={() => { setObjet(enVigueur.modele.objet); setCorps(enVigueur.modele.corps); }}>Annuler mes modifications</Button>}
                    {propre && <Button variant="outline" disabled={busy} onClick={() => enregistrer(null)}><RotateCcw className="mr-2 h-4 w-4" />{nature ? 'Revenir au modèle « Tous les documents »' : 'Revenir au modèle d\'origine'}</Button>}
                </div>
            </div>
            <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Aperçu sur un exemple{nature ? ` — ${LIBELLE_NATURE_DOCUMENT[nature].toLowerCase()}` : ''}</p>
                <Message sujet={apercu.sujet} html={apercu.html} />
            </div>
        </div>
    );
}

/** Destinataires d'un événement : activation, rôles, adresses fixes (internes). */
function EditeurRegle({ etat, evenement, onEnregistre }: { etat: EtatNotifications; evenement: Evenement; onEnregistre: () => Promise<void> }) {
    const { toast } = useToast();
    const ligne = etat.regles.find(r => r.evenement === evenement)!;
    const [actif, setActif] = useState(ligne.regle.actif);
    const [roles, setRoles] = useState<RoleDestinataire[]>(ligne.regle.roles);
    const [adresses, setAdresses] = useState(ligne.regle.adresses.join('\n'));
    const [busy, setBusy] = useState(false);
    useEffect(() => { setActif(ligne.regle.actif); setRoles(ligne.regle.roles); setAdresses(ligne.regle.adresses.join('\n')); }, [ligne]);
    const liste = adresses.split(/[\n,;]+/).map(a => a.trim()).filter(Boolean);
    const modifie = actif !== ligne.regle.actif || roles.join() !== ligne.regle.roles.join() || liste.join() !== ligne.regle.adresses.join();
    const enregistrer = async (retour = false) => {
        setBusy(true);
        const r = await modifierNotificationsAction({ regle: { evenement, regle: retour ? null : { actif, roles, adresses: liste } } });
        setBusy(false);
        if (!r.success) { toast({ title: 'Règle refusée', description: r.error, variant: 'destructive' }); return; }
        toast({ title: retour ? 'Règle d\'origine rétablie' : 'Destinataires enregistrés' });
        await onEnregistre();
    };
    return (
        <div className="max-w-2xl space-y-5">
            <div className="flex items-center gap-3">
                <Switch id="regle-actif" checked={actif} onCheckedChange={setActif} />
                <Label htmlFor="regle-actif">{actif ? 'Notification active' : 'Notification désactivée : aucun mail pour cet événement'}</Label>
            </div>
            <div>
                <p className="mb-2 text-sm font-medium">Destinataires par rôle <span className="font-normal text-muted-foreground">— résolus sur {FAMILLE_EVENEMENT[evenement] === 'contrat' ? 'le contrat concerné' : FAMILLE_EVENEMENT[evenement] === 'commande' ? 'la commande concernée' : 'les heures concernées'}</span></p>
                <div className="space-y-2">
                    {ROLES_FAMILLE[FAMILLE_EVENEMENT[evenement]].map(r => (
                        <div key={r} className="flex items-center gap-2">
                            <Checkbox id={`role-${r}`} checked={roles.includes(r)} onCheckedChange={v => setRoles(x => (v === true ? ROLES_FAMILLE[FAMILLE_EVENEMENT[evenement]].filter(y => x.includes(y) || y === r) : x.filter(y => y !== r)))} />
                            <Label htmlFor={`role-${r}`} className="font-normal">{LIBELLE_ROLE[r]}</Label>
                        </div>
                    ))}
                </div>
            </div>
            <div className="space-y-1">
                <Label htmlFor="regle-adresses">Adresses fixes <span className="font-normal text-muted-foreground">— une par ligne</span></Label>
                <Textarea id="regle-adresses" rows={3} value={adresses} onChange={e => setAdresses(e.target.value)} placeholder={`juridique@${etat.reglages.domaines[0] ?? 'votre-domaine.fr'}`} />
                <p className="text-xs text-muted-foreground">Domaines internes seulement ({etat.reglages.domaines.join(', ') || 'aucun paramétré'}) : une adresse d&apos;un autre domaine est refusée.</p>
            </div>
            <div className="flex flex-wrap gap-2">
                <Button disabled={busy || !modifie} onClick={() => enregistrer()}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Enregistrer les destinataires</Button>
                {ligne.propre && <Button variant="outline" disabled={busy} onClick={() => enregistrer(true)}><RotateCcw className="mr-2 h-4 w-4" />Revenir à la règle d&apos;origine</Button>}
            </div>
        </div>
    );
}

/** Réglages généraux : mode, boîte d'envoi, domaines internes, adresse de l'application. */
function ReglagesGeneraux({ etat, onEnregistre }: { etat: EtatNotifications; onEnregistre: () => Promise<void> }) {
    const { toast } = useToast();
    const r = etat.reglages;
    const [mode, setMode] = useState<ModeEnvoi>(r.mode);
    const [expediteur, setExpediteur] = useState(r.expediteur);
    const [domaines, setDomaines] = useState(r.domaines.join(', '));
    const [url, setUrl] = useState(r.urlApplication);
    const [busy, setBusy] = useState(false);
    useEffect(() => { setMode(r.mode); setExpediteur(r.expediteur); setDomaines(r.domaines.join(', ')); setUrl(r.urlApplication); }, [r]);
    const liste = domaines.split(/[\s,;]+/).map(d => d.trim()).filter(Boolean);
    const modifie = mode !== r.mode || expediteur !== r.expediteur || liste.join() !== r.domaines.join() || url !== r.urlApplication;
    const enregistrer = async () => {
        setBusy(true);
        const x = await modifierNotificationsAction({ ...(mode !== 'messagerie' && { mode }), expediteur, domaines: liste, urlApplication: url });
        setBusy(false);
        if (!x.success) { toast({ title: 'Réglages refusés', description: x.error, variant: 'destructive' }); return; }
        toast({ title: 'Réglages enregistrés' });
        await onEnregistre();
    };
    return (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1">
                <Label htmlFor="reglage-mode">Mode</Label>
                <Select value={mode} onValueChange={v => setMode(v as ModeEnvoi)}>
                    <SelectTrigger id="reglage-mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="simulation">Simulation (rien ne part)</SelectItem>
                        <SelectItem value="arret">Arrêt</SelectItem>
                        {r.mode === 'messagerie' && <SelectItem value="messagerie">Envoi réel</SelectItem>}
                    </SelectContent>
                </Select>
            </div>
            <div className="space-y-1"><Label htmlFor="reglage-domaines">Domaines internes</Label><Input id="reglage-domaines" value={domaines} onChange={e => setDomaines(e.target.value)} placeholder="veolia.com" /></div>
            <div className="space-y-1"><Label htmlFor="reglage-expediteur">Boîte d&apos;envoi</Label><Input id="reglage-expediteur" type="email" value={expediteur} onChange={e => setExpediteur(e.target.value)} placeholder="contratheque@veolia.com" /></div>
            <div className="space-y-1"><Label htmlFor="reglage-url">Adresse de l&apos;application</Label><Input id="reglage-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></div>
            <div className="md:col-span-2 xl:col-span-4"><Button disabled={busy || !modifie} onClick={enregistrer}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Enregistrer les réglages</Button></div>
        </div>
    );
}

/** Rappels programmés : paliers, dernier passage, lancement à la demande. */
function Rappels({ etat, onEnregistre }: { etat: EtatNotifications; onEnregistre: () => Promise<void> }) {
    const { toast } = useToast();
    const r = etat.reglages.rappels;
    const [preavis, setPreavis] = useState(r.preavis.join(', '));
    const [echeance, setEcheance] = useState(r.echeance.join(', '));
    const [attente, setAttente] = useState(String(r.attenteJours));
    const [depassee, setDepassee] = useState(String(r.depasseeJours));
    const [busy, setBusy] = useState<'enregistrer' | 'lancer' | null>(null);
    useEffect(() => { setPreavis(r.preavis.join(', ')); setEcheance(r.echeance.join(', ')); setAttente(String(r.attenteJours)); setDepassee(String(r.depasseeJours)); }, [r]);
    const liste = (t: string) => t.split(/[\s,;]+/).filter(Boolean).map(Number);
    const modifie = liste(preavis).join() !== r.preavis.join() || liste(echeance).join() !== r.echeance.join() || Number(attente) !== r.attenteJours || Number(depassee) !== r.depasseeJours;
    const enregistrer = async () => {
        setBusy('enregistrer');
        const x = await modifierNotificationsAction({ rappels: { preavis: liste(preavis), echeance: liste(echeance), attenteJours: Number(attente), depasseeJours: Number(depassee) } });
        setBusy(null);
        if (!x.success) { toast({ title: 'Rappels refusés', description: x.error, variant: 'destructive' }); return; }
        toast({ title: 'Rappels enregistrés' });
        await onEnregistre();
    };
    const lancer = async () => {
        setBusy('lancer');
        const x = await lancerRappelsAction();
        setBusy(null);
        if (!x.success) { toast({ title: 'Passage impossible', description: x.error, variant: 'destructive' }); return; }
        toast({ title: 'Rappels lancés', description: `${x.data.composes} mail(s) composé(s) sur ${x.data.dus} rappel(s) dû(s).` });
        await onEnregistre();
    };
    const p = etat.dernierPassage;
    return (
        <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1"><Label htmlFor="rappel-preavis">Préavis : jours avant la date limite</Label><Input id="rappel-preavis" value={preavis} onChange={e => setPreavis(e.target.value)} placeholder="90, 60, 30" /></div>
                <div className="space-y-1"><Label htmlFor="rappel-echeance">Échéance : jours avant</Label><Input id="rappel-echeance" value={echeance} onChange={e => setEcheance(e.target.value)} placeholder="180, 90, 30" /></div>
                <div className="space-y-1"><Label htmlFor="rappel-attente">Document en attente : tous les (jours)</Label><Input id="rappel-attente" inputMode="numeric" value={attente} onChange={e => setAttente(e.target.value)} /></div>
                <div className="space-y-1"><Label htmlFor="rappel-depassee">Échéance dépassée : tous les (jours)</Label><Input id="rappel-depassee" inputMode="numeric" value={depassee} onChange={e => setDepassee(e.target.value)} /></div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <Button disabled={busy !== null || !modifie} onClick={enregistrer}>{busy === 'enregistrer' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Enregistrer les rappels</Button>
                <Button variant="outline" disabled={busy !== null || modifie} onClick={lancer}>{busy === 'lancer' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Lancer les rappels maintenant</Button>
            </div>
            <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm">
                <AlarmClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                {p ? (
                    <p>
                        <span className="font-medium">Dernier passage le {quand(p.le)}</span> ({p.declencheur === 'planifie' ? 'tâche quotidienne' : 'lancé à la main'}, mode {MODE[p.mode as ModeEnvoi]?.libelle.toLowerCase() ?? p.mode}) :
                        {' '}{p.contrats} contrat(s) actif(s) et {p.enAttente} document(s) en attente examinés, {p.dus} rappel(s) dû(s), <span className="font-medium">{p.composes} mail(s) composé(s)</span>
                        {p.dus - p.composes > 0 ? ` (${p.dus - p.composes} déjà faits ou désactivés)` : ''}
                        {p.sansDestinataire > 0 && <span className="text-red-700"> ; {p.sansDestinataire} sans destinataire</span>}
                        {p.erreurs.length > 0 && <span className="text-red-700"> ; {p.erreurs.length} erreur(s)</span>}.
                    </p>
                ) : <p className="text-muted-foreground">Les rappels n&apos;ont encore jamais été lancés. Une tâche quotidienne les lancera une fois déployée ; vous pouvez aussi les lancer à la main.</p>}
            </div>
        </div>
    );
}

export default function NotificationsPage() {
    const [etat, setEtat] = useState<EtatNotifications | null>(null);
    const [erreur, setErreur] = useState<string | null>(null);
    const [evenement, setEvenement] = useState<Evenement>('document_depose');
    const [ouverte, setOuverte] = useState<string | null>(null);
    const charger = useCallback(async () => {
        const r = await etatNotificationsAction();
        if (r.success) { setEtat(r.data); setErreur(null); } else setErreur(r.error);
    }, []);
    useEffect(() => { charger(); }, [charger]);

    if (erreur) return <p className="text-sm text-destructive">{erreur}</p>;
    if (!etat) return <Loader2 className="mx-auto mt-24 h-8 w-8 animate-spin" />;
    const mode = MODE[etat.reglages.mode];
    const manques = [!etat.reglages.domaines.length && 'aucun domaine interne paramétré : tous les destinataires sont écartés', !etat.reglages.expediteur && 'boîte d\'envoi non renseignée', !etat.reglages.urlApplication && 'adresse de l\'application non renseignée : les mails n\'ont pas de lien'].filter(Boolean) as string[];
    const nbPropres = (e: Evenement) => (etat.modeles[e]?.defaut ? 1 : 0) + Object.keys(etat.modeles[e]?.parNature ?? {}).length;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Notifications par mail</h1>
                    <p className="text-muted-foreground">Ce que Zenergya envoie pour les contrats, les commandes et les heures : à qui, avec quel texte, et le journal de ce qui a été composé. Les mails restent internes.</p>
                </div>
                <Button variant="outline" onClick={charger}><RefreshCw className="mr-2 h-4 w-4" />Actualiser</Button>
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Réglages d&apos;envoi</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className={cn('flex flex-wrap items-start gap-3 rounded-lg border p-3 text-sm', mode.classe)}>
                        {etat.reglages.mode === 'simulation' ? <TestTube2 className="mt-0.5 h-5 w-5 shrink-0" /> : <MailWarning className="mt-0.5 h-5 w-5 shrink-0" />}
                        <div className="min-w-0 flex-1">
                            <p><span className="font-semibold">Mode : {mode.libelle}.</span> {mode.texte}</p>
                            {manques.map(m => <p key={m} className="mt-1 flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4 shrink-0" />{m.charAt(0).toUpperCase() + m.slice(1)}.</p>)}
                        </div>
                    </div>
                    <ReglagesGeneraux etat={etat} onEnregistre={charger} />
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Rappels programmés</CardTitle>
                    <CardDescription>Préavis et échéances qui approchent, échéances dépassées, documents qui attendent leur validation. Chaque palier n&apos;est rappelé qu&apos;une fois ; le texte et les destinataires se règlent plus bas, événement par événement.</CardDescription>
                </CardHeader>
                <CardContent><Rappels etat={etat} onEnregistre={charger} /></CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Événements</CardTitle>
                    <CardDescription>Choisissez un événement, puis réglez son mail et ses destinataires. Seules les adresses des domaines internes reçoivent un mail.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,19rem)_1fr]">
                    <div className="space-y-4" aria-label="Événements" role="list">
                        {(['contrat', 'commande', 'heures'] as Famille[]).map(f => (
                            <div key={f}>
                                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{LIBELLE_FAMILLE[f]}</p>
                                <ul className="space-y-1">
                                    {etat.regles.filter(r => FAMILLE_EVENEMENT[r.evenement] === f).map(r => (
                                        <li key={r.evenement}>
                                            <button type="button" onClick={() => setEvenement(r.evenement)} aria-pressed={evenement === r.evenement}
                                                className={cn('w-full rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60', evenement === r.evenement && 'border-primary bg-primary/5')}>
                                                <span className="flex items-center justify-between gap-2">
                                                    <span className="font-medium">{LIBELLE_EVENEMENT[r.evenement]}</span>
                                                    {r.regle.actif ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Actif" /> : <Badge variant="outline">Inactif</Badge>}
                                                </span>
                                                <span className="mt-0.5 block text-xs text-muted-foreground">{[...r.regle.roles.map(x => LIBELLE_ROLE[x]), ...r.regle.adresses].join(' · ') || 'Aucun destinataire'}</span>
                                                {nbPropres(r.evenement) > 0 && <span className="mt-0.5 block text-xs text-blue-700">{nbPropres(r.evenement)} modèle(s) propre(s)</span>}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                    <Tabs defaultValue="modele" className="min-w-0">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold">{LIBELLE_EVENEMENT[evenement]}</p>
                            <TabsList><TabsTrigger value="modele">Modèle du mail</TabsTrigger><TabsTrigger value="destinataires">Destinataires</TabsTrigger></TabsList>
                        </div>
                        <TabsContent value="modele"><EditeurModele etat={etat} evenement={evenement} onEnregistre={charger} /></TabsContent>
                        <TabsContent value="destinataires"><EditeurRegle etat={etat} evenement={evenement} onEnregistre={charger} /></TabsContent>
                    </Tabs>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Journal ({etat.journal.length})</CardTitle>
                    <CardDescription>Les cent dernières notifications composées, de la plus récente à la plus ancienne. Cliquez sur une ligne pour lire le mail.</CardDescription>
                </CardHeader>
                <CardContent>
                    {etat.journal.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Aucune notification pour l&apos;instant.</p> : (
                        <ul className="divide-y">
                            {etat.journal.map(n => (
                                <li key={n.id}>
                                    <button type="button" onClick={() => setOuverte(ouverte === n.id ? null : n.id)} aria-expanded={ouverte === n.id} className="flex w-full items-start gap-3 rounded-md px-2 py-2.5 text-left hover:bg-muted/50">
                                        <span className="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">{quand(n.creeLe)}</span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium">{n.sujet}</span>
                                            <span className="block truncate text-xs text-muted-foreground">{LIBELLE_EVENEMENT[n.evenement]} · {n.destinataires.length ? n.destinataires.join(', ') : 'aucun destinataire'}{n.ecartes.length ? ` · ${n.ecartes.length} écarté(s)` : ''}</span>
                                        </span>
                                        <Badge variant="outline" className={cn('shrink-0', STATUT[n.statut].classe)}>{STATUT[n.statut].libelle}</Badge>
                                    </button>
                                    {ouverte === n.id && <div className="px-2 pb-3"><Message sujet={n.sujet} html={n.html} destinataires={n.destinataires} ecartes={n.ecartes} />{n.erreur && <p className="mt-2 text-sm text-red-700">{n.erreur}</p>}</div>}
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
