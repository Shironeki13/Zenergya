"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Building2, Landmark, FileText, XCircle, RefreshCw, Hammer, Users, Briefcase, ChevronLeft } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { DocumentCard } from "@/components/contracts/document-card"
import { AmendmentDialog } from "@/components/contracts/events/AmendmentDialog"
import { TerminationDialog } from "@/components/contracts/events/TerminationDialog"
import { RenewalDialog } from "@/components/contracts/events/RenewalDialog"
import { TrusteeChangeDialog } from "@/components/contracts/events/TrusteeChangeDialog"
import { BeChangeDialog } from "@/components/contracts/events/BeChangeDialog"
import { useData } from "@/context/data-context"

export default function DocumentHubPage() {
  const router = useRouter()
  const { reloadData } = useData()

  // Dialog States
  const [amendmentDialogOpen, setAmendmentDialogOpen] = useState(false)
  const [terminationDialogOpen, setTerminationDialogOpen] = useState(false)
  const [renewalDialogOpen, setRenewalDialogOpen] = useState(false)
  const [trusteeChangeDialogOpen, setTrusteeChangeDialogOpen] = useState(false)
  const [beChangeDialogOpen, setBeChangeDialogOpen] = useState(false)

  const handleCreateContract = () => {
    router.push("/contracts/create")
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/contracts">
          <Button variant="outline" size="icon">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ajouter un Document</h1>
          <p className="text-muted-foreground">
            Choisissez le type de document que vous souhaitez ajouter à votre contrathèque.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <DocumentCard
          title="Marché Privé"
          description="Créer une base marché à partir d'un contrat privé unique."
          icon={Building2}
          color="text-blue-500 bg-blue-50"
          onClick={() => router.push("/contracts/new/market-private")}
        />

        <DocumentCard
          title="Marché Public"
          description="Analyser un Acte d'Engagement, CCAP, CCTP, etc."
          icon={Landmark}
          color="text-indigo-500 bg-indigo-50"
          onClick={() => router.push("/contracts/new/market-public")}
        />

        <DocumentCard
          title="Avenant"
          description="Ajouter une modification à un marché existant."
          icon={FileText}
          color="text-amber-500 bg-amber-50"
          onClick={() => setAmendmentDialogOpen(true)}
        />

        <DocumentCard
          title="Résiliation"
          description="Enregistrer la fin anticipée d'un contrat."
          icon={XCircle}
          color="text-red-500 bg-red-50"
          onClick={() => setTerminationDialogOpen(true)}
        />

        <DocumentCard
          title="Reconduction"
          description="Prolonger un contrat arrivé à échéance."
          icon={RefreshCw}
          color="text-emerald-500 bg-emerald-50"
          onClick={() => setRenewalDialogOpen(true)}
        />

        <DocumentCard
          title="OS (Ordre de Service)"
          description="Ajouter un ordre de service lié à un contrat."
          icon={Hammer}
          color="text-cyan-500 bg-cyan-50"
          onClick={() => setAmendmentDialogOpen(true)} // OS uses Amendment logic for now
        />

        <DocumentCard
          title="Changement de syndic"
          description="Mettre à jour le représentant du client."
          icon={Users}
          color="text-purple-500 bg-purple-50"
          onClick={() => setTrusteeChangeDialogOpen(true)}
        />

        <DocumentCard
          title="Changement de BE"
          description="Changer le bureau d'études associé."
          icon={Briefcase}
          color="text-pink-500 bg-pink-50"
          onClick={() => setBeChangeDialogOpen(true)}
        />
      </div>

      {/* Global Event Dialogs */}
      <AmendmentDialog open={amendmentDialogOpen} onOpenChange={setAmendmentDialogOpen} onSuccess={reloadData} />
      <TerminationDialog open={terminationDialogOpen} onOpenChange={setTerminationDialogOpen} onSuccess={reloadData} />
      <RenewalDialog open={renewalDialogOpen} onOpenChange={setRenewalDialogOpen} onSuccess={reloadData} />
      <TrusteeChangeDialog open={trusteeChangeDialogOpen} onOpenChange={setTrusteeChangeDialogOpen} onSuccess={reloadData} />
      <BeChangeDialog open={beChangeDialogOpen} onOpenChange={setBeChangeDialogOpen} onSuccess={reloadData} />
    </div>
  )
}
