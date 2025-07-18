"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { CalendarIcon, ChevronLeft } from "lucide-react"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import React, { useState, useEffect } from 'react';

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Checkbox } from "@/components/ui/checkbox"
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createContract, getActivities, getSchedules } from "@/services/firestore"
import type { Activity, Schedule } from "@/lib/types"


const contractFormSchema = z.object({
  clientName: z.string().min(2, {
    message: "Le nom du client doit comporter au moins 2 caractères.",
  }),
  startDate: z.date({
    required_error: "Une date de début est requise.",
  }),
  endDate: z.date({
    required_error: "Une date de fin est requise.",
  }),
  billingSchedule: z.string({
    required_error: "Un échéancier de facturation est requis.",
  }),
  activities: z.array(z.string()).refine((value) => value.some((item) => item), {
    message: "Vous devez sélectionner au moins une prestation.",
  }),
})

type ContractFormValues = z.infer<typeof contractFormSchema>

const defaultValues: Partial<ContractFormValues> = {
  activities: [],
}

export default function NewContractPage() {
  const router = useRouter();
  const { toast } = useToast()
  const [activities, setActivities] = useState<Activity[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  const form = useForm<ContractFormValues>({
    resolver: zodResolver(contractFormSchema),
    defaultValues,
  })

  useEffect(() => {
    async function fetchData() {
      try {
        const [fetchedActivities, fetchedSchedules] = await Promise.all([
            getActivities(),
            getSchedules()
        ]);
        setActivities(fetchedActivities);
        setSchedules(fetchedSchedules);
      } catch (error) {
        toast({
          title: "Erreur",
          description: "Impossible de charger les données de paramétrage.",
          variant: "destructive"
        })
      }
    }
    fetchData();
  }, [toast]);

  async function onSubmit(data: ContractFormValues) {
    try {
      await createContract(data);
      toast({
        title: "Contrat Créé",
        description: "Le nouveau contrat a été créé avec succès.",
      });
      router.push('/contracts');
    } catch (error) {
      console.error("Échec de la création du contrat:", error);
      toast({
        title: "Erreur",
        description: "Échec de la création du contrat. Veuillez réessayer.",
        variant: "destructive"
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-4">
            <Link href="/contracts">
                <Button variant="outline" size="icon">
                    <ChevronLeft className="h-4 w-4" />
                </Button>
            </Link>
            <div>
              <CardTitle>Nouveau Contrat</CardTitle>
              <CardDescription>Remplissez le formulaire pour créer un nouveau contrat client.</CardDescription>
            </div>
        </div>
      </CardHeader>
      <CardContent>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <FormField
            control={form.control}
            name="clientName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nom du Client</FormLabel>
                <FormControl>
                  <Input placeholder="Stark Industries" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <FormField
              control={form.control}
              name="startDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Date de Début</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant={"outline"}
                          className={cn(
                            "w-full pl-3 text-left font-normal",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {field.value ? (
                            format(field.value, "PPP", { locale: fr })
                          ) : (
                            <span>Choisir une date</span>
                          )}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        disabled={(date) =>
                          date < new Date("1900-01-01")
                        }
                        initialFocus
                        locale={fr}
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="endDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Date de Fin</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant={"outline"}
                          className={cn(
                            "w-full pl-3 text-left font-normal",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {field.value ? (
                            format(field.value, "PPP", { locale: fr })
                          ) : (
                            <span>Choisir une date</span>
                          )}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        initialFocus
                        locale={fr}
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="billingSchedule"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Échéancier de Facturation</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionnez un échéancier" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {schedules.map((schedule) => (
                      <SelectItem key={schedule.id} value={schedule.name}>
                        {schedule.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="activities"
            render={() => (
              <FormItem>
                <div className="mb-4">
                  <FormLabel className="text-base">Prestations</FormLabel>
                  <FormDescription>
                    Sélectionnez les prestations incluses dans ce contrat.
                  </FormDescription>
                </div>
                {activities.map((item) => (
                  <FormField
                    key={item.id}
                    control={form.control}
                    name="activities"
                    render={({ field }) => {
                      return (
                        <FormItem
                          key={item.id}
                          className="flex flex-row items-start space-x-3 space-y-0"
                        >
                          <FormControl>
                            <Checkbox
                              checked={field.value?.includes(item.name)}
                              onCheckedChange={(checked) => {
                                return checked
                                  ? field.onChange([...(field.value || []), item.name])
                                  : field.onChange(
                                      field.value?.filter(
                                        (value) => value !== item.name
                                      )
                                    )
                              }}
                            />
                          </FormControl>
                          <FormLabel className="font-normal">
                            {item.name}
                          </FormLabel>
                        </FormItem>
                      )
                    }}
                  />
                ))}
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit">Créer le Contrat</Button>
        </form>
      </Form>
      </CardContent>
    </Card>
  )
}
