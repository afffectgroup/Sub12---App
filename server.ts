import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import cookieParser from "cookie-parser";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import fs from "fs";

// ─── Firebase ────────────────────────────────────────────────────────────────
const firebaseConfig = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));
const appFirebase = initializeApp(firebaseConfig);
const db = getFirestore(appFirebase, firebaseConfig.firestoreDatabaseId);

// ─── FIX OAUTH : URI FIXE ────────────────────────────────────────────────────
// Cause du bug précédent : buildRedirectUri(req) reconstruisait l'URI depuis
// les headers HTTP (x-forwarded-host, x-forwarded-proto), qui varient entre
// la route /api/auth/strava/url et /auth/strava/callback sur Railway.
// Deux URIs différentes = Strava refuse avec "invalid_grant".
//
// Solution : une constante partagée, jamais dynamique.
// À définir dans Railway : STRAVA_REDIRECT_URI=https://www.sub12.fr/auth/strava/callback
const STRAVA_REDIRECT_URI =
  process.env.STRAVA_REDIRECT_URI ?? "https://www.sub12.fr/auth/strava/callback";

// ─── Helpers Strava ──────────────────────────────────────────────────────────
async function refreshStravaToken(refreshToken: string) {
  const r = await axios.post("https://www.strava.com/oauth/token", {
    client_id: process.env.STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return r.data;
}

async function getStravaToken(uid: string): Promise<string | null> {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists() || !snap.data().strava) return null;
  let { accessToken, refreshToken, expiresAt } = snap.data().strava;
  if (Date.now() / 1000 > expiresAt - 300) {
    try {
      const data = await refreshStravaToken(refreshToken);
      accessToken = data.access_token;
      await setDoc(doc(db, "users", uid), {
        strava: {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: data.expires_at,
        }
      }, { merge: true });
    } catch (e) {
      console.error("Strava token refresh failed:", e);
      return null;
    }
  }
  return accessToken;
}

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10);
  app.use(express.json());
  app.use(cookieParser());

  // ─── ROUTE 1 : Génère l'URL OAuth Strava ───────────────────────────────────
  app.get("/api/auth/strava/url", (req, res) => {
    const { uid, login } = req.query;
    const clientId = process.env.STRAVA_CLIENT_ID?.trim();
    const clientSecret = process.env.STRAVA_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        error: "STRAVA_CLIENT_ID ou STRAVA_CLIENT_SECRET manquant dans Railway."
      });
    }
    if (!uid && login !== "true") {
      return res.status(400).json({ error: "Missing uid or login flag" });
    }

    // Log pour debug (visible dans Railway logs)
    console.log("[Strava OAuth] Generating URL");
    console.log("[Strava OAuth] redirect_uri:", STRAVA_REDIRECT_URI);
    console.log("[Strava OAuth] client_id:", clientId);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: STRAVA_REDIRECT_URI,  // ← constante fixe
      response_type: "code",
      scope: "read,activity:read_all",
      state: (uid as string) || "login",
    });

    res.json({ url: `https://www.strava.com/oauth/authorize?${params.toString()}` });
  });

  // ─── ROUTE 2 : Callback Strava (échange le code contre des tokens) ─────────
  app.get(["/auth/strava/callback", "/auth/strava/callback/"], async (req, res) => {
    const { code, state: uid, error: stravaError } = req.query;

    // Strava peut renvoyer une erreur (ex: user a refusé l'accès)
    if (stravaError) {
      console.error("[Strava Callback] Strava returned error:", stravaError);
      return res.send(popupMessage("OAUTH_AUTH_ERROR", stravaError as string));
    }

    if (!code || !uid) {
      return res.send(popupMessage("OAUTH_AUTH_ERROR", "Missing code or state"));
    }

    const isLogin = uid === "login";

    // Log pour vérifier que les deux URIs matchent
    console.log("[Strava Callback] redirect_uri used for token exchange:", STRAVA_REDIRECT_URI);
    console.log("[Strava Callback] code:", (code as string).substring(0, 8) + "...");

    try {
      const response = await axios.post("https://www.strava.com/oauth/token", {
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: STRAVA_REDIRECT_URI,  // ← même constante fixe
      });

      const { access_token, refresh_token, expires_at, athlete } = response.data;
      console.log("[Strava Callback] ✓ Token exchange successful for athlete:", athlete.id);

      if (!isLogin) {
        await setDoc(doc(db, "users", uid as string), {
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
        <html><body><script>
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
        <p>Connexion Strava réussie. Cette fenêtre va se fermer...</p>
        </body></html>
      `);
    } catch (e: any) {
      // Log l'erreur RÉELLE de Strava (pas juste "Failed to exchange token")
      const stravaMsg = e.response?.data?.message
        || e.response?.data?.error
        || e.message
        || "Unknown error";
      console.error("[Strava Callback] ✗ Token exchange failed:", stravaMsg);
      console.error("[Strava Callback] Full error:", JSON.stringify(e.response?.data));
      res.send(popupMessage("OAUTH_AUTH_ERROR", stravaMsg));
    }
  });

  // ─── ROUTE 3 : Activités récentes ──────────────────────────────────────────
  app.get("/api/strava/activities", async (req, res) => {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ error: "Missing uid" });
    const token = await getStravaToken(uid as string);
    if (!token) return res.status(401).json({ error: "Strava not connected" });
    try {
      const r = await axios.get("https://www.strava.com/api/v3/athlete/activities", {
        headers: { Authorization: `Bearer ${token}` },
        params: { per_page: 20 },
      });
      res.json(r.data);
    } catch (e: any) {
      console.error("Strava activities error:", e.response?.data || e.message);
      res.status(500).json({ error: "Failed to fetch activities" });
    }
  });

  // ─── ROUTE 4 : Stats 7 derniers jours ──────────────────────────────────────
  app.get("/api/strava/stats", async (req, res) => {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ error: "Missing uid" });
    const token = await getStravaToken(uid as string);
    if (!token) return res.status(401).json({ error: "Strava not connected" });
    try {
      const snap = await getDoc(doc(db, "users", uid as string));
      const athleteId = snap.data()?.strava?.athleteId;
      const since7d = Math.floor(Date.now() / 1000) - 7 * 86400;
      const [statsRes, recentRes] = await Promise.all([
        athleteId
          ? axios.get(`https://www.strava.com/api/v3/athletes/${athleteId}/stats`, {
              headers: { Authorization: `Bearer ${token}` },
            })
          : Promise.resolve({ data: null }),
        axios.get("https://www.strava.com/api/v3/athlete/activities", {
          headers: { Authorization: `Bearer ${token}` },
          params: { per_page: 15, after: since7d },
        }),
      ]);
      res.json({ allTimeStats: statsRes.data, recentActivities: recentRes.data });
    } catch (e: any) {
      console.error("Strava stats error:", e.response?.data || e.message);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // ─── ROUTE 5 : Status connexion Strava ─────────────────────────────────────
  app.get("/api/strava/status", async (req, res) => {
    const { uid } = req.query;
    if (!uid) return res.json({ connected: false });
    const snap = await getDoc(doc(db, "users", uid as string));
    const strava = snap.data()?.strava;
    res.json({ connected: !!strava?.refreshToken, athleteId: strava?.athleteId ?? null });
  });

  // ─── Vite / Static ─────────────────────────────────────────────────────────
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
    console.log(`Strava redirect URI: ${STRAVA_REDIRECT_URI}`);
  });
}

// ─── Helper : message postMessage pour la popup OAuth ─────────────────────
function popupMessage(type: string, error: string): string {
  return `
    <html><body><script>
      if (window.opener) {
        window.opener.postMessage({ type: '${type}', error: ${JSON.stringify(error)} }, '*');
        window.close();
      } else {
        document.write('<p>Erreur: ${error}</p><a href="/">Retour</a>');
      }
    </script>
    <p>Une erreur est survenue. Fermeture...</p>
    </body></html>
  `;
}

startServer();
