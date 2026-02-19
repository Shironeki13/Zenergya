
'use client';

import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export default function P5WorksPage() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Interventions (P5)</h1>
                    <p className="text-muted-foreground">
                        Petits travaux issus d'interventions sur devis.
                    </p>
                </div>
                <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Nouvelle Intervention
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Liste des Interventions</CardTitle>
                    <CardDescription>
                        Gérez vos devis et facturations pour les petits travaux.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-center h-32 border-2 border-dashed rounded-lg">
                        <p className="text-muted-foreground italic">Aucune intervention pour le moment.</p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
