
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Briefcase, Calculator, Plus } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function WorksDashboard() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Travaux</h1>
                    <p className="text-muted-foreground">
                        Gérez vos interventions (P5) et vos projets à l'avancement (P6).
                    </p>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <Card className="hover:border-primary/50 transition-colors cursor-pointer group">
                    <Link href="/works/p5">
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                                    <Briefcase className="h-5 w-5" />
                                </div>
                                <CardTitle>Interventions (P5)</CardTitle>
                            </div>
                            <CardDescription>
                                Petits travaux issus d'interventions sur devis.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">Gérer les devis et facturations P5</span>
                                <Plus className="h-4 w-4" />
                            </div>
                        </CardContent>
                    </Link>
                </Card>

                <Card className="hover:border-primary/50 transition-colors cursor-pointer group">
                    <Link href="/works/p6">
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                                    <Calculator className="h-5 w-5" />
                                </div>
                                <CardTitle>Projets (P6)</CardTitle>
                            </div>
                            <CardDescription>
                                Gros travaux avec facturation à l'avancement (Situations).
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">Suivre l'avancement et les situations P6</span>
                                <Plus className="h-4 w-4" />
                            </div>
                        </CardContent>
                    </Link>
                </Card>

                <Card className="hover:border-primary/50 transition-colors cursor-pointer group border-blue-200 bg-blue-50/10">
                    <Link href="/works/chiffrage/new">
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <div className="p-2 rounded-lg bg-blue-100 text-blue-800 group-hover:bg-blue-800 group-hover:text-white transition-colors">
                                    <Calculator className="h-5 w-5" />
                                </div>
                                <CardTitle>Chiffrage & Études</CardTitle>
                            </div>
                            <CardDescription>
                                Outil de chiffrage inspiré d'Optima pour vos devis complexes.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-blue-800">Créer un nouveau chiffrage</span>
                                <Plus className="h-4 w-4 text-blue-800" />
                            </div>
                        </CardContent>
                    </Link>
                </Card>
            </div>
        </div>
    );
}
