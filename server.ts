import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import cookieParser from "cookie-parser";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";

const firebaseConfig = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));

// Init Admin SDK
if (!getApps().length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(fs.readFileSync("./service-account.json", "utf-8"));

  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore(undefined, firebaseConfig.firestoreDatabaseId);
console.log("Firestore Admin SDK initialized with database:", firebaseConfig.firestoreDatabaseId);

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10);

  app.use(express.json());
  app.use(cookieParser());

  // Helper : reconstruit le redirectUri de façon cohérente entre /url et /callback
  // Utilise STRAVA_DOMAIN en priorité (à définir dans Railway = "www.sub12.fr")
  function buildRedirectUri(req: express.Request): string {
    const host = process.env.STRAVA_DOMAIN || req.get("x-forwarded-host") || req.get("host");
    const protocol = (req.get("x-forwarded-proto") || "https").split(",")[0].trim();
    return `${protocol}://${host}/auth/strava/callback`;
  }

  // API Routes
  app.get("/api/auth/strava/url", (req, res) => {
    const { uid, login } = req.query;
    
    const clientId = process.env.STRAVA_CLIENT_ID?.trim();
    const clientSecret = process.env.STRAVA_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret) {
      console.error("ERREUR : STRAVA_CLIENT_ID ou STRAVA_CLIENT_SECRET manquant dans les variables d'environnement.");
      return res.status(500).json({ 
        error: "Configuration Strava manquante. Veuillez ajouter STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET dans les Settings d'AI Studio." 
      });
    }

    if (!uid && login !== "true") {
      return res.status(400).json({ error: "Missing uid or login flag" });
    }

    const redirectUri = buildRedirectUri(req);
    
    console.log("Génération de l'URL OAuth Strava avec Client ID:", clientId);
    console.log("Redirect URI:", redirectUri);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "read,activity:read_all",
      state: (uid as string) || "login",
    });

    const authUrl = `https://www.strava.com/oauth/authorize?${params.toString()}`;
    res.json({ url: authUrl });
  });

  async function getStravaToken(uid: string) {
    console.log("Getting Strava token for UID:", uid);
    const userRef = db.collection("users").doc(uid);
    const docSnap = await userRef.get();
    if (!docSnap.exists) {
      console.log("User document not found for UID:", uid);
      return null;
    }
    const data = docSnap.data();
    if (!data?.strava) {
      console.log("Strava tokens not found in user document for UID:", uid);
      return null;
    }

    let { accessToken, refreshToken, expiresAt } = data.strava;

    // Check if expired (with 5 min buffer)
    if (Date.now() / 1000 > expiresAt - 300) {
      try {
        const response = await axios.post("https://www.strava.com/oauth/token", {
          client_id: process.env.STRAVA_CLIENT_ID,
          client_secret: process.env.STRAVA_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        });

        accessToken = response.data.access_token;
        refreshToken = response.data.refresh_token;
        expiresAt = response.data.expires_at;

        await userRef.set({
          strava: {
            accessToken,
            refreshToken,
            expiresAt,
          }
        }, { merge: true });
      } catch (error) {
        console.error("Failed to refresh Strava token:", error);
        return null;
      }
    }

    return accessToken;
  }

  app.get("/api/strava/activities", async (req, res) => {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ error: "Missing uid" });

    const token = await getStravaToken(uid as string);
    if (!token) return res.status(401).json({ error: "Strava not connected or token invalid" });

    try {
      console.log("Fetching Strava activities for UID:", uid);
      const response = await axios.get("https://www.strava.com/api/v3/athlete/activities", {
        headers: { Authorization: `Bearer ${token}` },
        params: { per_page: 30 }, // Fetch more activities
      });
      console.log(`Fetched ${response.data.length} activities for UID:`, uid);
      res.json(response.data);
    } catch (error: any) {
      console.error("Failed to fetch Strava activities:", error.response?.data || error.message);
      res.status(500).json({ error: "Failed to fetch activities" });
    }
  });

  app.get(["/auth/strava/callback", "/auth/strava/callback/"], async (req, res) => {
    const { code, state: uid } = req.query;

    if (!code || !uid) {
      return res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: 'Missing code or state' }, '*');
                window.close();
              }
            </script>
            <p>Authentication failed. Missing code or state.</p>
          </body>
        </html>
      `);
    }

    const isLogin = uid === "login";

    // FIX : redirect_uri doit être identique à celui utilisé lors de l'autorisation.
    // Sans cette ligne, Strava répond "invalid_grant" → "Failed to exchange token".
    const redirectUri = buildRedirectUri(req);
    console.log("Callback redirect_uri used for token exchange:", redirectUri);

    try {
      const response = await axios.post("https://www.strava.com/oauth/token", {
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      });

      const { access_token, refresh_token, expires_at, athlete } = response.data;

      if (!isLogin) {
        // Store in Firestore for existing user
        const userRef = db.collection("users").doc(uid as string);
        await userRef.set({
          stravaConnected: true,
          stravaId: athlete.id,
          strava: {
            accessToken: access_token,
            refreshToken: refresh_token,
            expiresAt: expires_at,
            athleteId: athlete.id,
            connectedAt: Date.now(),
          }
        }, { merge: true });
      }

      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'OAUTH_AUTH_SUCCESS', 
                  isLogin: ${isLogin},
                  athlete: ${JSON.stringify(athlete)},
                  stravaTokens: {
                    accessToken: "${access_token}",
                    refreshToken: "${refresh_token}",
                    expiresAt: ${expires_at},
                    athleteId: ${athlete.id},
                    connectedAt: ${Date.now()}
                  }
                }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    } catch (error: any) {
      console.error("Strava OAuth error:", error.response?.data || error.message);
      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: 'Failed to exchange token' }, '*');
                window.close();
              }
            </script>
            <p>Authentication failed. Error exchanging token.</p>
          </body>
        </html>
      `);
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
// ============================================================
// ROUTES CLAUDE API — À INSÉRER dans server.ts
// Juste AVANT la section static files / app.listen
// ============================================================

