
'use client';
import { cn } from "@/lib/utils"

export function LoadingIndicator({ isLoading }: { isLoading: boolean }) {
  if (!isLoading) return null;

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg text-sm text-muted-foreground">
        <div className="relative h-6 w-6">
            <div className="absolute inset-0 bg-primary/20 rounded-full animate-pulse"></div>
            <div className="relative flex items-center justify-center h-full w-full bg-primary/10 rounded-full font-bold text-primary text-xs">
                Z
            </div>
        </div>
        <span>Chargement...</span>
    </div>
  );
}
