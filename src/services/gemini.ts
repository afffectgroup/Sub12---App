import { GoogleGenAI, Type, FunctionDeclaration, Modality } from "@google/genai";
import { AthleteProfile, Workout, ChatMessage } from "../types";

const apiKey = process.env.GEMINI_API_KEY as string;
if (!apiKey || apiKey === "undefined") {
  console.warn("GEMINI_API_KEY is not defined in the environment. Chat and Plan generation will fail.");
} else {
  console.log("GEMINI_API_KEY is defined.");
}
const ai = new GoogleGenAI({ apiKey: (apiKey === "undefined" ? "" : apiKey) });

const updateWorkoutsTool: FunctionDeclaration = {
  name: "updateWorkouts",
  description: "Met à jour ou ajoute des séances d'entraînement dans le planning de l'athlète (ex: suite à une blessure, fatigue, ou demande spécifique).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      newWorkouts: {
        type: Type.ARRAY,
        description: "Liste complète des séances pour les 7 prochains jours.",
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            date: { type: Type.STRING },
            sport: { type: Type.STRING },
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            durationMinutes: { type: Type.NUMBER },
            intensity: { type: Type.STRING },
            completed: { type: Type.BOOLEAN },
          },
          required: ["id", "date", "sport", "title", "description", "durationMinutes", "intensity", "completed"],
        }
      }
    },
    required: ["newWorkouts"]
  }
};

export async function generateTrainingPlan(profile: AthleteProfile, chatHistory: ChatMessage[] = []): Promise<Workout[]> {
  const historyContext = chatHistory.length > 0 
    ? `Prends en compte les échanges récents avec l'athlète: ${chatHistory.slice(-5).map(h => `${h.role}: ${h.content}`).join(' | ')}`
    : "";

  // Use local date to avoid UTC offset issues
  const today = new Date().toLocaleDateString('en-CA'); 

  const prompt = `
    Génère un plan d'entraînement de 7 jours pour un athlète préparant un ${profile.targetRace} le ${profile.raceDate}.
    Profil: ${profile.fitnessLevel}, Objectif d'heures hebdo: ${profile.weeklyHoursGoal}h.
    Âge: ${profile.age}, Poids: ${profile.weight}kg, Taille: ${profile.height}cm.
    Métier: ${profile.profession}.
    Courses secondaires: ${(profile.secondaryRaces || []).map(r => `${r.name} (${r.date} à ${r.location}, Objectif: ${r.objective})`).join(', ')}.
    Expérience: ${profile.experience}.
    ${historyContext}
    
    IMPORTANT: 
    - Le plan doit commencer aujourd'hui (${today}).
    - Chaque séance doit avoir un ID unique (ex: "workout-1", "workout-2", etc.).
    - Respecte strictement le format JSON demandé.
    - Si l'athlète est fatigué ou a des contraintes (voir historique), adapte le plan en conséquence.
    - Inclus des séances variées (Z2, Seuil, Intervalles, Renforcement, Repos).
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: "ID unique de la séance" },
              date: { type: Type.STRING, description: "Date au format YYYY-MM-DD" },
              sport: { 
                type: Type.STRING, 
                enum: ['Swim', 'Bike', 'Run', 'Strength', 'Rest'],
                description: "Type de sport" 
              },
              title: { type: Type.STRING, description: "Titre court" },
              description: { type: Type.STRING, description: "Détails techniques (échauffement, corps, récup)" },
              durationMinutes: { type: Type.NUMBER, description: "Durée totale en minutes" },
              intensity: { 
                type: Type.STRING, 
                enum: ['Low', 'Moderate', 'High', 'Intervals'],
                description: "Intensité de la séance" 
              },
              completed: { type: Type.BOOLEAN, description: "Toujours false par défaut" },
            },
            required: ["id", "date", "sport", "title", "description", "durationMinutes", "intensity", "completed"],
          },
        },
      },
    });

    const text = response.text;
    console.log("Gemini Plan Response:", text);
    if (!text) {
      console.error("Empty response from Gemini");
      return [];
    }
    
    return JSON.parse(text);
  } catch (error) {
    console.error("Error generating training plan:", error);
    return [];
  }
}

export async function getCoachAdvice(message: string, history: { role: 'user' | 'model', content: string }[], profile: AthleteProfile) {
  if (!apiKey) {
    console.error("GEMINI_API_KEY is missing. Please set it in the environment.");
    return { text: "Désolé, je ne peux pas répondre pour le moment car ma clé API est manquante. Vérifie la configuration dans les paramètres." };
  }

  const systemInstruction = `
    Tu es "Coach Sub12", l'IA d'élite dédiée aux entrepreneurs et cadres qui visent le Sub12 sur Ironman (ou performance équivalente en endurance).
    Ton athlète s'appelle ${profile.name}. Utilise son prénom régulièrement pour créer une relation de confiance.
    Objectif principal: ${profile.targetRace} (${profile.raceDate}).
    Profil: ${profile.fitnessLevel}, Métier: ${profile.profession}.
    
    TON ADN:
    1. EMPATHIE ENTREPRENEURIALE: Tu comprends que son temps est sa ressource la plus rare. Si son agenda explose, adapte le plan, ne le culpabilise pas.
    2. PRÉCISION TECHNIQUE: Parle de FTP, TSS, VMA, Allure course, Z2, Seuil. Sois le coach que tu paierais 500€/mois.
    3. STRATÉGIE "SUB12": Ton but est l'efficience maximale. Pas de "junk miles". Chaque séance doit avoir un but précis.
    4. PSYCHOLOGIE: Encourage la discipline, mais rappelle que le repos fait partie de l'entraînement.
    
    RÈGLES D'OR:
    - Si fatigue/douleur: Prudence absolue. Suggère du repos ou une séance très légère.
    - Style: Direct, motivant, expert, concis. Pas de blabla inutile.
    - Tu peux modifier son planning via updateWorkouts si la situation l'exige.
    - Termine souvent par une question courte pour maintenir l'engagement.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        ...history.map(h => ({ role: h.role, parts: [{ text: h.content }] })),
        { role: 'user', parts: [{ text: message }] }
      ],
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: [updateWorkoutsTool] }]
      },
    });

    return {
      text: response.text,
      functionCalls: response.functionCalls
    };
  } catch (error) {
    console.error("Gemini Coach Advice Error:", error);
    throw error;
  }
}

export async function generateSpeech(text: string): Promise<string | undefined> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Dis de manière motivante et professionnelle: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Zephyr' },
          },
        },
      },
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  } catch (error) {
    console.error("TTS Error:", error);
    return undefined;
  }
}
