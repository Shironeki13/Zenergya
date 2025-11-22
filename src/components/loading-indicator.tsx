
'use client';

export default function LoadingIndicator({ isLoading }: { isLoading: boolean }) {
  if (!isLoading) {
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
