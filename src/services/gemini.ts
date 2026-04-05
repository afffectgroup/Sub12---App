import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { AthleteProfile, Workout, ChatMessage } from "../types";

const apiKey = process.env.GEMINI_API_KEY as string;
const ai = new GoogleGenAI({ apiKey });

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

  const prompt = `
    Génère un plan d'entraînement de 7 jours pour un athlète préparant un ${profile.targetRace} le ${profile.raceDate}.
    Profil: ${profile.fitnessLevel}, Objectif d'heures hebdo: ${profile.weeklyHoursGoal}h.
    Âge: ${profile.age}, Poids: ${profile.weight}kg, Taille: ${profile.height}cm.
    Métier: ${profile.profession}.
    Courses secondaires: ${(profile.secondaryRaces || []).join(', ')}.
    Expérience: ${profile.experience}.
    ${historyContext}
    
    Retourne un tableau JSON d'objets Workout avec les propriétés suivantes:
    - id: string unique
    - date: string (format YYYY-MM-DD, commence par aujourd'hui)
    - sport: 'Swim' | 'Bike' | 'Run' | 'Strength' | 'Rest'
    - title: titre court de la séance
    - description: détails de la séance (échauffement, corps de séance, récup)
    - durationMinutes: nombre
    - intensity: 'Low' | 'Moderate' | 'High' | 'Intervals'
    - completed: false
  `;

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
        },
      },
    },
  });

  try {
    return JSON.parse(response.text || "[]");
  } catch (e) {
    console.error("Failed to parse training plan", e);
    return [];
  }
}

export async function getCoachAdvice(message: string, history: { role: 'user' | 'model', content: string }[], profile: AthleteProfile) {
  const systemInstruction = `
    Tu es un coach expert en endurance (Ironman, Marathon, Ultra-trail). 
    Ton athlète s'appelle ${profile.name}. 
    Il prépare un ${profile.targetRace} pour le ${profile.raceDate}.
    Niveau: ${profile.fitnessLevel}.
    Âge: ${profile.age}, Poids: ${profile.weight}kg, Taille: ${profile.height}cm.
    Métier: ${profile.profession}.
    Courses secondaires: ${(profile.secondaryRaces || []).join(', ')}.
    Sois encourageant, technique et précis. 
    Utilise des termes de triathlon (Z2, FTP, TSS, Allure course, etc.).
    Si l'athlète est fatigué ou blessé, conseille toujours la prudence et le repos.
    Tu as la capacité de mettre à jour son planning d'entraînement si nécessaire via l'outil updateWorkouts.
  `;

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
}
