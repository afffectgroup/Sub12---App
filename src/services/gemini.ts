// src/services/gemini.ts
// ─── Remplacement complet : Gemini → Claude API ──────────────
// Architecture : tous les appels IA passent par le backend Express
// (server.ts) qui détient la clé ANTHROPIC_API_KEY de Railway.
// Le browser n'expose JAMAIS la clé.
// TTS  : Web Speech API (navigateur, gratuit, aucune clé)
// STT  : Web Speech API (navigateur, déjà utilisé dans App.tsx)
// ─────────────────────────────────────────────────────────────

import { AthleteProfile, Workout, ChatMessage } from "../types";
import { differenceInDays, parseISO } from "date-fns";

// ─── TTS : voix via le navigateur ────────────────────────────
export async function generateSpeech(
  text: string,
  gender?: "Man" | "Woman"
): Promise<string | undefined> {
  if (typeof window === "undefined" || !window.speechSynthesis) return undefined;

  return new Promise((resolve) => {
    // Annuler toute lecture en cours
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.rate = 1.05;
    utterance.pitch = gender === "Woman" ? 1.2 : 0.9;
    utterance.volume = 1;

    // Chercher une voix française si disponible
    const voices = window.speechSynthesis.getVoices();
    const frVoice = voices.find(
      (v) =>
        v.lang.startsWith("fr") &&
        (gender === "Woman" ? v.name.toLowerCase().includes("fem") || v.name.toLowerCase().includes("woman") : true)
    ) || voices.find((v) => v.lang.startsWith("fr"));
    if (frVoice) utterance.voice = frVoice;

    utterance.onend = () => resolve(undefined);
    utterance.onerror = () => resolve(undefined);
    window.speechSynthesis.speak(utterance);
  });
}

