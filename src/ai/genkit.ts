import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';
import {config} from 'dotenv';

config();

if (!process.env.GEMINI_API_KEY) {
  console.error("ERREUR CRITIQUE: La variable GEMINI_API_KEY est manquante !");
}

export const ai = genkit({
  plugins: [
    googleAI({
      apiKey: process.env.GEMINI_API_KEY,
    }),
  ],
});
