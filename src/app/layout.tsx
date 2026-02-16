import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { Inter } from 'next/font/google';
import { DataProvider } from '@/context/data-context';
import { TooltipProvider } from "@/components/ui/tooltip";

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Zenergy',
  description: 'Gérez vos contrats et votre facturation avec facilité.',
};

import { ThemeProvider } from "@/components/theme-provider"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className={inter.variable} suppressHydrationWarning>
      <body className="font-body antialiased" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <DataProvider>
            <TooltipProvider>
              {children}
              <Toaster />
            </TooltipProvider>
          </DataProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}