// ─── Insight quotidien ────────────────────────────────────────
export async function generateDailyCoachInsight(
  profile: AthleteProfile,
  lastActivity: any,
  todayWorkout: Workout | undefined,
  currentPlan: Workout[]
): Promise<string> {
  const planContext = currentPlan
    .slice(0, 3)
    .map((w) => `${w.date}: ${w.title}`)
    .join(", ");
  const gender = profile.coachGender === "Woman" ? "une coach femme" : "un coach homme";
  const coachName = profile.coachName || "Coach Sub12";

  const prompt = `
Tu es "${coachName}", ${gender} d'élite. Génère un message TRÈS COURT (max 20-30 mots), percutant et ultra-motivant pour ${profile.name}.

Contexte:
- Objectif: ${profile.targetRace} (${differenceInDays(parseISO(profile.raceDate), new Date())}j).
- Dernière activité Strava: ${
    lastActivity
      ? `${lastActivity.name}, ${Math.round(lastActivity.distance / 1000)}km, ${lastActivity.total_elevation_gain}m D+`
      : "Aucune"
  }.
- Séance aujourd'hui: ${todayWorkout ? `${todayWorkout.title} (${todayWorkout.durationMinutes}min)` : "Repos"}.
- Prochaines séances: ${planContext}.

Directives:
- Sois direct, pas de politesses inutiles.
- Ton de leader, inspirant.
- Lien entre activité passée et plan futur.
- Maximum 2 phrases courtes.`;

  try {
    const res = await fetch("/api/claude/insight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.text || "Focus sur l'objectif. Chaque watt compte.";
  } catch (error) {
    console.error("Error generating daily insight:", error);
    return "Focus sur la séance du jour. La régularité est la clé.";
  }
}

// ─── Génération du plan d'entraînement ───────────────────────
export async function generateTrainingPlan(
  profile: AthleteProfile,
  chatHistory: ChatMessage[] = []
): Promise<Workout[]> {
  const historyContext =
    chatHistory.length > 0
      ? `Prends en compte les échanges récents avec l'athlète: ${chatHistory
          .slice(-5)
          .map((h) => `${h.role}: ${h.content}`)
          .join(" | ")}`
      : "";

  const today = new Date().toLocaleDateString("en-CA");

  const prompt = `Tu es un coach expert en triathlon longue distance. Génère un plan d'entraînement de 7 jours ultra-personnalisé pour ${profile.name}.

PROFIL DE L'ATHLÈTE:
- Objectif: ${profile.targetRace} le ${profile.raceDate}.
- Niveau: ${profile.fitnessLevel}, Mode: ${profile.goalMode}.
- Objectif d'heures hebdo: ${profile.weeklyHoursGoal}h.
- Âge: ${profile.age}, Poids: ${profile.weight}kg, Taille: ${profile.height}cm.
- Métier: ${profile.profession}.
- Expérience: ${profile.experience}.

${historyContext}

DIRECTIVES:
1. Cohérent avec le niveau ${profile.fitnessLevel}.
2. Mélange: Endurance Fondamentale (Z2), Seuil (Z3-Z4), Intervalles (VMA/PMA), Renforcement, Repos.
3. Maximum ${profile.weeklyHoursGoal}h par semaine.
4. Commence aujourd'hui (${today}).

FORMAT JSON requis pour chaque séance:
{
  "id": "string unique",
  "date": "YYYY-MM-DD",
  "sport": "Swim" | "Bike" | "Run" | "Strength" | "Rest",
  "title": "string",
  "description": "string",
  "durationMinutes": number,
  "intensity": "Low" | "Moderate" | "High" | "Intervals",
  "completed": false
}`;

  try {
    const res = await fetch("/api/claude/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.plan) ? data.plan : [];
  } catch (error) {
    console.error("Error generating training plan:", error);
    return [];
  }
}

// ─── Chat Coach (streaming) ───────────────────────────────────
export async function getCoachAdvice(
  message: string,
  history: { role: "user" | "model"; content: string }[],
  profile: AthleteProfile,
  currentPlan: Workout[],
  lastActivities: any[],
  onStream?: (text: string) => void,
  image?: string
): Promise<{ text: string; functionCalls?: any[] }> {
  const planContext = currentPlan
    .slice(0, 10)
    .map((w) => `- ${w.date}: ${w.title} (${w.sport}, ${w.durationMinutes}min, ${w.intensity})`)
    .join("\n");
  const activityContext = lastActivities
    .slice(0, 5)
    .map(
      (a) =>
        `- ${a.name}: ${Math.round((a.distance / 1000) * 10) / 10}km, ${a.total_elevation_gain}m D+, ${Math.round(
          a.moving_time / 60
        )}min`
    )
    .join("\n");
  const prContext = profile.prs
    ? `\nRECORDS PERSONNELS (PRs):\n- VMA: ${profile.prs.vma}km/h\n- FTP: ${profile.prs.ftp}W\n- CSS: ${profile.prs.css}\n- FC Max: ${profile.prs.maxHr}`
    : "";
  const gender = profile.coachGender === "Woman" ? "une coach femme" : "un coach homme";
  const coachName = profile.coachName || "Coach Sub12";
  const today = new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const systemInstruction = `Tu es "${coachName}", ${gender} d'élite spécialisée dans le triathlon longue distance (Ironman).
Ton expertise s'adresse à des athlètes comme ${profile.name}, souvent des entrepreneurs ou cadres avec un emploi du temps chargé, visant le "Sub12" (moins de 12h sur Ironman).

TON IDENTITÉ:
- Coach de classe mondiale. Exigeant sur la discipline mais compréhensif des contraintes réelles.
- Ton professionnel, motivant, basé sur les faits.
- Tu détestes les réponses génériques. Chaque conseil ancré dans les données de l'athlète.

CONTEXTE DE L'ATHLÈTE:
- Objectif: ${profile.targetRace} (${profile.raceDate}).
- Niveau: ${profile.fitnessLevel}, Métier: ${profile.profession}.
- Genre: ${profile.gender === "Woman" ? "Femme" : "Homme"}.
${prContext}

PLANNING ACTUEL (10 prochains jours):
${planContext}

HISTORIQUE RÉCENT (Strava):
${activityContext}

DATE AUJOURD'HUI: ${today}

RÈGLES DE RÉPONSE:
1. ANALYSE AVANT DE RÉPONDRE: Regarde les dernières activités Strava vs le plan prévu.
2. CONCISION EXPERTE: Vise 60-100 mots. Dense en informations utiles.
3. VOCABULAIRE: Z2, FTP, VMA, TSS, Allure, Cadence.
4. ADAPTATION PROACTIVE: Si l'athlète exprime un doute ou une douleur, propose d'ajuster le plan via l'outil updateWorkouts.
5. ANALYSE D'IMAGE: Si une image est fournie, décris et donne un conseil technique immédiat.

IMPORTANT:
- Si tu modifies le plan, explique CLAIREMENT les changements.
- NE METS JAMAIS de code, JSON ou texte technique dans ta réponse texte.
- Ne décris JAMAIS tes actions internes. Réponds directement à l'athlète.`;

  // Convertir l'historique Gemini (role: 'model') → Claude (role: 'assistant')
  const claudeMessages: any[] = history.slice(-10).map((h) => ({
    role: h.role === "model" ? "assistant" : "user",
    content: h.content,
  }));

  // Ajouter le message courant (avec image si présente)
  if (image) {
    const base64Data = image.split(",")[1];
    const mimeType = image.split(",")[0].split(":")[1].split(";")[0];
    claudeMessages.push({
      role: "user",
      content: [
        { type: "text", text: message },
        { type: "image", source: { type: "base64", media_type: mimeType, data: base64Data } },
      ],
    });
  } else {
    claudeMessages.push({ role: "user", content: message });
  }

  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const res = await fetch("/api/claude/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: claudeMessages,
          systemInstruction,
        }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      // ── Parser le stream SSE Claude ──────────────────────────
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let toolUseBlocks: any[] = [];
      let currentTool: { name: string; inputBuffer: string } | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]" || !raw) continue;

          let evt: any;
          try { evt = JSON.parse(raw); } catch { continue; }

          // Texte en streaming
          if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
            fullText += evt.delta.text;
            if (onStream) onStream(fullText);
          }

          // Début d'un appel d'outil
          if (evt.type === "content_block_start" && evt.content_block?.type === "tool_use") {
            currentTool = { name: evt.content_block.name, inputBuffer: "" };
          }

          // JSON partiel de l'outil
          if (evt.type === "content_block_delta" && evt.delta?.type === "input_json_delta" && currentTool) {
            currentTool.inputBuffer += evt.delta.partial_json;
          }

          // Fin du bloc outil → on parse et on push
          if (evt.type === "content_block_stop" && currentTool) {
            try {
              const args = JSON.parse(currentTool.inputBuffer);
              // Format compatible Gemini pour App.tsx : { name, args }
              toolUseBlocks.push({ name: currentTool.name, args });
            } catch {
              console.warn("Failed to parse tool input:", currentTool.inputBuffer);
            }
            currentTool = null;
          }

          // Erreur remontée par le serveur
          if (evt.error) throw new Error(evt.error);
        }
      }

      // Nettoyer les éventuelles fuites JSON dans le texte
      let cleanText = fullText;
      if (cleanText.includes("newWorkouts") || cleanText.includes("updateWorkouts")) {
        cleanText = cleanText.replace(/\{[\s\S]*?"newWorkouts"[\s\S]*?\}/g, "");
        cleanText = cleanText.replace(/(?:print\s*)?updateWorkouts\s*\([\s\S]*?\)/g, "");
        cleanText = cleanText.replace(/```(?:json)?[\s\S]*?```/g, "");
        cleanText = cleanText.trim();
      }

      return {
        text: cleanText || "Plan mis à jour. On continue !",
        functionCalls: toolUseBlocks.length > 0 ? toolUseBlocks : undefined,
      };
    } catch (error: any) {
      const msg = error?.message || "";
      const isRetryable =
        msg.includes("503") || msg.includes("500") || msg.includes("overloaded") || msg.includes("529");

      if (isRetryable && retryCount < maxRetries - 1) {
        retryCount++;
        const delay = Math.pow(2, retryCount) * 1000;
        console.warn(`Claude API error (${msg}), retry in ${delay}ms… (${retryCount}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      console.error("Claude Coach Advice Error:", error);
      return {
        text: "Désolé, le service IA est temporairement indisponible. Peux-tu réessayer dans un instant ?",
      };
    }
  }

  return { text: "Désolé, j'ai rencontré une erreur technique. Peux-tu reformuler ?" };
}
