import { GoogleGenAI, Type, FunctionDeclaration, Modality } from "@google/genai";
import { AthleteProfile, Workout, ChatMessage, NutritionAdvice } from "../types";
import { differenceInDays, parseISO } from "date-fns";

const apiKey = process.env.GEMINI_API_KEY as string;
const isApiKeyValid = apiKey && apiKey !== "undefined" && apiKey.length > 0;

if (!isApiKeyValid) {
  console.warn("GEMINI_API_KEY is not defined or invalid in the environment. Chat and Plan generation will fail.");
} else {
  console.log("GEMINI_API_KEY is defined and valid.");
}
const ai = new GoogleGenAI({ apiKey: (isApiKeyValid ? apiKey : "") });

const updateWorkoutsTool: FunctionDeclaration = {
  name: "updateWorkouts",
  description: "Propose une mise à jour ou un ajout de séances d'entraînement dans le planning de l'athlète. Cette action nécessite une validation de l'utilisateur.",
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
  if (!isApiKeyValid) return "Focus sur l'objectif. La régularité est la clé.";
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
      model: "gemini-1.5-flash",
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.text || "Focus sur l'objectif. Chaque watt compte.";
  } catch (error) {
    console.error("Error generating daily insight:", error);
    return "Focus sur la séance du jour. La régularité est la clé.";
  }
}

