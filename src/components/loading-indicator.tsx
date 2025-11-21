
'use client';
import { cn } from "@/lib/utils"
import { useState, useEffect } from "react";

export function LoadingIndicator({ isLoading }: { isLoading: boolean }) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isLoading || !isClient) return null;

  return (
    <div className="flex items-center gap-3 p-2 rounded-lg text-sm text-muted-foreground">
        <div className="relative h-6 w-6">
            <div className="absolute inset-0 border-2 border-primary/20 rounded-full"></div>
            <div className="absolute inset-0 border-t-2 border-primary rounded-full animate-spin"></div>
            <div className="relative flex items-center justify-center h-full w-full font-bold text-primary text-xs">
                Z
            </div>
        </div>
        <span>Chargement...</span>
    </div>
  );
}
