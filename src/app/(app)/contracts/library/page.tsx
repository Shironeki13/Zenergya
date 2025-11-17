
'use client';

import Link from 'next/link';
import { UploadCloud, FileSignature } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function ContractLibraryPage() {

  return (
    <div>
        <div className="mb-6">
            <h1 className="text-3xl font-bold tracking-tight">Contrathèque</h1>
            <p className="text-muted-foreground">
              Gérez et analysez tous vos documents contractuels.
            </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
             <Link href="/contracts" className="block hover:scale-105 transition-transform duration-200">
                <Card className="h-full flex flex-col">
                    <CardHeader>
                        <div className="flex items-center gap-4">
                             <div className="bg-primary text-primary-foreground p-3 rounded-lg">
                                <FileSignature className="h-6 w-6" />
                            </div>
                            <CardTitle>Liste des Contrats</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">
                            Accédez à la liste complète de tous les contrats saisis manuellement, modifiez-les et suivez leur statut.
                        </p>
                    </CardContent>
                </Card>
            </Link>

            <Link href="/contracts/new-document" className="block hover:scale-105 transition-transform duration-200">
                 <Card className="h-full flex flex-col">
                    <CardHeader>
                        <div className="flex items-center gap-4">
                             <div className="bg-secondary text-secondary-foreground p-3 rounded-lg">
                                <UploadCloud className="h-6 w-6" />
                            </div>
                            <CardTitle>Ajouter un/des document(s)</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">
                           Importez un document PDF et laissez l'IA extraire automatiquement les informations clés du contrat.
                        </p>
                    </CardContent>
                </Card>
            </Link>
        </div>
    </div>
  );
}
