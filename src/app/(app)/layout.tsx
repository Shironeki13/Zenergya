
'use client';

import Link from 'next/link';
import {
  LayoutDashboard,
  FileSignature,
  FileText,
  Settings,
  Menu,
  Users,
  Building,
  MapPin,
  CircleDollarSign,
  Gauge,
  Copy,
  MinusCircle,
  ChevronDown,
  Library,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { UserNav } from '@/components/user-nav';
import { Logo } from '@/components/logo';
import { DataProvider } from '@/context/data-context';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';


export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const navItems = [
    { href: '/meters', icon: Gauge, label: 'Compteurs' },
    { href: '/users', icon: Users, label: 'Utilisateurs' },
    { href: '/settings', icon: Settings, label: 'Paramétrage' },
  ];
  
  const contrathequeLinks = [
      { href: '/contracts/library', label: 'Bibliothèque', icon: Library },
      { href: '/contracts', label: 'Liste des Contrats', icon: FileSignature },
      { href: '/clients', label: 'Clients', icon: Building },
      { href: '/sites', label: 'Sites', icon: MapPin },
  ];

  const facturationLinks = [
      { href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
      { href: '/invoices', label: 'Factures', icon: FileText },
      { href: '/credit-notes', label: 'Avoirs', icon: MinusCircle },
      { href: '/billing', label: 'Facturation Manuelle', icon: CircleDollarSign },
      { href: '/billing/batch', label: 'Facturation Groupée', icon: Copy },
  ];

  return (
    <DataProvider>
      <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
        <div className="hidden border-r bg-card md:block">
          <div className="flex h-full max-h-screen flex-col gap-2">
            <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
              <Link href="/" className="flex items-center gap-2 font-semibold">
                <Logo />
              </Link>
            </div>
            <div className="flex-1 overflow-y-auto">
              <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary",
                    pathname === item.href && "text-primary bg-muted")}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                ))}
                 <Collapsible
                    defaultOpen={pathname.startsWith('/contracts') || pathname.startsWith('/clients') || pathname.startsWith('/sites')}
                    className="flex flex-col gap-1"
                  >
                    <CollapsibleTrigger asChild>
                      <div
                        className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary cursor-pointer"
                      >
                         <Library className="h-4 w-4" />
                         <span>Contrathèque</span>
                         <ChevronDown className="ml-auto h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pl-7 space-y-1">
                        {contrathequeLinks.map(link => (
                             <Link
                                key={link.href}
                                href={link.href}
                                className={cn(
                                    "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary",
                                    pathname === link.href && "text-primary bg-muted"
                                )}
                              >
                                {link.label}
                              </Link>
                        ))}
                    </CollapsibleContent>
                 </Collapsible>
                 <Collapsible
                    defaultOpen={pathname.startsWith('/invoices') || pathname.startsWith('/credit-notes') || pathname.startsWith('/billing') || pathname.startsWith('/dashboard')}
                    className="flex flex-col gap-1"
                  >
                    <CollapsibleTrigger asChild>
                      <div
                        className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary cursor-pointer"
                      >
                         <CircleDollarSign className="h-4 w-4" />
                         <span>Facturation</span>
                         <ChevronDown className="ml-auto h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pl-7 space-y-1">
                        {facturationLinks.map(link => (
                             <Link
                                key={link.href}
                                href={link.href}
                                className={cn(
                                    "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary",
                                    pathname === link.href && "text-primary bg-muted"
                                )}
                              >
                                {link.label}
                              </Link>
                        ))}
                    </CollapsibleContent>
                 </Collapsible>
              </nav>
            </div>
            <div className="mt-auto p-4">
              <Card>
                <CardHeader className="p-2 pt-0 md:p-4">
                  <CardTitle>Besoin d'aide ?</CardTitle>
                  <CardDescription>
                    Contactez le support pour une assistance avec votre compte.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-2 pt-0 md:p-4 md:pt-0">
                  <Button size="sm" className="w-full">
                    Contacter le support
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
        <div className="flex flex-col">
          <header className="flex h-14 items-center gap-4 border-b bg-card px-4 lg:h-[60px] lg:px-6">
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0 md:hidden"
                >
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Ouvrir le menu de navigation</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex flex-col">
                 <SheetHeader>
                    <SheetTitle className="sr-only">Menu de navigation</SheetTitle>
                </SheetHeader>
                <nav className="grid gap-2 text-lg font-medium">
                  <Link
                    href="#"
                    className="flex items-center gap-2 text-lg font-semibold mb-4"
                  >
                    <Logo />
                  </Link>
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground hover:text-foreground"
                    >
                      <item.icon className="h-5 w-5" />
                      {item.label}
                    </Link>
                  ))}
                  <Collapsible defaultOpen={pathname.startsWith('/contracts') || pathname.startsWith('/clients') || pathname.startsWith('/sites')}>
                      <CollapsibleTrigger className="w-full">
                        <div className="mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground hover:text-foreground">
                            <Library className="h-5 w-5" />
                            Contrathèque
                            <ChevronDown className="ml-auto h-5 w-5 transition-transform [&[data-state=open]]:rotate-180" />
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pl-10 mt-2 space-y-2">
                        {contrathequeLinks.map(link => (
                             <Link
                                key={link.href}
                                href={link.href}
                                className={cn(
                                    "mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground hover:text-foreground",
                                    pathname === link.href && "bg-muted text-foreground"
                                )}
                              >
                                {link.label}
                              </Link>
                        ))}
                      </CollapsibleContent>
                  </Collapsible>
                   <Collapsible defaultOpen={pathname.startsWith('/invoices') || pathname.startsWith('/credit-notes') || pathname.startsWith('/billing') || pathname.startsWith('/dashboard')}>
                      <CollapsibleTrigger className="w-full">
                        <div className="mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground hover:text-foreground">
                            <CircleDollarSign className="h-5 w-5" />
                            Facturation
                            <ChevronDown className="ml-auto h-5 w-5 transition-transform [&[data-state=open]]:rotate-180" />
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pl-10 mt-2 space-y-2">
                        {facturationLinks.map(link => (
                             <Link
                                key={link.href}
                                href={link.href}
                                className={cn(
                                    "mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground hover:text-foreground",
                                    pathname === link.href && "bg-muted text-foreground"
                                )}
                              >
                                {link.label}
                              </Link>
                        ))}
                      </CollapsibleContent>
                  </Collapsible>
                </nav>
                <div className="mt-auto">
                  <Card>
                    <CardHeader>
                      <CardTitle>Besoin d'aide ?</CardTitle>
                      <CardDescription>
                        Contactez le support pour une assistance avec votre compte.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button size="sm" className="w-full">
                        Contacter le support
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </SheetContent>
            </Sheet>
            <div className="w-full flex-1" />
            <UserNav />
          </header>
          <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 bg-background/60">
            {children}
          </main>
        </div>
      </div>
    </DataProvider>
  );
}
