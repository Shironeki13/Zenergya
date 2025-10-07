
'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PlusCircle, Trash2, Edit, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  createUser, updateUser, deleteUser,
  createRole, updateRole, deleteRole,
  getUsers, getRoles
} from "@/services/firestore";
import type { User, Role } from "@/lib/types";

// Section pour les Rôles
const RolesSection = () => {
    const [roles, setRoles] = useState<Role[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingRole, setEditingRole] = useState<Role | null>(null);
    const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);
    const [name, setName] = useState('');
    
    const loadRoles = useCallback(async () => {
        setIsLoading(true);
        try {
            const rolesData = await getRoles();
            setRoles(rolesData);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de charger les rôles.", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        loadRoles();
    }, [loadRoles]);


    const resetForm = () => { setName(''); setEditingRole(null); };

    const handleOpenDialog = (role: Role | null = null) => {
        setEditingRole(role);
        setName(role ? role.name : '');
        setDialogOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        setIsSubmitting(true);
        try {
            if (editingRole) {
                await updateRole(editingRole.id, name);
                toast({ title: "Succès", description: "Rôle mis à jour." });
            } else {
                await createRole(name);
                toast({ title: "Succès", description: "Rôle créé." });
            }
            await loadRoles();
            setDialogOpen(false);
            resetForm();
        } catch (error) {
            toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleDelete = async () => {
        if (!roleToDelete) return;
        try {
            await deleteRole(roleToDelete.id);
            toast({ title: "Succès", description: "Rôle supprimé." });
            await loadRoles();
            setRoleToDelete(null);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de supprimer le rôle.", variant: "destructive" });
        }
    };

    return (
        <Card>
             <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Rôles</CardTitle>
                        <CardDescription>Gérez les rôles des utilisateurs.</CardDescription>
                    </div>
                     <Button size="sm" className="gap-1" onClick={() => handleOpenDialog()}>
                        <PlusCircle className="h-4 w-4" /> Créer un Rôle
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader><TableRow><TableHead>Nom du Rôle</TableHead><TableHead className="w-[100px] text-right">Actions</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {isLoading ? ( <TableRow><TableCell colSpan={2} className="text-center h-24"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /></TableCell></TableRow>
                            ) : roles.length === 0 ? ( <TableRow><TableCell colSpan={2} className="text-center">Aucun rôle trouvé.</TableCell></TableRow>
                            ) : (
                                roles.map(role => (
                                    <TableRow key={role.id}>
                                        <TableCell className="font-medium">{role.name}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(role)}><Edit className="h-4 w-4" /></Button>
                                            <Dialog open={!!roleToDelete && roleToDelete.id === role.id} onOpenChange={(isOpen) => !isOpen && setRoleToDelete(null)}>
                                                <DialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setRoleToDelete(role)}><Trash2 className="h-4 w-4" /></Button>
                                                </DialogTrigger>
                                                <DialogContent>
                                                    <DialogHeader><DialogTitle>Supprimer {roleToDelete?.name}</DialogTitle><DialogDescription>Cette action est irréversible. Les utilisateurs assignés à ce rôle perdront leurs permissions.</DialogDescription></DialogHeader>
                                                    <DialogFooter>
                                                        <Button variant="outline" onClick={() => setRoleToDelete(null)}>Annuler</Button>
                                                        <Button variant="destructive" onClick={handleDelete}>Confirmer</Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader><DialogTitle>{editingRole ? "Modifier le rôle" : "Nouveau Rôle"}</DialogTitle></DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2"><Label htmlFor="roleName">Nom du Rôle</Label><Input id="roleName" value={name} onChange={e => setName(e.target.value)} required /></div>
                            <DialogFooter>
                                <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
                                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Enregistrement..." : "Enregistrer"}</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};

// Section pour les Utilisateurs
const UsersSection = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [userToDelete, setUserToDelete] = useState<User | null>(null);

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [roleId, setRoleId] = useState('');

    const loadUsersAndRoles = useCallback(async () => {
        setIsLoading(true);
        try {
            const [usersData, rolesData] = await Promise.all([getUsers(), getRoles()]);
            setUsers(usersData);
            setRoles(rolesData);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de charger les utilisateurs et les rôles.", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);
    
    useEffect(() => {
        loadUsersAndRoles();
    }, [loadUsersAndRoles]);

    const resetForm = () => { setName(''); setEmail(''); setRoleId(''); setEditingUser(null); };

    const handleOpenDialog = (user: User | null = null) => {
        setEditingUser(user);
        if (user) {
            setName(user.name);
            setEmail(user.email);
            setRoleId(user.roleId);
        } else {
            resetForm();
        }
        setDialogOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !email.trim() || !roleId) return;
        setIsSubmitting(true);
        try {
            const userData = { name, email, roleId };
            if (editingUser) {
                await updateUser(editingUser.id, userData);
                toast({ title: "Succès", description: "Utilisateur mis à jour." });
            } else {
                await createUser(userData);
                toast({ title: "Succès", description: "Utilisateur créé." });
            }
            await loadUsersAndRoles();
            setDialogOpen(false);
            resetForm();
        } catch (error) {
            toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!userToDelete) return;
        try {
            await deleteUser(userToDelete.id);
            toast({ title: "Succès", description: "L'utilisateur a été supprimé." });
            await loadUsersAndRoles();
            setUserToDelete(null);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de supprimer l'utilisateur.", variant: "destructive" });
        }
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Utilisateurs</CardTitle>
                        <CardDescription>Gérez les utilisateurs et leurs rôles.</CardDescription>
                    </div>
                     <Button size="sm" className="gap-1" onClick={() => handleOpenDialog()}>
                        <PlusCircle className="h-4 w-4" /> Créer un Utilisateur
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Nom</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Rôle</TableHead>
                                <TableHead className="w-[100px] text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? ( <TableRow><TableCell colSpan={4} className="text-center h-24"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /></TableCell></TableRow>
                            ) : users.length === 0 ? ( <TableRow><TableCell colSpan={4} className="text-center">Aucun utilisateur.</TableCell></TableRow>
                            ) : (
                                users.map(user => (
                                    <TableRow key={user.id}>
                                        <TableCell className="font-medium">{user.name}</TableCell>
                                        <TableCell>{user.email}</TableCell>
                                        <TableCell>{user.roleName}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(user)}><Edit className="h-4 w-4" /></Button>
                                            <Dialog open={!!userToDelete && userToDelete.id === user.id} onOpenChange={(isOpen) => !isOpen && setUserToDelete(null)}>
                                                <DialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setUserToDelete(user)}><Trash2 className="h-4 w-4" /></Button>
                                                </DialogTrigger>
                                                <DialogContent>
                                                    <DialogHeader>
                                                        <DialogTitle>Supprimer {userToDelete?.name}</DialogTitle>
                                                        <DialogDescription>Cette action est irréversible et supprimera l'accès de l'utilisateur.</DialogDescription>
                                                    </DialogHeader>
                                                    <DialogFooter>
                                                        <Button variant="outline" onClick={() => setUserToDelete(null)}>Annuler</Button>
                                                        <Button variant="destructive" onClick={handleDelete}>Confirmer</Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader><DialogTitle>{editingUser ? "Modifier l'utilisateur" : "Nouvel utilisateur"}</DialogTitle></DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="userName">Nom</Label>
                                <Input id="userName" value={name} onChange={e => setName(e.target.value)} required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="userEmail">Email</Label>
                                <Input id="userEmail" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="role">Rôle</Label>
                                <Select onValueChange={setRoleId} value={roleId}>
                                    <SelectTrigger><SelectValue placeholder="Sélectionner un rôle" /></SelectTrigger>
                                    <SelectContent>
                                        {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <DialogFooter>
                                <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
                                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Enregistrement..." : "Enregistrer"}</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};


export default function UsersPage() {
  return (
    <div className="space-y-6">
       <div>
        <h1 className="text-lg font-medium">Gestion des Utilisateurs</h1>
        <p className="text-sm text-muted-foreground">
          Gérez les utilisateurs et les rôles de votre organisation.
        </p>
      </div>
      <Tabs defaultValue="users" className="w-full">
        <TabsList>
          <TabsTrigger value="users">Utilisateurs</TabsTrigger>
          <TabsTrigger value="roles">Rôles</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <UsersSection />
        </TabsContent>
        <TabsContent value="roles">
          <RolesSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
