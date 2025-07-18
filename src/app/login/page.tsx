"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";

export default function LoginPage() {
  const router = useRouter();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // Pour cette démo, nous naviguons simplement vers le tableau de bord.
    router.push("/dashboard");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center">
          <Logo />
          <CardTitle className="pt-4">Bon retour</CardTitle>
          <CardDescription>Entrez vos identifiants pour accéder à votre compte</CardDescription>
        </CardHeader>
        <form onSubmit={handleLogin}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="m@exemple.com" required />
            </div>
            <div className="space-y-2">
              <div className="flex items-center">
                <Label htmlFor="password">Mot de passe</Label>
                <a href="#" className="ml-auto inline-block text-sm underline">
                  Mot de passe oublié ?
                </a>
              </div>
              <Input id="password" type="password" required />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full">Se connecter</Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
