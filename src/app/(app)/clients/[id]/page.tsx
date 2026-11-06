'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { notFound, useParams, useRouter } from 'next/navigation';
import { Loader2, Pencil, PlusCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getClient, getContractsByClient, getSitesByClient, getContactsByClient } from '@/services/firestore';
import type { Client, Contract, Site, Contact } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { AttachContractDialog } from '@/components/attach-contract-dialog';
import { useData } from '@/context/data-context';
import { SireneCheckPanel } from '@/components/clients/sirene-check';
import { AFaire, Indicateur, eur0, CompteurAFaire, useOngletUrl, type PointAFaire } from '@/components/fiches/fiche';
import { CarteContacts, TableauContrats, TableauFactures, TableauSites, etatSite } from '@/components/fiches/tableaux';

/** Fiche client : bandeau, indicateurs, « à faire », onglets (synthèse, contrats, sites, factures). */

const ONGLETS_CLIENT = ['synthese', 'contrats', 'sites', 'factures'] as const;
type OngletClient = typeof ONGLETS_CLIENT[number];

export default function ClientDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { toast } = useToast();
  const { typologies, companies, agencies, sectors, services, invoices, users } = useData();

  const [client, setClient] = useState<Client | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [onglet, changerOnglet] = useOngletUrl<OngletClient>(ONGLETS_CLIENT, 'synthese');

  const fetchContracts = useCallback(async () => {
    try {
      setContracts(await getContractsByClient(id));
    } catch (error) {
      console.error("Failed to fetch contracts", error);
    }
  }, [id]);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const [clientData, clientSites, clientContacts] = await Promise.all([getClient(id), getSitesByClient(id), getContactsByClient(id)]);
        if (!clientData) { notFound(); return; }
        setClient(clientData);
        setSites(clientSites);
        setContacts(clientContacts);
        await fetchContracts();
      } catch (error) {
        console.error("Failed to fetch data for client detail page", error);
        toast({ title: "Erreur", description: "Impossible de charger les données.", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [id, toast, fetchContracts]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  if (!client) return notFound();

  const typologyName = typologies.find(t => t.id === client.typologyId)?.name ?? client.typologyName ?? '—';
  const companyName = companies.find(c => c.id === client.companyId)?.name ?? '—';
  const agencyName = agencies.find(a => a.id === client.agencyId)?.name ?? '—';
  const sectorName = sectors.find(s => s.id === client.sectorId)?.name ?? '—';

  // ── Synthèse du client : indicateurs et points à traiter ──
  const actifs = contracts.filter(c => c.status === 'Actif');
  const montantAnnuel = sites.reduce((t, s) => t + etatSite(s, services).montant, 0);
  const facturesClient = invoices.filter(i => i.clientId === id);
  const aPayer = facturesClient.filter(i => i.status === 'due' || i.status === 'overdue');
  const soldeDu = aPayer.reduce((t, i) => t + (Number(i.total) || 0), 0);
  const enRetardPaiement = facturesClient.filter(i => i.status === 'overdue' || (i.status === 'due' && i.dueDate && new Date(i.dueDate) < new Date()));
  const contactFacturation = contacts.find(c => c.type === 'facturation');
  const sansResponsable = actifs.filter(c => !c.billingManagerId);
  const aEcheance = actifs.filter(c => {
    const jours = c.endDate ? Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000) : null;
    return jours !== null && jours >= 0 && jours <= 90;
  });
  const sansPrestation = sites.filter(s => etatSite(s, services).prestations.length === 0);
  const siretKo = client.sireneCheck && (!client.sireneCheck.found || client.sireneCheck.etablissementActif === false);
  const pointsAFaire: PointAFaire[] = [
    ...(client.clientType === 'public' && !client.siret ? [{ id: 'siret', gravite: 'bloquant' as const, texte: 'Client public sans SIRET : ses factures ne peuvent pas être déposées.', action: { label: 'Modifier', onClick: () => router.push(`/clients/${id}/edit`) } }] : []),
    ...(siretKo ? [{ id: 'sirene', gravite: 'bloquant' as const, texte: `SIRET ${client.sireneCheck!.found ? 'd\'un établissement fermé' : 'introuvable'} dans le répertoire des entreprises.`, action: { label: 'Modifier', onClick: () => router.push(`/clients/${id}/edit`) } }] : []),
    ...(!contactFacturation ? [{ id: 'contact', gravite: 'attention' as const, texte: 'Aucun contact de facturation : à qui envoyer les factures ?', action: { label: 'Modifier', onClick: () => router.push(`/clients/${id}/edit`) } }]
      : !contactFacturation.email ? [{ id: 'email', gravite: 'attention' as const, texte: `Contact de facturation sans e-mail (${contactFacturation.name}).`, action: { label: 'Modifier', onClick: () => router.push(`/clients/${id}/edit`) } }] : []),
    ...(enRetardPaiement.length ? [{ id: 'impayes', gravite: 'attention' as const, texte: `${enRetardPaiement.length} facture(s) en retard de paiement (${eur0(enRetardPaiement.reduce((t, i) => t + (Number(i.total) || 0), 0))} TTC).`, action: { label: 'Factures', onClick: () => changerOnglet('factures') } }] : []),
    ...(sansPrestation.length ? [{ id: 'sans', gravite: 'attention' as const, texte: `${sansPrestation.length} site(s) sans prestation : ${sansPrestation.slice(0, 3).map(s => s.name).join(', ')}${sansPrestation.length > 3 ? '…' : ''}.`, action: { label: 'Sites', onClick: () => changerOnglet('sites') } }] : []),
    ...(sansResponsable.length ? [{ id: 'resp', gravite: 'attention' as const, texte: `${sansResponsable.length} contrat(s) actif(s) sans responsable facturation.`, action: { label: 'Contrats', onClick: () => changerOnglet('contrats') } }] : []),
    ...(aEcheance.length ? [{ id: 'echeance', gravite: 'attention' as const, texte: `${aEcheance.length} contrat(s) arrivent à échéance dans les 90 jours : ${aEcheance.map(c => c.contractNumber ?? c.id).join(', ')}.`, action: { label: 'Contrats', onClick: () => changerOnglet('contrats') } }] : []),
  ];

  return (
    <div className="space-y-6">
      {/* Bandeau : identité du client, rattachement, actions */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{client.name}</h1>
            {client.externalCode && <Badge variant="outline" className="font-mono">{client.externalCode}</Badge>}
            {client.relation === 'prospect' && <Badge variant="outline">Prospect</Badge>}
            <Badge variant={client.clientType === 'public' ? 'secondary' : 'outline'}>{client.clientType === 'public' ? 'Public' : 'Privé'}</Badge>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <span>{[client.address, [client.postalCode, client.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Adresse non renseignée'}</span>
            <span aria-hidden>·</span>
            <span>{[companyName, agencyName].filter(n => n !== '—').join(' › ') || 'Rattachement non renseigné'}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" asChild><Link href={`/clients/${id}/edit`}><Pencil className="mr-2 h-4 w-4" />Modifier</Link></Button>
          <Button variant="outline" asChild><Link href={`/quotes?clientId=${id}`}>Devis</Link></Button>
          <Button variant="outline" asChild><Link href={`/quotes/new?clientId=${id}`}>Nouveau devis</Link></Button>
          <Button asChild><Link href={`/contracts/new?clientId=${client.id}`}><PlusCircle className="mr-2 h-4 w-4" />Nouveau contrat</Link></Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicateur titre="Contrats actifs" valeur={`${actifs.length}`} detail={`sur ${contracts.length} contrat(s)`} onClick={() => changerOnglet('contrats')} />
        <Indicateur titre="Sites" valeur={`${sites.length}`} detail={sansPrestation.length ? `${sansPrestation.length} sans prestation` : 'tous facturés'} alerte={sansPrestation.length > 0} onClick={() => changerOnglet('sites')} />
        <Indicateur titre="Montant annuel HT" valeur={eur0(montantAnnuel)} detail="prestations en vigueur" onClick={() => changerOnglet('sites')} />
        <Indicateur titre="Solde dû TTC" valeur={eur0(soldeDu)} detail={enRetardPaiement.length ? `${enRetardPaiement.length} en retard de paiement` : `${aPayer.length} facture(s) à payer`} alerte={enRetardPaiement.length > 0} onClick={() => changerOnglet('factures')} />
      </div>

      <Tabs value={onglet} onValueChange={v => changerOnglet(v as OngletClient)}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="synthese" className="gap-1.5">
            Synthèse
            <CompteurAFaire points={pointsAFaire} />
          </TabsTrigger>
          <TabsTrigger value="contrats">Contrats ({contracts.length})</TabsTrigger>
          <TabsTrigger value="sites">Sites ({sites.length})</TabsTrigger>
          <TabsTrigger value="factures">Factures ({facturesClient.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="synthese" className="mt-4 space-y-6">
          <AFaire points={pointsAFaire} description="Ce qui empêche ou fragilise la facturation de ce client." />
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Informations</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                  <dt className="text-muted-foreground">Code client</dt><dd className="font-mono">{client.externalCode || '—'}</dd>
                  <dt className="text-muted-foreground">Réf. externe</dt><dd className="font-mono">{client.externalRef || '—'}</dd>
                  <dt className="text-muted-foreground">Société</dt><dd>{companyName}</dd>
                  <dt className="text-muted-foreground">Agence</dt><dd>{agencyName}</dd>
                  <dt className="text-muted-foreground">Secteur</dt><dd>{sectorName}</dd>
                  <dt className="text-muted-foreground">Typologie</dt><dd>{typologyName}</dd>
                  {client.representedBy && <><dt className="text-muted-foreground">Représenté par</dt><dd>{client.representedBy}</dd></>}
                  <dt className="text-muted-foreground">SIRET</dt><dd className="font-mono">{client.siret || '—'}</dd>
                  <dt className="text-muted-foreground">Chorus Pro</dt><dd>{client.useChorus ? <span className="font-medium text-green-700">Activé</span> : 'Non'}</dd>
                  {client.isBe && <><dt className="text-muted-foreground">Bureau d&apos;études</dt><dd>{client.beName || 'Oui'}</dd></>}
                </dl>
                <Separator />
                <SireneCheckPanel client={client} onChecked={check => setClient(c => (c ? { ...c, sireneCheck: check } : c))} />
              </CardContent>
            </Card>
            <CarteContacts contacts={contacts} />
          </div>
        </TabsContent>

        <TabsContent value="contrats" className="mt-4">
          <TableauContrats contrats={contracts} sites={sites} services={services} users={users}
            actions={<>
              <AttachContractDialog client={client} onContractAttached={fetchContracts} />
              <Button size="sm" variant="outline" asChild><Link href={`/contracts/new?clientId=${client.id}`}><PlusCircle className="mr-1 h-4 w-4" />Nouveau</Link></Button>
            </>} />
        </TabsContent>

        <TabsContent value="sites" className="mt-4">
          <TableauSites sites={sites} services={services} contrats={contracts} />
        </TabsContent>

        <TabsContent value="factures" className="mt-4">
          <TableauFactures factures={facturesClient} contrats={contracts} description="Factures et proformas du client, tous contrats, du plus récent au plus ancien." />
        </TabsContent>
      </Tabs>
    </div>
  );
}
