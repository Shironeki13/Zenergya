"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User, Settings, Eye, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useData } from "@/context/data-context";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function UserNav() {
  const router = useRouter();
  const { currentUser, setCurrentUser, users } = useData();
  const [open, setOpen] = useState(false);

  // Default admin user (fallback)
  const defaultAdmin = {
    id: 'user-director',
    name: 'Directeur Général',
    email: 'director@zenergy.com',
    roleId: 'role-admin',
    roleName: 'Administrateur',
    modules: ['contracts', 'billing', 'settings'],
    scope: { companyIds: ['*'], agencyIds: ['*'], sectorIds: ['*'] }
  };

  const handleUserSelect = (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (user) {
      setCurrentUser(user);
      setOpen(false);
    }
  };

  const handleReset = () => {
    // In a real app, this would revert to the actually authenticated session
    // For now, we revert to our mock Director
    setCurrentUser(defaultAdmin as any);
  };

  if (!currentUser) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative h-8 w-8 rounded-full">
            <Avatar className="h-8 w-8">
              <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${currentUser.email}`} alt={currentUser.name} />
              <AvatarFallback>{currentUser.name.substring(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="end" forceMount>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{currentUser.name}</p>
              <p className="text-xs leading-none text-muted-foreground">
                {currentUser.email}
              </p>
              {currentUser.id !== 'user-director' && (
                <Badge variant="secondary" className="mt-1 w-fit text-[10px] h-5">
                  Preview Mode
                </Badge>
              )}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem>
              <User className="mr-2 h-4 w-4" />
              <span>Profil</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push('/settings')}>
              <Settings className="mr-2 h-4 w-4" />
              <span>Paramètres</span>
            </DropdownMenuItem>
            <DialogTrigger asChild>
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                <Eye className="mr-2 h-4 w-4" />
                <span>Preview As...</span>
              </DropdownMenuItem>
            </DialogTrigger>
            {currentUser.id !== 'user-director' && (
              <DropdownMenuItem onClick={handleReset} className="text-orange-600 focus:text-orange-600">
                <LogOut className="mr-2 h-4 w-4" />
                <span>Quitter Preview</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => router.push('/login')}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>Se déconnecter</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Preview As</DialogTitle>
          <DialogDescription>
            Sélectionnez un utilisateur pour voir l'application avec ses permissions.
          </DialogDescription>
        </DialogHeader>
        <Command>
          <CommandInput placeholder="Rechercher un utilisateur..." />
          <CommandList>
            <CommandEmpty>Aucun utilisateur trouvé.</CommandEmpty>
            <CommandGroup heading="Utilisateurs">
              {users.map((user) => (
                <CommandItem
                  key={user.id}
                  onSelect={() => handleUserSelect(user.id)}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`} />
                      <AvatarFallback>{user.name.substring(0, 2)}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{user.name}</span>
                      <span className="text-xs text-muted-foreground">{user.email}</span>
                    </div>
                  </div>
                  {currentUser.id === user.id && <Check className="h-4 w-4" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
