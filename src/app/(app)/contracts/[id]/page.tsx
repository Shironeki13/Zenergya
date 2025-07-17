import Link from "next/link";
import { contracts, meterReadings, invoices } from "@/data/mock-data";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChevronLeft,
  Calendar,
  FileClock,
  CheckCircle,
  Gauge,
  FileText,
  PlusCircle,
} from "lucide-react";

export default function ContractDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const contract = contracts.find((c) => c.id === params.id);
  if (!contract) {
    notFound();
  }

  const contractMeterReadings = meterReadings.filter(
    (mr) => mr.contractId === contract.id
  );
  const contractInvoices = invoices.filter(
    (inv) => inv.contractId === contract.id
  );

  const serviceLabels = {
    hot_water: "Hot Water",
    heating: "Heating",
    fixed_subscription: "Fixed Subscription",
  };

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex items-center gap-4">
        <Link href="/contracts">
          <Button variant="outline" size="icon" className="h-7 w-7">
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Back</span>
          </Button>
        </Link>
        <h1 className="flex-1 shrink-0 whitespace-nowrap text-xl font-semibold tracking-tight sm:grow-0">
          {contract.clientName}
        </h1>
        <Badge variant="outline" className="ml-auto sm:ml-0">
          {contract.status.charAt(0).toUpperCase() + contract.status.slice(1)}
        </Badge>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle>Contract Details</CardTitle>
            <CardDescription>{contract.id}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex items-center">
                <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>
                  {new Date(contract.startDate).toLocaleDateString()} -{" "}
                  {new Date(contract.endDate).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center">
                <FileClock className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>
                  Billed{" "}
                  {contract.billingSchedule.charAt(0).toUpperCase() +
                    contract.billingSchedule.replace("_", " ").slice(1)}
                </span>
              </div>
              <div className="flex items-start">
                <CheckCircle className="mr-2 h-4 w-4 mt-1 text-muted-foreground" />
                <div>
                  <span className="font-medium">Services:</span>
                  <ul className="list-disc pl-5">
                    {contract.services.map((service) => (
                      <li key={service}>{serviceLabels[service]}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-5 w-5" /> Meter Readings
            </CardTitle>
            <CardDescription>
              Input and view historical meter readings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex items-end gap-2">
              <div className="grid gap-2 flex-1">
                <Label htmlFor="reading" className="sr-only">
                  Reading
                </Label>
                <Input id="reading" type="number" placeholder="Enter reading..." />
              </div>
              <Button type="submit">Save</Button>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col items-start gap-2 text-sm">
             <div className="font-medium">Previous Readings</div>
             <ul className="w-full">
              {contractMeterReadings.map(r => (
                <li key={r.id} className="flex justify-between py-1 border-b last:border-0">
                  <span>{new Date(r.date).toLocaleDateString()} - {serviceLabels[r.service]}</span>
                  <span>{r.reading} {r.unit}</span>
                </li>
              ))}
             </ul>
          </CardFooter>
        </Card>
        
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" /> Invoices
            </CardTitle>
            <CardDescription>
              Generate and track invoices for this contract.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contractInvoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium"><Link href={`/invoices/${invoice.id}`} className="hover:underline">{invoice.id}</Link></TableCell>
                    <TableCell>
                      <Badge variant="outline">{invoice.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      ${invoice.total.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
          <CardFooter>
            <Button size="sm" variant="outline" className="w-full gap-1">
              <PlusCircle className="h-4 w-4" />
              Generate Invoice
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
