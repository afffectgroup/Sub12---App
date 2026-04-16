import axios from 'axios';
import { AthleteProfile, Workout, ChatMessage, NutritionAdvice } from "../types";
import { differenceInDays, parseISO } from "date-fns";

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
    const response = await axios.post('/api/ai/insight', { prompt });
    return response.data.text || "Focus sur l'objectif. Chaque watt compte.";
  } catch (error) {
    console.error("Error generating daily insight:", error);
    return "Focus sur la séance du jour. La régularité est la clé.";
  }
}

export async function generateTrainingPlan(profile: AthleteProfile, chatHistory: ChatMessage[] = []): Promise<Workout[]> {
  const historyContext = chatHistory.length > 0 
    ? `Prends en compte les échanges récents avec l'athlète: ${chatHistory.slice(-5).map(h => `${h.role}: ${h.content}`).join(' | ')}`
    : "";

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
    
    IMPORTANT: Le plan doit commencer aujourd'hui (${today}).
    
    Réponds UNIQUEMENT avec un tableau JSON de séances respectant cette structure:
    [
      {
        "id": "string",
        "date": "YYYY-MM-DD",
        "sport": "Swim" | "Bike" | "Run" | "Strength" | "Rest",
        "title": "string",
        "description": "string",
        "durationMinutes": number,
        "intensity": "Low" | "Moderate" | "High" | "Intervals",
        "completed": false
      }
    ]
  `;

  try {
    const response = await axios.post('/api/ai/plan', { prompt });
    const text = response.data.text;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
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
  `;

  const messages: any[] = history.map(h => ({
    role: h.role === 'model' ? 'assistant' : 'user',
    content: h.content
  }));

  const currentContent: any[] = [{ type: 'text', text: message }];
  
  if (image) {
    const base64Data = image.split(',')[1];
    const mimeType = image.split(',')[0].split(':')[1].split(';')[0];
    currentContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mimeType,
        data: base64Data
      }
    });
  }

  messages.push({ role: 'user', content: currentContent });

  const tools = [{
    name: "updateWorkouts",
    description: "Propose une mise à jour ou un ajout de séances d'entraînement dans le planning de l'athlète. Cette action nécessite une validation de l'utilisateur.",
    input_schema: {
      type: "object",
      properties: {
        newWorkouts: {
          type: "array",
          description: "Liste complète des séances pour les 7 prochains jours.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              date: { type: "string" },
              sport: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
              durationMinutes: { type: "number" },
              intensity: { type: "string" },
              completed: { type: "boolean" },
            },
            required: ["id", "date", "sport", "title", "description", "durationMinutes", "intensity", "completed"],
          }
        }
      },
      required: ["newWorkouts"]
    }
  }];

  try {
    // Non-streaming for now to keep it simple with the server bridge
    const response = await axios.post('/api/ai/advice', {
      systemInstruction,
      messages,
      tools
    });

    const data = response.data;
    let fullText = "";
    let functionCalls: any[] = [];

    for (const block of data.content) {
      if (block.type === 'text') {
        fullText += block.text;
      }
      if (block.type === 'tool_use') {
        functionCalls.push({
          name: block.name,
          args: block.input
        });
      }
    }

    if (onStream) onStream(fullText);

    return {
      text: fullText || "Plan mis à jour. On continue !",
      functionCalls: functionCalls.length > 0 ? functionCalls : undefined
    };
  } catch (error) {
    console.error("Error getting coach advice:", error);
    return { text: "Désolé, j'ai rencontré une erreur avec le coach. Peux-tu réessayer ?" };
  }
}

export async function getNutritionAdvice(profile: AthleteProfile, currentPlan: Workout[]): Promise<NutritionAdvice | null> {
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
    const response = await axios.post('/api/ai/nutrition', { prompt });
    const text = response.data.text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return { ...data, updatedAt: Date.now() };
    }
    return null;
  } catch (error) {
    console.error("Error generating nutrition advice:", error);
    return null;
  }
}

export async function generateSpeech(text: string, gender?: 'Man' | 'Woman'): Promise<string | undefined> {
  const voiceName = gender === 'Woman' ? 'Kore' : 'Zephyr';
  try {
    const response = await axios.post('/api/ai/speech', { text, voiceName });
    return response.data.audioData;
  } catch (error) {
    console.error("Error generating speech:", error);
    return undefined;
  }
}
