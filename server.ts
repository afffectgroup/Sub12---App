import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import cookieParser from "cookie-parser";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI, Modality } from "@google/genai";

const firebaseConfig = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));

// Init Anthropic
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});
console.log("Anthropic SDK initialized. Key present:", !!process.env.ANTHROPIC_API_KEY);

// Init Gemini (for TTS fallback)
const geminiAi = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
console.log("Gemini SDK initialized. Key present:", !!process.env.GEMINI_API_KEY);

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

    const clientId = process.env.STRAVA_CLIENT_ID?.trim();
    const clientSecret = process.env.STRAVA_CLIENT_SECRET?.trim();

    // Check if expired (with 5 min buffer)
    if (Date.now() / 1000 > (expiresAt || 0) - 300) {
      console.log("Strava token expired or expiring soon, refreshing...");
      
      if (!clientId || !clientSecret) {
        console.error("Missing Strava credentials for refresh");
        return null;
      }

      if (!refreshToken) {
        console.error("Missing refresh token in database");
        return null;
      }

      try {
        const response = await axios.post("https://www.strava.com/oauth/token", {
          client_id: parseInt(clientId, 10),
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        });

        console.log("Strava token refreshed successfully");
        accessToken = response.data.access_token;
        refreshToken = response.data.refresh_token;
        expiresAt = response.data.expires_at;

        await userRef.set({
          strava: {
            accessToken,
            refreshToken,
            expiresAt,
            updatedAt: Date.now()
          }
        }, { merge: true });
      } catch (error: any) {
        console.error("Failed to refresh Strava token:", error.response?.data || error.message);
        // If the refresh token is invalid (400), we might need to ask the user to re-authenticate
        if (error.response?.status === 400) {
          console.warn("Refresh token might be invalid, marking stravaConnected as false");
          await userRef.set({ stravaConnected: false }, { merge: true });
        }
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

  // AI Endpoints
  app.post("/api/ai/insight", async (req, res) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(401).json({ error: "Clé API Anthropic manquante. Veuillez l'ajouter dans les Settings." });
    }
    try {
      const { prompt } = req.body;
      const message = await anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }],
      });
      
      const text = message.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');

      res.json({ text });
    } catch (error: any) {
      console.error("Insight error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai/plan", async (req, res) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(401).json({ error: "Clé API Anthropic manquante." });
    }
    try {
      const { prompt } = req.body;
      const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      });
      
      const text = response.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');

      res.json({ text });
    } catch (error: any) {
      console.error("Plan error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai/nutrition", async (req, res) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(401).json({ error: "Clé API Anthropic manquante." });
    }
    try {
      const { prompt } = req.body;
      const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });
      
      const text = response.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');

      res.json({ text });
    } catch (error: any) {
      console.error("Nutrition error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai/advice", async (req, res) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(401).json({ error: "Clé API Anthropic manquante." });
    }
    try {
      const { systemInstruction, messages, tools } = req.body;
      
      const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 2048,
        system: systemInstruction,
        tools: tools,
        messages: messages,
      });

      res.json(response);
    } catch (error: any) {
      console.error("Advice error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai/speech", async (req, res) => {
    if (!geminiAi) return res.status(400).json({ error: "Gemini not configured for TTS" });
    try {
      const { text, voiceName } = req.body;
      const response = await geminiAi.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
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
      res.json({ audioData });
    } catch (error: any) {
      console.error("Speech error:", error);
      res.status(500).json({ error: error.message });
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

    const clientId = process.env.STRAVA_CLIENT_ID?.trim();
    const clientSecret = process.env.STRAVA_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret) {
      console.error("Missing Strava credentials for token exchange");
      return res.status(500).send("Configuration error");
    }

    try {
      const response = await axios.post("https://www.strava.com/oauth/token", {
        client_id: parseInt(clientId, 10),
        client_secret: clientSecret,
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
