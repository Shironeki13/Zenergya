
"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { ChevronLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/services/firestore"

const clientFormSchema = z.object({
  name: z.string().min(2, {
    message: "Le nom du client doit comporter au moins 2 caractères.",
  }),
  contactEmail: z.string().email({
    message: "Veuillez saisir une adresse email valide.",
  }).optional().or(z.literal('')),
  billingAddress: z.string().optional(),
})

type ClientFormValues = z.infer<typeof clientFormSchema>

export default function NewClientPage() {
  const router = useRouter();
  const { toast } = useToast()

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: {
      name: "",
      contactEmail: "",
      billingAddress: "",
    },
  })

  async function onSubmit(data: ClientFormValues) {
    try {
      await createClient(data);
      toast({
        title: "Client Créé",
        description: "Le nouveau client a été créé avec succès.",
      });
      router.push('/clients');
    } catch (error) {
      console.error("Échec de la création du client:", error);
      toast({
        title: "Erreur",
        description: "Échec de la création du client. Veuillez réessayer.",
        variant: "destructive"
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-4">
            <Link href="/clients">
                <Button variant="outline" size="icon">
                    <ChevronLeft className="h-4 w-4" />
                </Button>
            </Link>
            <div>
              <CardTitle>Nouveau Client</CardTitle>
              <CardDescription>Remplissez le formulaire pour créer une nouvelle fiche client.</CardDescription>
            </div>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Raison Sociale</FormLabel>
                  <FormControl>
                    <Input placeholder="Wayne Enterprises" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="contactEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email de Contact</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="contact@wayne.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
             <FormField
              control={form.control}
              name="billingAddress"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Adresse de Facturation</FormLabel>
                  <FormControl>
                    <Textarea placeholder="1007 Mountain Drive, Gotham" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit">Créer le Client</Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
