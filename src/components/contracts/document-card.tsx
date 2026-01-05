"use client";

import { LucideIcon, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";


interface DocumentCardProps {
    title: string;
    description: string;
    icon: LucideIcon;
    onClick: () => void;
    color?: string;
}

export function DocumentCard({ title, description, icon: Icon, onClick, color = "text-primary" }: DocumentCardProps) {
    return (
        <div
            onClick={onClick}
            className="cursor-pointer hover:scale-[1.02] transition-transform duration-200"
        >
            <Card className="hover:shadow-md transition-shadow hover:border-primary/50 h-full">
                <CardHeader className="flex flex-row items-center gap-4 pb-2">
                    <div className={`p-2 rounded-lg bg-muted ${color}`}>
                        <Icon className="h-6 w-6" />
                    </div>
                    <div className="space-y-1">
                        <CardTitle className="text-lg">{title}</CardTitle>
                    </div>
                </CardHeader>
                <CardContent>
                    <CardDescription className="min-h-[40px]">
                        {description}
                    </CardDescription>
                </CardContent>
            </Card>
        </div>
    );
}
