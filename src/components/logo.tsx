import { Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 text-primary", className)}>
      <div className="bg-primary text-primary-foreground p-1.5 rounded-lg">
        <Zap className="h-5 w-5" />
      </div>
      <span className="text-xl font-bold text-foreground">Zenergy</span>
    </div>
  );
}
