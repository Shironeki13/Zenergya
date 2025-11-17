
'use client';

import Link from 'next/link';
import { 
  FilePlus2, 
  FileText, 
  FileX, 
  RefreshCw, 
  Hammer, 
  Users, 
  Briefcase,
  ChevronLeft
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const documentTypes = [
  {
    title: "Base Marché",
    description: "Créer un nouveau contrat principal.",
    icon: FilePlus2,
    href: "/contracts/new",
    enabled: true,
  },
  {
    title: "Avenant",
    description: "Ajouter une modification à un marché existant.",
    icon: FileText,
    href: "#",
    enabled: false,
  },
  {
    title: "Résiliation",
    description: "Enregistrer la fin anticipée d'un contrat.",
    icon: FileX,
    href: "#",
    enabled: false,
  },
  {
    title: "Reconduction",
    description: "Prolonger un contrat arrivé à échéance.",
    icon: RefreshCw,
    href: "#",
    enabled: false,
  },
  {
    title: "OS (Ordre de Service)",
    description: "Ajouter un ordre de service lié à un contrat.",
    icon: Hammer,
    href: "#",
    enabled: false,
  },
  {
    title: "Changement de syndic",
    description: "Mettre à jour le représentant du client.",
    icon: Users,
    href: "#",
    enabled: false,
  },
  {
    title: "Changement de BE",
    description: "Changer le bureau d'études associé.",
    icon: Briefcase,
    href: "#",
    enabled: false,
  },
];

export default function NewDocumentPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/contracts/library">
          <Button variant="outline" size="icon" className="h-7 w-7">
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Retour</span>
          </Button>
        </Link>
        <div>
            <h1 className="text-2xl font-bold tracking-tight">Ajouter un Document</h1>
            <p className="text-muted-foreground">
            Choisissez le type de document que vous souhaitez ajouter à votre contrathèque.
            </p>
        </div>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {documentTypes.map((doc, index) => {
          const Wrapper = doc.enabled ? Link : 'div';
          return (
            <Wrapper key={index} href={doc.href} className={!doc.enabled ? 'opacity-50 cursor-not-allowed' : ''}>
              <Card className="hover:border-primary/80 hover:shadow-lg transition-all duration-200 h-full">
                <CardHeader className="flex flex-row items-center gap-4">
                  <div className="bg-muted p-3 rounded-lg">
                    <doc.icon className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <CardTitle>{doc.title}</CardTitle>
                    <CardDescription className="mt-1">{doc.description}</CardDescription>
                  </div>
                </CardHeader>
              </Card>
            </Wrapper>
          )
        })}
      </div>
    </div>
  );
}
