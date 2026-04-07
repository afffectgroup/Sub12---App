import { GoogleGenAI, Type, FunctionDeclaration, Modality } from "@google/genai";
import { AthleteProfile, Workout, ChatMessage } from "../types";
import { differenceInDays, parseISO } from "date-fns";

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

export async function generateDailyCoachInsight(profile: AthleteProfile, lastActivity: any, todayWorkout: Workout | undefined, currentPlan: Workout[]): Promise<string> {
  const planContext = currentPlan.slice(0, 3).map(w => `${w.date}: ${w.title}`).join(', ');
  const gender = profile.coachGender === 'Woman' ? "une coach femme" : "un coach homme";
  const coachName = profile.coachName || "Coach Sub12";
  
  const prompt = `
    Tu es "${coachName}", ${gender} d'élite. Génère un message TRÈS COURT (max 20-30 mots), percutant et ultra-motivant pour ${profile.name}.
    
    Contexte:
    - Objectif: ${profile.targetRace} (${differenceInDays(parseISO(profile.raceDate), new Date())}j).
    - Dernière activité Strava: ${lastActivity ? `${lastActivity.name}, ${Math.round(lastActivity.distance / 1000)}km, ${lastActivity.total_elevation_gain}m D+` : "Aucune"}.
    - Séance aujourd'hui: ${todayWorkout ? `${todayWorkout.title} (${todayWorkout.durationMinutes}min)` : "Repos"}.
    - Prochaines séances: ${planContext}.
    
    Directives:
    - Sois direct, pas de politesses inutiles.
    - Utilise un ton de leader, inspirant.
    - Fais un lien rapide entre son activité passée et son plan futur.
    - Maximum 2 phrases courtes.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return response.text || "Focus sur l'objectif. Chaque watt compte.";
  } catch (error) {
    console.error("Error generating daily insight:", error);
    return "Focus sur la séance du jour. La régularité est la clé.";
  }
}

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

export async function getCoachAdvice(message: string, history: { role: 'user' | 'model', content: string }[], profile: AthleteProfile, currentPlan: Workout[], lastActivities: any[]) {
  if (!apiKey) {
    console.error("GEMINI_API_KEY is missing. Please set it in the environment.");
    return { text: "Désolé, je ne peux pas répondre pour le moment car ma clé API est manquante. Vérifie la configuration dans les paramètres." };
  }

  const planContext = currentPlan.slice(0, 7).map(w => `${w.date}: ${w.title} (${w.sport}, ${w.durationMinutes}min)`).join('\n');
  const activityContext = lastActivities.slice(0, 3).map(a => `${a.name}: ${Math.round(a.distance / 1000)}km, ${a.total_elevation_gain}m D+`).join('\n');
  const gender = profile.coachGender === 'Woman' ? "une coach femme" : "un coach homme";
  const coachName = profile.coachName || "Coach Sub12";

  const systemInstruction = `
    Tu es "${coachName}", ${gender} d'élite dédiée aux entrepreneurs et cadres qui visent le Sub12 sur Ironman.
    Ton athlète s'appelle ${profile.name}.
    Objectif principal: ${profile.targetRace} (${profile.raceDate}).
    Profil: ${profile.fitnessLevel}, Métier: ${profile.profession}.
    
    CONTEXTE ACTUEL:
    PLANNING DES 7 PROCHAINS JOURS:
    ${planContext}
    
    DERNIÈRES ACTIVITÉS STRAVA:
    ${activityContext}
    
    TON ADN:
    1. CONCISION EXTRÊME: Tes réponses doivent être courtes, percutantes et aller droit au but. Pas de blabla.
    2. MOTIVATION: Sois inspirant, exigeant mais bienveillant.
    3. EXPERTISE: Utilise le vocabulaire technique (TSS, FTP, Z2) quand c'est pertinent.
    4. ADAPTATION: Si l'athlète parle de fatigue ou manque de temps, propose d'adapter le plan via updateWorkouts.
    
    RÈGLES D'OR:
    - Ne dépasse jamais 2-3 paragraphes courts.
    - Termine par une question ou un encouragement fort.
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

export async function generateSpeech(text: string, gender?: 'Man' | 'Woman'): Promise<string | undefined> {
  console.log("Generating speech for text:", text.substring(0, 50) + "...");
  const voiceName = gender === 'Woman' ? 'Kore' : 'Zephyr';
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Dis de manière motivante et professionnelle: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (audioData) {
      console.log("Speech generated successfully, data length:", audioData.length);
    } else {
      console.warn("Speech generation returned no audio data.");
    }
    return audioData;
  } catch (error) {
    console.error("TTS Error:", error);
    return undefined;
  }
}
