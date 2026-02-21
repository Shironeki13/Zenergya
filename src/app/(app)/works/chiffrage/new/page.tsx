'use client';

import { ChiffrageDashboard } from '../../_components/chiffrage-dashboard';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Save, FileText, Download } from 'lucide-react';
import Link from 'next/link';

export default function NewChiffragePage() {
    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <Link href="/works" className="text-muted-foreground hover:text-primary transition-colors">
                            <ChevronLeft className="h-4 w-4" />
                        </Link>
                        <h1 className="text-2xl font-bold tracking-tight">Nouveau Chiffrage</h1>
                    </div>
                    <p className="text-muted-foreground">
                        Établissez un devis détaillé en calculant vos coûts, marges et prix de vente.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline">
                        <Download className="mr-2 h-4 w-4" />
                        Exporter
                    </Button>
                    <Button variant="outline">
                        <FileText className="mr-2 h-4 w-4" />
                        Aperçu Devis
                    </Button>
                    <Button>
                        <Save className="mr-2 h-4 w-4" />
                        Enregistrer
                    </Button>
                </div>
            </div>

            <ChiffrageDashboard />
        </div>
    );
}
