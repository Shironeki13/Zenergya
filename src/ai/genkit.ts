import {genkit} from 'genkit';
import {vertexAI} from '@genkit-ai/vertexai';
import {config} from 'dotenv';

config();

export const ai = genkit({
  plugins: [
    vertexAI({ 
        projectId: 'zenergy-f8276', // From your firebase.ts
        location: 'us-central1' 
    })
  ],
});
