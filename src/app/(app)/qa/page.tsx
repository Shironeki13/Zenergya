'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Sparkles } from 'lucide-react';
import { askQuestion } from '@/ai/flows/qa-flow';

export default function QAPage() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question) return;

    setIsLoading(true);
    setAnswer('');
    setError('');

    try {
      const result = await askQuestion({ question });
      setAnswer(result.answer);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Une erreur inconnue est survenue.';
      setError(errorMessage);
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Question / Réponse avec l'IA</CardTitle>
          <CardDescription>
            Posez une question simple pour tester l'intégration de l'IA.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="question">Votre question</Label>
              <Input
                id="question"
                placeholder="Quelle est la capitale de la France ?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                disabled={isLoading}
              />
            </div>
            {answer && (
              <div className="p-4 bg-muted/50 rounded-lg border">
                <p className="font-semibold flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Réponse
                </p>
                <p className="text-muted-foreground mt-2">{answer}</p>
              </div>
            )}
            {error && (
              <div className="p-4 bg-destructive/10 rounded-lg border border-destructive/50 text-destructive">
                <p className="font-semibold">Erreur</p>
                <p className="text-sm mt-1">{error}</p>
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={isLoading || !question}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Poser la question
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
