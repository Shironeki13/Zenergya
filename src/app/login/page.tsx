'use client';

import { useState } from 'react';
import { useData } from '@/context/data-context';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login, loginWithGoogle } = useData();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setError('Email ou mot de passe incorrect.');
      } else if (err.code === 'auth/too-many-requests') {
        setError('Trop de tentatives. Veuillez réessayer plus tard.');
      } else {
        setError('Une erreur est survenue lors de la connexion.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="border-white/10 bg-white/10 backdrop-blur-md shadow-2xl text-white animate-in fade-in zoom-in duration-500">
      <CardHeader className="space-y-1 text-center">
        <div className="flex justify-center mb-6">
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-cyan-400 to-blue-600 rounded-2xl blur opacity-75 group-hover:opacity-100 transition duration-1000 group-hover:duration-200 animate-tilt"></div>
            <div className="relative h-16 w-16 rounded-2xl bg-blue-600 flex items-center justify-center border border-white/10 shadow-2xl animate-float">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="lightning-gradient" x1="-100%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="white" stopOpacity="0" />
                    <stop offset="50%" stopColor="#fbbf24" stopOpacity="1" />
                    <stop offset="100%" stopColor="white" stopOpacity="0" />
                    <animate attributeName="x1" values="-100%; 200%" dur="2.5s" repeatCount="indefinite" />
                    <animate attributeName="x2" values="0%; 300%" dur="2.5s" repeatCount="indefinite" />
                    <animate attributeName="y1" values="0%; 0%" dur="2.5s" repeatCount="indefinite" />
                    <animate attributeName="y2" values="100%; 100%" dur="2.5s" repeatCount="indefinite" />
                  </linearGradient>
                </defs>
                <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="url(#lightning-gradient)" />
              </svg>
            </div>
          </div>
        </div>
        <CardTitle className="text-3xl font-bold tracking-tight text-white mt-4">Zenergy</CardTitle>
        <CardDescription className="text-slate-300">
          Entrez vos identifiants pour accéder à Zenergy
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive" className="bg-red-500/10 border-red-500/50 text-red-200">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2 animate-in slide-in-from-bottom-4 fade-in duration-500 delay-100 fill-mode-backwards">
            <Label htmlFor="email" className="text-slate-200">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="nom@exemple.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
              className="bg-slate-950/50 border-white/10 text-white placeholder:text-slate-500 focus:border-cyan-500/50 focus:ring-cyan-500/50"
            />
          </div>
          <div className="space-y-2 animate-in slide-in-from-bottom-4 fade-in duration-500 delay-200 fill-mode-backwards">
            <Label htmlFor="password" className="text-slate-200">Mot de passe</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
              className="bg-slate-950/50 border-white/10 text-white focus:border-cyan-500/50 focus:ring-cyan-500/50"
            />
          </div>
          <Button
            type="submit"
            className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white border-0 shadow-lg shadow-cyan-500/20 transition-all duration-300 animate-in slide-in-from-bottom-4 fade-in duration-500 delay-300 fill-mode-backwards"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Connexion...
              </>
            ) : (
              'Se connecter'
            )}
          </Button>
        </form>

        <div className="relative my-6 animate-in fade-in duration-700 delay-500">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-white/10" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-transparent px-2 text-slate-400">
              Ou continuer avec
            </span>
          </div>
        </div>

        <Button
          variant="outline"
          type="button"
          className="w-full bg-white/5 border-white/10 text-white hover:bg-white/10 hover:text-white transition-all duration-300 animate-in slide-in-from-bottom-4 fade-in duration-500 delay-500 fill-mode-backwards"
          disabled={isLoading}
          onClick={async () => {
            setError('');
            setIsLoading(true);
            try {
              await loginWithGoogle();
              router.push('/dashboard');
            } catch (err: any) {
              console.error(err);
              setError('Erreur lors de la connexion avec Google.');
            } finally {
              setIsLoading(false);
            }
          }}
        >
          <svg className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512">
            <path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"></path>
          </svg>
          Google
        </Button>
      </CardContent>
      <CardFooter className="flex justify-center animate-in fade-in duration-1000 delay-700">
        <p className="text-xs text-slate-400">
          © 2024 Zenergy. Tous droits réservés.
        </p>
      </CardFooter>
    </Card>
  );
}
