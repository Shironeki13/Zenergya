import { Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 text-primary", className)}>
      <div className="bg-primary text-primary-foreground p-1.5 rounded-lg flex items-center justify-center">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="logo-lightning-gradient" x1="-100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="white" stopOpacity="0" />
              <stop offset="50%" stopColor="#fbbf24" stopOpacity="1" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
              <animate attributeName="x1" values="-100%; 200%" dur="2.5s" repeatCount="indefinite" />
              <animate attributeName="x2" values="0%; 300%" dur="2.5s" repeatCount="indefinite" />
              <animate attributeName="y1" values="0%; 0%" dur="2.5s" repeatCount="indefinite" />
              <animate attributeName="y2" values="100%; 100%" dur="2.5s" repeatCount="indefinite" />
            </linearGradient>
          </defs>
          <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="url(#logo-lightning-gradient)" />
        </svg>
      </div>
      <span className="text-xl font-bold text-foreground">Zenergy</span>
    </div>
  );
}
