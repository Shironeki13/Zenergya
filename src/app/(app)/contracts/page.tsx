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
import { contracts } from '@/data/mock-data';

export default function ContractsPage() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Contracts</CardTitle>
            <CardDescription>
              Manage all your client contracts.
            </CardDescription>
          </div>
          <Button asChild size="sm" className="gap-1">
            <Link href="/contracts/new">
              <PlusCircle className="h-4 w-4" />
              New Contract
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">
                Billing Schedule
              </TableHead>
              <TableHead className="hidden md:table-cell">
                Start Date
              </TableHead>
              <TableHead className="hidden md:table-cell">End Date</TableHead>
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
                  {contract.billingSchedule.charAt(0).toUpperCase() + contract.billingSchedule.replace('_', ' ').slice(1)}
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
                        <span className="sr-only">Toggle menu</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem asChild><Link href={`/contracts/${contract.id}`}>View Details</Link></DropdownMenuItem>
                      <DropdownMenuItem>Edit</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">
                        Delete
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