// ── Helpers Claude ──────────────────────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = "claude-sonnet-4-6";

function claudeHeaders() {
  return {
    "Content-Type": "application/json",
    "x-api-key": ANTHROPIC_API_KEY || "",
    "anthropic-version": "2023-06-01",
  };
}

// ── POST /api/claude/insight ─────────────────────────────────
app.post("/api/claude/insight", async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set in Railway" });
  }
  try {
    const { prompt } = req.body;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: claudeHeaders(),
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await response.json() as any;
    if (!response.ok) return res.status(response.status).json(data);
    const text = data.content?.[0]?.text || "Focus sur l'objectif du jour.";
    res.json({ text });
  } catch (err: any) {
    console.error("Claude insight error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/claude/plan ────────────────────────────────────
app.post("/api/claude/plan", async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set in Railway" });
  }
  try {
    const { prompt } = req.body;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: claudeHeaders(),
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: prompt + "\n\nRéponds UNIQUEMENT avec un tableau JSON valide, sans texte avant ou après, sans balises markdown.",
          },
        ],
      }),
    });
    const data = await response.json() as any;
    if (!response.ok) return res.status(response.status).json(data);
    let text = data.content?.[0]?.text || "[]";
    // Nettoyer les balises markdown si présentes
    text = text.replace(/```(?:json)?[\s\S]*?```/g, (m: string) =>
      m.replace(/```(?:json)?/g, "").replace(/```/g, "")
    ).trim();
    // Extraire le premier tableau JSON
    const arrMatch = text.match(/\[[\s\S]*\]/);
    const parsed = arrMatch ? JSON.parse(arrMatch[0]) : [];
    res.json({ plan: parsed });
  } catch (err: any) {
    console.error("Claude plan error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/claude/chat  (streaming SSE) ───────────────────
app.post("/api/claude/chat", async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY not set in Railway" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const { messages, systemInstruction } = req.body;

    const tools = [
      {
        name: "updateWorkouts",
        description:
          "Met à jour ou ajoute des séances d'entraînement dans le planning de l'athlète (ex: suite à une blessure, fatigue, ou demande spécifique).",
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
                  sport: { type: "string", enum: ["Swim", "Bike", "Run", "Strength", "Rest"] },
                  title: { type: "string" },
                  description: { type: "string" },
                  durationMinutes: { type: "number" },
                  intensity: { type: "string", enum: ["Low", "Moderate", "High", "Intervals"] },
                  completed: { type: "boolean" },
                },
                required: ["id", "date", "sport", "title", "description", "durationMinutes", "intensity", "completed"],
              },
            },
          },
          required: ["newWorkouts"],
        },
      },
    ];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: claudeHeaders(),
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        stream: true,
        system: systemInstruction,
        tools,
        messages,
      }),
    });

    if (!response.ok || !response.body) {
      const errText = await response.text();
      res.write(`data: ${JSON.stringify({ error: errText })}\n\n`);
      res.end();
      return;
    }

    // Pipe le stream SSE Claude → client
    const reader = (response.body as any).getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (err: any) {
    console.error("Claude chat stream error:", err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});
// ============================================================
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