export async function generateTrainingPlan(profile: AthleteProfile, chatHistory: ChatMessage[] = []): Promise<Workout[]> {
  if (!isApiKeyValid) return [];
  const historyContext = chatHistory.length > 0 
    ? `Prends en compte les échanges récents avec l'athlète: ${chatHistory.slice(-5).map(h => `${h.role}: ${h.content}`).join(' | ')}`
    : "";

  // Use local date to avoid UTC offset issues
  const today = new Date().toLocaleDateString('en-CA'); 

  const prompt = `
    Tu es un coach expert en triathlon longue distance. Génère un plan d'entraînement de 7 jours ultra-personnalisé pour ${profile.name}.
    
    PROFIL DE L'ATHLÈTE:
    - Objectif: ${profile.targetRace} le ${profile.raceDate}.
    - Niveau: ${profile.fitnessLevel}, Mode: ${profile.goalMode}.
    - Objectif d'heures hebdo: ${profile.weeklyHoursGoal}h.
    - Âge: ${profile.age}, Poids: ${profile.weight}kg, Taille: ${profile.height}cm.
    - Métier: ${profile.profession} (prends en compte la fatigue mentale/physique liée au métier).
    - Expérience: ${profile.experience}.
    
    ${historyContext}
    
    DIRECTIVES DE PLANIFICATION:
    1. PROGRESSION: Le plan doit être cohérent avec le niveau ${profile.fitnessLevel}.
    2. VARIÉTÉ: Inclus un mélange de :
       - Endurance Fondamentale (Zone 2) - la base.
       - Travail de Seuil (Tempo/Z3-Z4).
       - Intervalles (VMA/PMA) pour la puissance.
       - Renforcement musculaire spécifique (Gainage/Force).
       - Repos complet ou actif.
    3. RÉALISME: Ne dépasse pas l'objectif de ${profile.weeklyHoursGoal}h par semaine.
    4. FORMAT: Utilise strictement le format JSON fourni.
    
    IMPORTANT: Le plan doit commencer aujourd'hui (${today}).
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
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

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    console.log("Gemini Plan Response:", text);
    return JSON.parse(text);
  } catch (error) {
    console.error("Error generating training plan:", error);
    return [];
  }
}

export async function getCoachAdvice(
  message: string, 
  history: { role: 'user' | 'model', content: string }[], 
  profile: AthleteProfile, 
  currentPlan: Workout[], 
  lastActivities: any[],
  onStream?: (text: string) => void,
  image?: string
) {
  if (!isApiKeyValid) {
    console.error("GEMINI_API_KEY is missing or invalid.");
    return { text: "Désolé, je ne peux pas répondre car la clé API Gemini est manquante ou invalide. Tu peux la configurer dans les paramètres de l'application (icône engrenage en haut à droite)." };
  }

  const planContext = currentPlan.slice(0, 10).map(w => `- ${w.date}: ${w.title} (${w.sport}, ${w.durationMinutes}min, ${w.intensity})`).join('\n');
  const activityContext = lastActivities.slice(0, 5).map(a => `- ${a.name}: ${Math.round(a.distance / 1000 * 10) / 10}km, ${a.total_elevation_gain}m D+, ${Math.round(a.moving_time / 60)}min`).join('\n');
  const prContext = profile.prs ? `\nRECORDS PERSONNELS (PRs):\n- VMA: ${profile.prs.vma}km/h\n- FTP: ${profile.prs.ftp}W\n- CSS: ${profile.prs.css}\n- FC Max: ${profile.prs.maxHr}` : "";
  const gender = profile.coachGender === 'Woman' ? "une coach femme" : "un coach homme";
  const coachName = profile.coachName || "Coach Sub12";
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const systemInstruction = `
    Tu es "${coachName}", ${gender} d'élite spécialisée dans le triathlon longue distance (Ironman). 
    Ton expertise s'adresse à des athlètes comme ${profile.name}, souvent des entrepreneurs ou cadres avec un emploi du temps chargé, visant le "Sub12" (moins de 12h sur Ironman).

    TON IDENTITÉ:
    - Tu es un coach de classe mondiale. Tu es exigeant sur la discipline mais tu comprends les contraintes de la vie réelle (famille, travail).
    - Ton ton est professionnel, motivant, et basé sur les faits.
    - Tu détestes les réponses génériques. Chaque conseil doit être ancré dans les données de l'athlète.

    CONTEXTE DE L'ATHLÈTE:
    - Objectif: ${profile.targetRace} (${profile.raceDate}).
    - Niveau: ${profile.fitnessLevel}, Métier: ${profile.profession}.
    - Genre: ${profile.gender === 'Woman' ? 'Femme' : 'Homme'}.
    ${prContext}

    PLANNING ACTUEL (10 prochains jours):
    ${planContext}

    HISTORIQUE RÉCENT (Strava):
    ${activityContext}

    DATE AUJOURD'HUI: ${today}

    RÈGLES DE RÉPONSE:
    1. ANALYSE AVANT DE RÉPONDRE: Regarde toujours les dernières activités Strava par rapport au plan prévu. Si l'athlète a trop forcé ou pas assez, mentionne-le.
    2. CONCISION EXPERTE: Vise 60-100 mots. Sois dense en informations utiles.
    3. VOCABULAIRE: Utilise Z2, FTP, VMA, TSS, Allure, Cadence. Explique brièvement si l'athlète semble perdu.
    4. ADAPTATION PROACTIVE: Si l'athlète exprime un doute, une douleur ou un manque de temps, n'attends pas qu'il te le demande : propose d'ajuster le plan via "updateWorkouts".
    5. ANALYSE D'IMAGE: Si une image est fournie, décris ce que tu vois et donne un conseil technique immédiat.

    IMPORTANT: 
    - Si tu modifies le plan, explique CLAIREMENT les changements (ex: "J'ai allégé ta séance de demain car tu as fait une grosse sortie aujourd'hui").
    - NE METS JAMAIS de code, de JSON, ou de texte technique comme "updateWorkouts(...)" ou "print(...)" dans ta réponse texte. Ta réponse doit être uniquement du texte naturel pour l'athlète.
    - Ne décris JAMAIS tes actions internes ou l'utilisation de tes outils. Réponds directement à l'athlète.
  `;

  const maxRetries = 3;
  let retryCount = 0;

  // Limit history to last 10 messages to maintain focus and context window efficiency
  const limitedHistory = history.slice(-10);

  while (retryCount < maxRetries) {
    try {
      const userParts: any[] = [{ text: message }];
      
      if (image) {
        const base64Data = image.split(',')[1];
        const mimeType = image.split(',')[0].split(':')[1].split(';')[0];
        userParts.push({
          inlineData: {
            data: base64Data,
            mimeType: mimeType
          }
        });
      }

      const result = await ai.models.generateContentStream({
        model: "gemini-1.5-pro",
        contents: [
          ...limitedHistory.map(h => ({ role: h.role, parts: [{ text: h.content }] })),
          { role: 'user', parts: userParts }
        ],
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: [updateWorkoutsTool] }]
        },
      });

      let fullText = "";
      let functionCalls: any[] = [];

      for await (const chunk of result) {
        const chunkText = chunk.text;
        if (chunkText) {
          fullText += chunkText;
          if (onStream) onStream(fullText);
        }
        if (chunk.functionCalls) {
          functionCalls = [...functionCalls, ...chunk.functionCalls];
        }
      }

      let cleanText = fullText;
      
      // Aggressively remove any leaked JSON or function calls from the text response
      if (cleanText.includes('newWorkouts') || cleanText.includes('updateWorkouts') || cleanText.includes('{')) {
        // Remove JSON blocks
        cleanText = cleanText.replace(/\{[\s\S]*"newWorkouts"[\s\S]*\}/g, '');
        // Remove function call style leaks (e.g. print(updateWorkouts(...)) or updateWorkouts(...))
        cleanText = cleanText.replace(/(?:print\s*)?updateWorkouts\s*\([\s\S]*?\)/g, '');
        // Remove markdown code blocks
        cleanText = cleanText.replace(/```(?:json)?[\s\S]*?```/g, '');
        // Remove any remaining curly brace blocks that look like JSON
        cleanText = cleanText.replace(/\{[\s\S]*?\}/g, (match) => match.includes('newWorkouts') ? '' : match);
        cleanText = cleanText.trim();
      }

      return {
        text: cleanText || "Plan mis à jour. On continue !",
        functionCalls: functionCalls.length > 0 ? functionCalls : undefined
      };
    } catch (error: any) {
      const errorMsg = error?.message || "";
      const isRetryable = errorMsg.includes('503') || errorMsg.includes('500') || errorMsg.includes('INTERNAL') || error?.status === 503 || error?.status === 500;
      
      if (isRetryable && retryCount < maxRetries - 1) {
        retryCount++;
        const delay = Math.pow(2, retryCount) * 1000;
        console.warn(`Gemini API error (${errorMsg}), retrying in ${delay}ms... (Attempt ${retryCount}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      console.error("Gemini Coach Advice Error:", error);
      return { 
        text: "Désolé, le service d'intelligence artificielle est temporairement indisponible ou surchargé. Peux-tu réessayer dans un instant ?" 
      };
    }
  }
  
  return { text: "Désolé, j'ai rencontré une erreur technique. Peux-tu reformuler ?" };
}

