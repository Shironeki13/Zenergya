
'use client';

import { useData } from "@/context/data-context";
import { useEffect, useState } from "react";

export default function LoadingIndicator() {
  const { isLoading } = useData();
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Only show loading indicator after a short delay
    // to avoid flickering for fast data loads.
    let timeout: NodeJS.Timeout;
    if (isLoading) {
      timeout = setTimeout(() => setShow(true), 200);
    } else {
      setShow(false);
    }
    return () => clearTimeout(timeout);
  }, [isLoading]);


  if (!show) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg text-sm text-muted-foreground">
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
