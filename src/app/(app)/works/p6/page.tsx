
'use client';

import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export default function P6WorksPage() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Projets (P6)</h1>
                    <p className="text-muted-foreground">
                        Gros travaux avec facturation à l'avancement.
                    </p>
                </div>
                <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Nouveau Projet
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Liste des Projets</CardTitle>
                    <CardDescription>
                        Suivez l'avancement et gérez les situations de travaux.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-center h-32 border-2 border-dashed rounded-lg">
                        <p className="text-muted-foreground italic">Aucun projet pour le moment.</p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
