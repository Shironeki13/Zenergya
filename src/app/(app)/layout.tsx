
'use client';

import Link from 'next/link';
import React, { useState, useEffect } from 'react';
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
  MessageSquareQuote,
  ShieldCheck,
  Home,
  Briefcase,
  Calculator,
  ShieldAlert,
  Store,
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
import { DataProvider, useData } from '@/context/data-context';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';


function MainAppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoading } = useData();

  const navItems = [
    { href: '/meters', icon: Gauge, label: 'Compteurs' },
    { href: '/users', icon: Users, label: 'Utilisateurs' },
    { href: '/settings', icon: Settings, label: 'Paramétrage' },
  ];

  const facturationLinks = [
    { href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
    { href: '/invoices', label: 'Factures', icon: FileText },
    { href: '/credit-notes', label: 'Avoirs', icon: MinusCircle },
    { href: '/billing', label: 'Facturation Manuelle', icon: CircleDollarSign },
    { href: '/billing/batch', label: 'Facturation Groupée', icon: Copy },
    { href: '/clients', label: 'Clients', icon: Building },
    { href: '/sites', label: 'Sites', icon: MapPin },
  ];

  const contrathequeLinks = [
    { href: '/contracts/library', label: 'Accueil', icon: Home },
    { href: '/contracts/validation', label: 'Admin', icon: ShieldCheck },
    { href: '/contracts', label: 'Liste des contrats', icon: FileSignature },
    { href: '#', label: 'ADV', icon: Briefcase },
    { href: '#', label: 'CDG', icon: Calculator },
    { href: '#', label: 'DPO', icon: ShieldAlert },
    { href: '#', label: 'Commerce', icon: Store },
  ];

  return (
    <div className="grid min-h-screen w-full md:grid-cols-[240px_1fr] lg:grid-cols-[280px_1fr]">
      <div className="hidden border-r bg-muted/40 md:block">
        <div className="flex h-full max-h-screen flex-col gap-2">
          <div className="flex h-16 items-center border-b px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <Logo />
            </Link>
          </div>
          <div className="flex-1 overflow-y-auto py-4">
            <nav className="grid items-start px-4 text-sm font-medium gap-2">

              <Collapsible
                defaultOpen={pathname.startsWith('/contracts')}
                className="flex flex-col gap-1"
              >
                <CollapsibleTrigger asChild>
                  <div
                    className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary hover:bg-muted cursor-pointer font-semibold"
                  >
                    <Library className="h-4 w-4" />
                    <span>Contrathèque</span>
                    <ChevronDown className="ml-auto h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent className="pl-4 space-y-1 pt-1">
                  {contrathequeLinks.map(link => {
                    const isPlaceholder = link.href === '#';
                    const commonClasses = "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all text-sm";
                    const activeClasses = pathname === link.href && "text-primary bg-primary/10 font-medium";
                    const hoverClasses = !isPlaceholder ? "hover:text-primary hover:bg-muted" : "opacity-50 cursor-not-allowed";

                    if (isPlaceholder) {
                      return (
                        <div
                          key={link.href + link.label}
                          className={cn(commonClasses, hoverClasses)}
                        >
                          {link.label}
                        </div>
                      );
                    }

                    return (
                      <Link
                        key={link.href + link.label}
                        href={link.href}
                        className={cn(commonClasses, hoverClasses, activeClasses)}
                      >
                        {link.label}
                      </Link>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>

              <Collapsible
                defaultOpen={pathname.startsWith('/invoices') || pathname.startsWith('/credit-notes') || pathname.startsWith('/billing') || pathname.startsWith('/dashboard') || pathname.startsWith('/clients') || pathname.startsWith('/sites')}
                className="flex flex-col gap-1"
              >
                <CollapsibleTrigger asChild>
                  <div
                    className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary hover:bg-muted cursor-pointer font-semibold"
                  >
                    <CircleDollarSign className="h-4 w-4" />
                    <span>Facturation</span>
                    <ChevronDown className="ml-auto h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent className="pl-4 space-y-1 pt-1">
                  {facturationLinks.map(link => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all text-sm hover:text-primary hover:bg-muted",
                        pathname === link.href && "text-primary bg-primary/10 font-medium"
                      )}
                    >
                      {link.label}
                    </Link>
                  ))}
                </CollapsibleContent>
              </Collapsible>

              <div className="my-2 border-t border-border/50" />

              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary hover:bg-muted",
                    pathname === item.href && "text-primary bg-primary/10 font-medium")}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </div>
      <div className="flex flex-col">
        <header className="flex h-16 items-center gap-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-6">
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
                <Collapsible defaultOpen={pathname.startsWith('/contracts')}>
                  <CollapsibleTrigger className="w-full">
                    <div className="mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground hover:text-foreground">
                      <Library className="h-5 w-5" />
                      Contrathèque
                      <ChevronDown className="ml-auto h-5 w-5 transition-transform [&[data-state=open]]:rotate-180" />
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pl-10 mt-2 space-y-2">
                    {contrathequeLinks.map(link => {
                      const isPlaceholder = link.href === '#';
                      const commonClasses = "mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground";
                      const activeClasses = pathname === link.href && "bg-muted text-foreground";
                      const hoverClasses = !isPlaceholder ? "hover:text-foreground" : "opacity-50 cursor-not-allowed";

                      if (isPlaceholder) {
                        return (
                          <div
                            key={link.href + link.label}
                            className={cn(commonClasses, hoverClasses)}
                          >
                            {link.label}
                          </div>
                        );
                      }

                      return (
                        <Link
                          key={link.href + link.label}
                          href={link.href}
                          className={cn(commonClasses, hoverClasses, activeClasses)}
                        >
                          {link.label}
                        </Link>
                      );
                    })}
                  </CollapsibleContent>
                </Collapsible>

                <Collapsible defaultOpen={pathname.startsWith('/invoices') || pathname.startsWith('/credit-notes') || pathname.startsWith('/billing') || pathname.startsWith('/dashboard') || pathname.startsWith('/clients') || pathname.startsWith('/sites')}>
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

                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn("mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground hover:text-foreground",
                      pathname === item.href && 'bg-muted text-foreground')}
                  >
                    <item.icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-auto">

              </div>
            </SheetContent>
          </Sheet>
          <div className="w-full flex-1" />
          <UserNav />
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-8 lg:p-8 bg-muted/20">
          {children}
        </main>
      </div>
    </div>
  );
}


export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DataProvider>
      <MainAppLayout>{children}</MainAppLayout>
    </DataProvider>
  )
}
