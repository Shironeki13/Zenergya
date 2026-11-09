'use client';

import Link from 'next/link';
import React, { useState, useEffect } from 'react';
import { Loader2, Menu } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { UserNav } from '@/components/user-nav';
import { Logo } from '@/components/logo';
import { useData } from '@/context/data-context';
import { useRouter } from 'next/navigation';
import { AppSidebar } from '@/components/navigation/app-sidebar';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { GlobalSearch } from '@/components/navigation/global-search';
import { ConfirmProvider } from '@/components/confirm-provider';


function MainAppLayout({ children }: { children: React.ReactNode }) {
  const { isLoading, currentUser, isAdmin, isContratheque } = useData();
  const router = useRouter();
  const [menuMobile, setMenuMobile] = useState(false);

  useEffect(() => {
    if (!isLoading && !currentUser) {
      router.push('/login');
    }
  }, [isLoading, currentUser, router]);

  if (isLoading || !currentUser) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-muted/20">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">Chargement...</p>
        </div>
      </div>
    )
  }

  return (
    <ConfirmProvider>
      <div className="grid min-h-screen w-full md:grid-cols-[240px_1fr] lg:grid-cols-[264px_1fr]">
        <aside className="hidden border-r bg-muted/40 md:block">
          <div className="sticky top-0 flex h-screen flex-col">
            <div className="flex h-16 shrink-0 items-center border-b px-6">
              <Link href="/dashboard" className="flex items-center gap-2 font-semibold" aria-label="Accueil">
                <Logo />
              </Link>
            </div>
            <div className="flex-1 overflow-y-auto py-3">
              <AppSidebar isAdmin={isAdmin} isContratheque={isContratheque} />
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:px-6">
            <Sheet open={menuMobile} onOpenChange={setMenuMobile}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0 md:hidden">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Ouvrir le menu de navigation</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex flex-col overflow-y-auto">
                <SheetHeader>
                  <SheetTitle className="sr-only">Menu de navigation</SheetTitle>
                  <Logo />
                </SheetHeader>
                <AppSidebar isAdmin={isAdmin} isContratheque={isContratheque} onNavigate={() => setMenuMobile(false)} />
              </SheetContent>
            </Sheet>
            <div className="min-w-0 flex-1"><Breadcrumbs /></div>
            <div className="hidden w-80 shrink-0 sm:block"><GlobalSearch /></div>
            <UserNav />
          </header>
          <main className="flex flex-1 flex-col gap-4 bg-muted/20 p-4 lg:gap-6 lg:p-8">
            {children}
          </main>
        </div>
      </div>
    </ConfirmProvider>
  );
}


export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MainAppLayout>{children}</MainAppLayout>
  )
}
