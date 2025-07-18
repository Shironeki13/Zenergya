import Link from 'next/link';
import { PlusCircle, MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getContracts } from '@/services/firestore';
import type { Contract } from '@/lib/types';

export default async function ContractsPage() {
  const contracts: Contract[] = await getContracts();
  
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Contrats</CardTitle>
            <CardDescription>
              Gérez tous les contrats de vos clients.
            </CardDescription>
          </div>
          <Button asChild size="sm" className="gap-1">
            <Link href="/contracts/new">
              <PlusCircle className="h-4 w-4" />
              Nouveau Contrat
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="hidden md:table-cell">
                Échéancier
              </TableHead>
              <TableHead className="hidden md:table-cell">
                Date de début
              </TableHead>
              <TableHead className="hidden md:table-cell">Date de fin</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contracts.map((contract) => (
              <TableRow key={contract.id}>
                <TableCell className="font-medium">{contract.clientName}</TableCell>
                <TableCell>
                  <Badge variant={contract.status === 'active' ? 'secondary' : contract.status === 'pending' ? 'outline' : 'destructive'}>
                    {contract.status.charAt(0).toUpperCase() + contract.status.slice(1)}
                  </Badge>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {contract.billingSchedule}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {new Date(contract.startDate).toLocaleDateString()}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {new Date(contract.endDate).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button aria-haspopup="true" size="icon" variant="ghost">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Ouvrir le menu</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem asChild><Link href={`/contracts/${contract.id}`}>Voir les détails</Link></DropdownMenuItem>
                      <DropdownMenuItem>Modifier</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">
                        Supprimer
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
