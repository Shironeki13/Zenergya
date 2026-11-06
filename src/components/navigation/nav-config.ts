import {
    AlertTriangle, Building, Calculator, CircleDollarSign, Copy, FileSignature, FileText, Gauge, Home, KeyRound, LayoutDashboard,
    Library, ListChecks, MapPin, MessageSquareQuote, MinusCircle, Scale, Send, Settings, ShieldCheck, Store, TrendingUp, Upload, Users,
    type LucideIcon,
} from 'lucide-react';

/**
 * Navigation de l'application, organisée par métier : une seule source pour le menu, le fil d'Ariane et la recherche
 * globale (pages).
 */

export type NavItem = { href: string; label: string; icon: LucideIcon; admin?: boolean; keywords?: string };
export type NavGroup = { id: string; label: string; icon: LucideIcon; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
    {
        id: 'pilotage', label: 'Pilotage', icon: LayoutDashboard, items: [
            { href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard, keywords: 'accueil kpi chiffre affaires' },
            { href: '/billing/suivi', label: 'Suivi facturation', icon: ListChecks, keywords: 'retard échéances à facturer blocages adv impayés' },
        ],
    },
    {
        id: 'clients', label: 'Clients et contrats', icon: Building, items: [
            { href: '/clients', label: 'Clients', icon: Building, keywords: 'prospects fiches' },
            { href: '/contracts', label: 'Contrats', icon: FileSignature },
            { href: '/sites', label: 'Sites', icon: MapPin },
            { href: '/contracts/library', label: 'Contrathèque', icon: Library, keywords: 'documents avenants résiliations reconductions' },
            { href: '/contracts/commerce', label: 'Demandes commerce', icon: Store },
            { href: '/admin/validations', label: 'Validation des contrats', icon: ShieldCheck },
        ],
    },
    {
        id: 'facturation', label: 'Facturation', icon: CircleDollarSign, items: [
            { href: '/billing', label: 'Facturation manuelle', icon: CircleDollarSign, keywords: 'émettre facture contrat' },
            { href: '/billing/batch', label: 'Facturation groupée', icon: Copy, keywords: 'lot masse' },
            { href: '/invoices', label: 'Factures', icon: FileText },
            { href: '/credit-notes', label: 'Avoirs', icon: MinusCircle },
            { href: '/billing/rfe', label: 'Facturation électronique', icon: Send, keywords: 'chorus rfe pdp' },
            { href: '/billing/p1', label: 'Régularisation P1', icon: Scale, keywords: 'acomptes réel moteur' },
            { href: '/billing/indices', label: 'Indices', icon: TrendingUp, keywords: 'révision prix insee' },
        ],
    },
    {
        id: 'compteurs', label: 'Compteurs et énergie', icon: Gauge, items: [
            { href: '/meters', label: 'Compteurs', icon: Gauge, keywords: 'relevés index pdl pce' },
            { href: '/meters/alertes', label: 'Alertes compteurs', icon: AlertTriangle, keywords: 'dérive index baisse relevé manquant' },
        ],
    },
    {
        id: 'travaux', label: 'Travaux', icon: Calculator, items: [
            { href: '/works', label: 'Accueil travaux', icon: Home },
            { href: '/quotes', label: 'Devis', icon: MessageSquareQuote },
            { href: '/projects', label: 'Affaires (P6)', icon: Calculator },
            { href: '/library', label: 'Bibliothèque de prix', icon: Library, keywords: 'articles ouvrages' },
        ],
    },
    {
        id: 'admin', label: 'Administration', icon: Settings, items: [
            { href: '/settings', label: 'Paramétrage', icon: Settings, keywords: 'sociétés agences activités tva échéanciers stations' },
            { href: '/imports', label: 'Imports', icon: Upload, admin: true, keywords: 'excel csv modèles' },
            { href: '/users', label: 'Utilisateurs', icon: Users, admin: true, keywords: 'droits rôles' },
            { href: '/api-keys', label: 'Accès API', icon: KeyRound, admin: true },
        ],
    },
];

export const navGroupsFor = (isAdmin: boolean): NavGroup[] =>
    NAV_GROUPS.map(g => ({ ...g, items: g.items.filter(i => !i.admin || isAdmin) })).filter(g => g.items.length > 0);

/** Entrée du menu qui correspond à une page : la plus précise dont l'adresse est un préfixe (fiches et sous-pages comprises). */
export function activeNavItem(pathname: string, groups: NavGroup[] = NAV_GROUPS): { group: NavGroup; item: NavItem } | null {
    let best: { group: NavGroup; item: NavItem } | null = null;
    for (const group of groups) {
        for (const item of group.items) {
            const match = pathname === item.href || pathname.startsWith(`${item.href}/`);
            if (match && (!best || item.href.length > best.item.href.length)) best = { group, item };
        }
    }
    return best;
}