export async function getNutritionAdvice(profile: AthleteProfile, currentPlan: Workout[]): Promise<NutritionAdvice | null> {
  if (!isApiKeyValid) return null;

  const planContext = currentPlan.slice(0, 7).map(w => `- ${w.date}: ${w.title} (${w.durationMinutes}min)`).join('\n');
  
  const prompt = `
    Tu es un nutritionniste expert spécialisé dans le triathlon Ironman. 
    Génère des conseils nutritionnels personnalisés pour ${profile.name}.
    
    PROFIL:
    - Âge: ${profile.age}, Poids: ${profile.weight}kg, Taille: ${profile.height}cm.
    - Niveau: ${profile.fitnessLevel}, Objectif: ${profile.targetRace}.
    - Charge d'entraînement hebdo: ${profile.weeklyHoursGoal}h.
    
    PLANNING SEMAINE:
    ${planContext}
    
    Réponds UNIQUEMENT au format JSON respectant cette structure:
    {
      "dailyCalories": number,
      "macros": { "carbs": "string", "protein": "string", "fats": "string" },
      "tips": ["string"],
      "hydration": "string",
      "preWorkout": "string",
      "postWorkout": "string"
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-1.5-pro",
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" }
    });
    
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const data = JSON.parse(text);
    return { ...data, updatedAt: Date.now() };
  } catch (error) {
    console.error("Error generating nutrition advice:", error);
    return null;
  }
}

export async function generateSpeech(text: string, gender?: 'Man' | 'Woman'): Promise<string | undefined> {
  if (!isApiKeyValid) return undefined;
  console.log("Generating speech for text:", text.substring(0, 50) + "...");
  const voiceName = gender === 'Woman' ? 'Kore' : 'Zephyr';
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
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
