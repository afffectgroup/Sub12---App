import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import cookieParser from "cookie-parser";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import fs from "fs";

// Load Firebase config
const firebaseConfig = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));
const appFirebase = initializeApp(firebaseConfig);
const db = getFirestore(appFirebase, firebaseConfig.firestoreDatabaseId);

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
    const stravaRef = doc(db, "users", uid);
    const docSnap = await getDoc(stravaRef);
    if (!docSnap.exists() || !docSnap.data().strava) {
      return null;
    }

    let { accessToken, refreshToken, expiresAt } = docSnap.data().strava;

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

        await setDoc(stravaRef, {
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
      const response = await axios.get("https://www.strava.com/api/v3/athlete/activities", {
        headers: { Authorization: `Bearer ${token}` },
        params: { per_page: 10 },
      });
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
        redirect_uri: redirectUri,  // ← FIX : manquait dans la version précédente
      });

      const { access_token, refresh_token, expires_at, athlete } = response.data;

      if (!isLogin) {
        // Store in Firestore for existing user
        const stravaRef = doc(db, "users", uid as string);
        await setDoc(stravaRef, {
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
