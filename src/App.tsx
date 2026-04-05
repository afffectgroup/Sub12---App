import React, { useState, useEffect, useRef } from 'react';
import { 
  Trophy, 
  Calendar, 
  MessageSquare, 
  User, 
  ChevronRight, 
  CheckCircle2, 
  Circle, 
  Timer, 
  Zap, 
  Flame, 
  TrendingUp,
  Plus,
  Send,
  Loader2,
  Settings,
  Dumbbell,
  Bike,
  Waves,
  Footprints,
  Activity,
  Trash2,
  LayoutGrid,
  List,
  Edit2,
  X,
  Camera,
  LogOut,
  LogIn,
  AlertCircle,
  Mic,
  MicOff,
  Volume2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, differenceInDays, parseISO, addDays, isSameDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import ReactMarkdown from 'react-markdown';
import { cn } from './lib/utils';
import { AthleteProfile, Workout, ChatMessage, Sport } from './types';
import { generateTrainingPlan, getCoachAdvice, generateSpeech } from './services/gemini';
import { 
  auth, 
  db, 
  signInWithPopup, 
  signInAnonymously,
  googleProvider, 
  signOut, 
  onAuthStateChanged, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  orderBy,
  doc,
  User as FirebaseUser
} from './lib/firebase';

// --- Error Boundary ---

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-red-100 text-center">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Oups ! Une erreur est survenue</h2>
            <p className="text-slate-500 text-sm mb-6">
              L'application a rencontré un problème inattendu.
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold hover:bg-slate-800 transition-all"
            >
              Recharger la page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Firestore Error Handler ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Components ---

const SportIcon = ({ sport, className, size = 20 }: { sport: Sport; className?: string; size?: number }) => {
  switch (sport) {
    case 'Swim': return <Waves className={className} size={size} />;
    case 'Bike': return <Bike className={className} size={size} />;
    case 'Run': return <Footprints className={className} size={size} />;
    case 'Strength': return <Dumbbell className={className} size={size} />;
    default: return <Timer className={className} size={size} />;
  }
};

const IntensityBadge = ({ intensity }: { intensity: Workout['intensity'] }) => {
  const colors = {
    Low: 'bg-blue-100 text-blue-700 border-blue-200',
    Moderate: 'bg-green-100 text-green-700 border-green-200',
    High: 'bg-orange-100 text-orange-700 border-orange-200',
    Intervals: 'bg-red-100 text-red-700 border-red-200',
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider", colors[intensity])}>
      {intensity}
    </span>
  );
};

// --- Main App ---

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'plan' | 'coach' | 'profile'>('dashboard');
  const [profile, setProfile] = useState<AthleteProfile>({
    name: '',
    targetRace: 'Marathon',
    raceDate: '2026-06-07',
    weeklyHoursGoal: 8,
    fitnessLevel: 'Intermediate',
    experience: '',
    goalMode: 'Finisher',
    onboarded: false,
    isPremium: false,
    progressionScore: 45,
    weight: 70,
    height: 175,
    age: 30,
    profession: '',
    secondaryRaces: [],
    avatarUrl: ''
  });

  const [onboardingStep, setOnboardingStep] = useState(0);
  const [planView, setPlanView] = useState<'list' | 'calendar'>('list');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [editingWorkout, setEditingWorkout] = useState<Workout | null>(null);

  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'fr-FR';

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        handleSendMessage(transcript);
        setIsRecording(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
      };

      recognitionRef.current.onend = () => {
        setIsRecording(false);
      };
    }
  }, []);

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
    } else {
      recognitionRef.current?.start();
      setIsRecording(true);
    }
  };

  const playCoachResponse = async (text: string) => {
    if (isSpeaking) {
      audioRef.current?.pause();
      setIsSpeaking(false);
      return;
    }

    try {
      setIsSpeaking(true);
      const base64Audio = await generateSpeech(text);
      if (base64Audio) {
        const audioUrl = `data:audio/mp3;base64,${base64Audio}`;
        if (audioRef.current) {
          audioRef.current.src = audioUrl;
        } else {
          audioRef.current = new Audio(audioUrl);
        }
        audioRef.current.play();
        audioRef.current.onended = () => setIsSpeaking(false);
      } else {
        setIsSpeaking(false);
      }
    } catch (error) {
      console.error("Failed to play audio", error);
      setIsSpeaking(false);
    }
  };
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);

  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Profile Sync
  useEffect(() => {
    if (!user) return;
    const profileRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(profileRef, (docSnap) => {
      if (docSnap.exists()) {
        setProfile(docSnap.data() as AthleteProfile);
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, `users/${user.uid}`));
    return () => unsubscribe();
  }, [user]);

  // Workouts Sync
  useEffect(() => {
    if (!user) return;
    const workoutsRef = collection(db, 'users', user.uid, 'workouts');
    const unsubscribe = onSnapshot(workoutsRef, (snapshot) => {
      const workoutData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Workout));
      setWorkouts(workoutData);
    }, (error) => handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/workouts`));
    return () => unsubscribe();
  }, [user]);

  // Chat Sync
  useEffect(() => {
    if (!user) return;
    const chatRef = collection(db, 'users', user.uid, 'messages');
    const q = query(chatRef, orderBy('timestamp', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatData = snapshot.docs.map(doc => doc.data() as ChatMessage);
      setChatHistory(chatData);
    }, (error) => handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/messages`));
    return () => unsubscribe();
  }, [user]);

  // OAuth Listener
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost') && !origin.includes('sub12.fr')) {
        return;
      }
      
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        if (event.data.isLogin) {
          // Handle login with Strava
          try {
            const { uid, athlete } = event.data;
            // Sign in anonymously to Firebase to get a session
            const userCredential = await signInAnonymously(auth);
            const firebaseUser = userCredential.user;
            
            // Initialize profile with Strava data
            const initialProfile: AthleteProfile = {
              name: athlete.firstname + ' ' + athlete.lastname,
              targetRace: 'Marathon',
              raceDate: '2026-06-07',
              weeklyHoursGoal: 8,
              fitnessLevel: 'Intermediate',
              experience: '',
              goalMode: 'Finisher',
              onboarded: true, // Assume onboarded if they use Strava login for simplicity or keep false
              isPremium: false,
              progressionScore: 45,
              stravaConnected: true
            };
            
            // Save to Firestore using the new anonymous UID
            await setDoc(doc(db, 'users', firebaseUser.uid), {
              ...initialProfile,
              stravaId: athlete.id,
              updatedAt: Date.now()
            });
            
            // Also save the Strava tokens to this new UID
            await setDoc(doc(db, 'users', firebaseUser.uid), {
              strava: event.data.stravaTokens
            }, { merge: true });

          } catch (error) {
            console.error("Failed to sign in with Strava:", error);
          }
        } else {
          saveProfile({ ...profile, stravaConnected: true });
        }
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        console.error('OAuth Error:', event.data.error);
        alert(`Erreur d'authentification : ${event.data.error}`);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [profile, user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLoginStrava = async () => {
    try {
      const response = await fetch('/api/auth/strava/url?login=true');
      if (!response.ok) throw new Error('Failed to get auth URL');
      const { url } = await response.json();
      
      window.open(
        url,
        'strava_oauth',
        'width=600,height=700'
      );
    } catch (error) {
      console.error('Strava login error:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setProfile({
        name: '',
        targetRace: 'Marathon',
        raceDate: '2026-06-07',
        weeklyHoursGoal: 8,
        fitnessLevel: 'Intermediate',
        experience: '',
        goalMode: 'Finisher',
        onboarded: false,
        isPremium: false,
        progressionScore: 45,
        weight: 70,
        height: 175,
        age: 30,
        profession: '',
        secondaryRaces: [],
        avatarUrl: '',
        stravaConnected: false
      });
      setWorkouts([]);
      setChatHistory([]);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleConnectStrava = async () => {
    if (!user) return;
    try {
      const response = await fetch(`/api/auth/strava/url?uid=${user.uid}`);
      if (!response.ok) throw new Error('Failed to get auth URL');
      const { url } = await response.json();
      
      window.open(
        url,
        'strava_oauth',
        'width=600,height=700'
      );
    } catch (error: any) {
      console.error('Strava connect error:', error);
      alert(`Erreur de connexion Strava : ${error.message}`);
    }
  };

  const saveProfile = async (newProfile: AthleteProfile) => {
    if (!user) return;
    const path = `users/${user.uid}`;
    try {
      await setDoc(doc(db, path), { ...newProfile, uid: user.uid, updatedAt: Date.now() });
      setProfile(newProfile);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const handleGeneratePlan = async () => {
    if (!user) return;
    setIsGeneratingPlan(true);
    try {
      const newWorkouts = await generateTrainingPlan(profile, chatHistory);
      if (!newWorkouts || newWorkouts.length === 0) {
        alert("Désolé, je n'ai pas pu générer de plan. Peux-tu réessayer ?");
        return;
      }
      
      // Clear old workouts or just add new ones? 
      // Usually, generating a new plan means replacing the current week.
      for (const workout of newWorkouts) {
        const path = `users/${user.uid}/workouts/${workout.id}`;
        await setDoc(doc(db, path), { ...workout, updatedAt: Date.now() });
      }
      
      setActiveTab('plan');
      alert("Ton nouveau plan d'entraînement est prêt !");
    } catch (error) {
      console.error("Plan generation error:", error);
      alert("Une erreur est survenue lors de la génération du plan.");
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  const toggleWorkout = async (id: string) => {
    if (!user) return;
    const workout = workouts.find(w => w.id === id);
    if (!workout) return;
    const path = `users/${user.uid}/workouts/${id}`;
    try {
      await setDoc(doc(db, path), { completed: !workout.completed }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  async function handleSendMessage(content: string) {
    if (!content.trim() || !user) return;
    
    const userMsg: ChatMessage = { role: 'user', content, timestamp: Date.now() };
    const userMsgPath = `users/${user.uid}/messages/${Date.now()}`;
    
    try {
      await setDoc(doc(db, userMsgPath), userMsg);
      setIsLoading(true);
      setActiveTab('coach');

      let stravaContext = "";
      if (profile.stravaConnected) {
        try {
          const response = await fetch(`/api/strava/activities?uid=${user.uid}`);
          if (response.ok) {
            const activities = await response.json();
            stravaContext = "\n\nDonnées Strava récentes :\n" + activities.map((a: any) => 
              `- ${a.type} : ${Math.round(a.distance / 1000 * 10) / 10}km en ${Math.round(a.moving_time / 60)}min (${a.start_date_local})`
            ).join('\n');
          }
        } catch (e) {
          console.error("Failed to fetch Strava context:", e);
        }
      }

      const { text, functionCalls } = await getCoachAdvice(content + stravaContext, chatHistory, profile);
      
      if (functionCalls) {
        for (const call of functionCalls) {
          if (call.name === 'updateWorkouts') {
            const { newWorkouts } = call.args as { newWorkouts: Workout[] };
            for (const workout of newWorkouts) {
              await setDoc(doc(db, `users/${user.uid}/workouts/${workout.id}`), workout);
            }
            const systemMsg: ChatMessage = { 
              role: 'model', 
              content: "J'ai mis à jour ton planning pour l'adapter à ta situation. Tu peux le consulter dans l'onglet Plan.", 
              timestamp: Date.now() 
            };
            await setDoc(doc(db, `users/${user.uid}/messages/${Date.now()}`), systemMsg);
          }
        }
      }

      if (text) {
        const modelMsg: ChatMessage = { role: 'model', content: text, timestamp: Date.now() };
        await setDoc(doc(db, `users/${user.uid}/messages/${Date.now() + 1}`), modelMsg);
        
        // Auto-play coach response
        playCoachResponse(text);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        saveProfile({ ...profile, avatarUrl: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const daysToRace = differenceInDays(parseISO(profile.raceDate), new Date());

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-orange-600" size={32} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-10 rounded-3xl shadow-2xl max-w-md w-full border border-slate-100 text-center"
        >
          <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center text-orange-500 mb-8 mx-auto shadow-lg">
            <Activity size={36} strokeWidth={2.5} />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-3 tracking-tight italic">Sub12</h1>
          <p className="text-slate-500 mb-10 text-sm leading-relaxed">
            Le coach IA qui adapte ton entraînement à ta vie d'entrepreneur.
          </p>
          <div className="space-y-3">
            <button 
              onClick={handleLogin}
              className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold text-base hover:bg-slate-800 transition-all shadow-xl flex items-center justify-center gap-3 active:scale-95"
            >
              <LogIn size={20} />
              Se connecter avec Google
            </button>
            <button 
              onClick={handleLoginStrava}
              className="w-full bg-[#FC4C02] text-white py-4 rounded-2xl font-bold text-base hover:bg-[#E34402] transition-all shadow-xl flex items-center justify-center gap-3 active:scale-95"
            >
              <Activity size={20} />
              Se connecter avec Strava
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!profile.onboarded) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-8 rounded-xl shadow-2xl max-w-md w-full border border-slate-100"
        >
          <div className="w-12 h-12 bg-slate-900 rounded-lg flex items-center justify-center text-orange-500 mb-6 mx-auto shadow-sm">
            <Activity size={28} strokeWidth={2.5} />
          </div>
          
          {onboardingStep === 0 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-center tracking-tight">Bienvenue sur Sub12</h2>
              <p className="text-slate-500 text-center text-sm">Commençons par ton nom pour personnaliser ton coaching.</p>
              <input 
                autoFocus
                placeholder="Ton prénom"
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-base font-medium focus:ring-2 focus:ring-orange-500 outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const newProfile = {...profile, name: (e.target as HTMLInputElement).value};
                    saveProfile(newProfile);
                    setOnboardingStep(1);
                  }
                }}
              />
              <button 
                onClick={() => setOnboardingStep(1)}
                className="w-full bg-orange-600 text-white py-3 rounded-lg font-bold text-base hover:bg-orange-700 transition-all shadow-sm"
              >
                Suivant
              </button>
            </div>
          )}

          {onboardingStep === 1 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-center tracking-tight">Ton Objectif ?</h2>
              <div className="grid grid-cols-1 gap-2">
                {['5K', '10K', 'Semi-Marathon', 'Marathon', 'Triathlon S/M', 'Triathlon L/XXL'].map(race => (
                  <button 
                    key={race}
                    onClick={() => {
                      saveProfile({...profile, targetRace: race});
                      setOnboardingStep(2);
                    }}
                    className="p-3 bg-slate-50 rounded-lg text-left font-semibold hover:bg-orange-50 hover:text-orange-600 transition-all border border-slate-200 hover:border-orange-200"
                  >
                    {race}
                  </button>
                ))}
              </div>
            </div>
          )}

          {onboardingStep === 2 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-center tracking-tight">Mode de Coaching ?</h2>
              <div className="grid grid-cols-1 gap-3">
                <button 
                  onClick={() => {
                    saveProfile({...profile, goalMode: 'Finisher'});
                    setOnboardingStep(3);
                  }}
                  className="p-4 bg-slate-50 rounded-lg text-left hover:bg-orange-50 transition-all border border-slate-200 hover:border-orange-200"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Trophy className="text-orange-600" size={18} />
                    <span className="font-bold text-base">Mode Finisher</span>
                  </div>
                  <p className="text-xs text-slate-500">Focus sur le volume, la santé et finir avec le sourire.</p>
                </button>
                <button 
                  onClick={() => {
                    saveProfile({...profile, goalMode: 'Chrono'});
                    setOnboardingStep(3);
                  }}
                  className="p-4 bg-slate-50 rounded-lg text-left hover:bg-orange-50 transition-all border border-slate-200 hover:border-orange-200"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className="text-orange-500" size={18} />
                    <span className="font-bold text-base">Mode Chrono</span>
                  </div>
                  <p className="text-xs text-slate-500">Optimisation de la FTP, VMA et gestion d'allure cible.</p>
                </button>
              </div>
            </div>
          )}

          {onboardingStep === 3 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-center tracking-tight">Profil Physique</h2>
              <div className="grid grid-cols-1 gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mono-label text-slate-400 block mb-1">Âge</label>
                    <input 
                      type="number"
                      value={profile.age}
                      onChange={e => saveProfile({...profile, age: parseInt(e.target.value)})}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-orange-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="mono-label text-slate-400 block mb-1">Profession</label>
                    <input 
                      placeholder="Ex: Cadre"
                      value={profile.profession}
                      onChange={e => saveProfile({...profile, profession: e.target.value})}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-orange-500 outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mono-label text-slate-400 block mb-1">Poids (kg)</label>
                    <input 
                      type="number"
                      value={profile.weight}
                      onChange={e => saveProfile({...profile, weight: parseInt(e.target.value)})}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-orange-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="mono-label text-slate-400 block mb-1">Taille (cm)</label>
                    <input 
                      type="number"
                      value={profile.height}
                      onChange={e => saveProfile({...profile, height: parseInt(e.target.value)})}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-orange-500 outline-none"
                    />
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setOnboardingStep(4)}
                className="w-full bg-orange-600 text-white py-3 rounded-lg font-bold text-base hover:bg-orange-700 transition-all shadow-sm"
              >
                Suivant
              </button>
            </div>
          )}

          {onboardingStep === 4 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-center tracking-tight">C'est parti !</h2>
              <p className="text-slate-500 text-center text-sm">Sub12 prépare ton plan adaptatif...</p>
              <div className="flex justify-center py-6">
                <Loader2 className="animate-spin text-orange-600" size={32} />
              </div>
              <button 
                onClick={() => {
                  const finalProfile = {...profile, onboarded: true};
                  saveProfile(finalProfile);
                  handleGeneratePlan();
                }}
                className="w-full bg-orange-600 text-white py-3 rounded-lg font-bold text-base hover:bg-orange-700 transition-all"
              >
                Accéder au Dashboard
              </button>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-24">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 px-4 py-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-slate-900 rounded-lg flex items-center justify-center text-orange-500 shadow-sm">
            <Activity size={22} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="font-bold text-base leading-none tracking-tight">Sub12</h1>
            <p className="mono-label text-slate-400 mt-0.5">Performance Engine</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!profile.isPremium && (
            <button className="hidden md:block bg-slate-900 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-colors">
              Premium
            </button>
          )}
          <div className="text-right hidden sm:block">
            <p className="mono-label text-orange-600">{profile.targetRace}</p>
            <p className="text-sm font-bold font-mono">D-{daysToRace}</p>
          </div>
          <button 
            onClick={() => setActiveTab('profile')}
            className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200 hover:bg-slate-200 transition-colors"
          >
            <User size={20} className="text-slate-600" />
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 md:p-6">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-500 mb-2">
                    <Flame size={14} className="text-orange-500" />
                    <span className="mono-label">Charge</span>
                  </div>
                  <p className="text-2xl font-bold font-mono">742</p>
                  <p className="text-[10px] text-green-600 font-bold flex items-center gap-0.5">
                    <TrendingUp size={10} /> +12%
                  </p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-500 mb-2">
                    <Timer size={14} className="text-orange-500" />
                    <span className="mono-label">Volume</span>
                  </div>
                  <p className="text-2xl font-bold font-mono">8.5h</p>
                  <p className="text-[10px] text-slate-400 font-bold">Goal: {profile.weeklyHoursGoal}h</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center">
                  <div className="relative w-12 h-12 mb-1">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-slate-100" />
                      <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="transparent" strokeDasharray={125.6} strokeDashoffset={125.6 * (1 - profile.progressionScore / 100)} className="text-orange-600" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold font-mono">
                      {profile.progressionScore}%
                    </div>
                  </div>
                  <span className="mono-label text-slate-400">Progression</span>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-500 mb-2">
                    <Calendar size={14} className="text-orange-500" />
                    <span className="mono-label">Countdown</span>
                  </div>
                  <p className="text-2xl font-bold font-mono">{daysToRace}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase">Jours</p>
                </div>
              </div>

              {/* Chart */}
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
                  <TrendingUp size={16} className="text-orange-600" />
                  <span className="mono-label">Charge Hebdomadaire (TSS)</span>
                </h3>
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={[
                      { day: 'Lun', tss: 80 },
                      { day: 'Mar', tss: 120 },
                      { day: 'Mer', tss: 45 },
                      { day: 'Jeu', tss: 150 },
                      { day: 'Ven', tss: 0 },
                      { day: 'Sam', tss: 220 },
                      { day: 'Dim', tss: 180 },
                    ]}>
                      <defs>
                        <linearGradient id="colorTss" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ea580c" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#ea580c" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 600, fill: '#94a3b8', fontFamily: 'JetBrains Mono'}} />
                      <YAxis hide />
                      <Tooltip 
                        contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', fontFamily: 'JetBrains Mono', fontSize: '10px' }}
                        labelStyle={{ fontWeight: 800, color: '#ea580c' }}
                      />
                      <Area type="monotone" dataKey="tss" stroke="#ea580c" strokeWidth={2} fillOpacity={1} fill="url(#colorTss)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Next Workout */}
              <div className="bg-slate-900 rounded-xl p-5 text-white shadow-lg relative overflow-hidden">
                <div className="relative z-10">
                  <p className="mono-label text-orange-500 mb-2">Prochaine séance</p>
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-xl font-bold mb-3 tracking-tight">Sortie Longue Endurance</h3>
                      <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-slate-400">
                        <span className="flex items-center gap-1 bg-slate-800 px-2 py-1 rounded-md"><Timer size={12} /> 2h 30m</span>
                        <span className="flex items-center gap-1 bg-slate-800 px-2 py-1 rounded-md"><Bike size={12} /> Vélo</span>
                        <span className="flex items-center gap-1 bg-slate-800 px-2 py-1 rounded-md text-orange-400 font-mono"><Zap size={12} /> Z2 / 180W</span>
                      </div>
                    </div>
                    <div className="bg-slate-800 p-2.5 rounded-lg">
                      <Bike size={24} className="text-orange-500" />
                    </div>
                  </div>
                  <button 
                    onClick={() => setActiveTab('plan')}
                    className="mt-5 w-full bg-orange-600 text-white py-2 rounded-lg font-bold text-xs hover:bg-orange-700 transition-colors flex items-center justify-center gap-2"
                  >
                    Planning complet <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'plan' && (
            <motion.div 
              key="plan"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold tracking-tight">Planning Hebdo</h2>
                  <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button 
                      onClick={() => setPlanView('list')}
                      className={cn(
                        "p-1.5 rounded-md transition-all",
                        planView === 'list' ? "bg-white shadow-sm text-orange-600" : "text-slate-400 hover:text-slate-600"
                      )}
                    >
                      <List size={14} />
                    </button>
                    <button 
                      onClick={() => setPlanView('calendar')}
                      className={cn(
                        "p-1.5 rounded-md transition-all",
                        planView === 'calendar' ? "bg-white shadow-sm text-orange-600" : "text-slate-400 hover:text-slate-600"
                      )}
                    >
                      <LayoutGrid size={14} />
                    </button>
                  </div>
                </div>
                <button 
                  onClick={handleGeneratePlan}
                  disabled={isGeneratingPlan}
                  className="bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-slate-800 transition-all disabled:opacity-50"
                >
                  {isGeneratingPlan ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Générer
                </button>
              </div>

              {workouts.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
                  <Calendar size={40} className="mx-auto text-slate-200 mb-3" />
                  <h3 className="text-base font-bold text-slate-600">Aucun plan actif</h3>
                  <p className="text-slate-400 text-xs mb-5 max-w-[200px] mx-auto">
                    Utilise l'IA pour générer ton plan personnalisé.
                  </p>
                  <button 
                    onClick={handleGeneratePlan}
                    className="bg-orange-600 text-white px-6 py-2 rounded-lg font-bold text-sm hover:bg-orange-700 transition-all"
                  >
                    Générer mon plan
                  </button>
                </div>
              ) : planView === 'list' ? (
                <div className="space-y-2">
                  {workouts.map((workout, idx) => (
                    <motion.div 
                      key={workout.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.03 }}
                      className={cn(
                        "bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex items-center gap-3 transition-all",
                        workout.completed && "opacity-60 bg-slate-50"
                      )}
                    >
                      <button 
                        onClick={() => toggleWorkout(workout.id)}
                        className={cn(
                          "w-6 h-6 rounded-md flex items-center justify-center transition-all",
                          workout.completed ? "bg-green-500 text-white" : "border border-slate-200 text-slate-300 hover:border-orange-400"
                        )}
                      >
                        {workout.completed ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                      </button>
                      
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="mono-label text-slate-400">
                            {format(parseISO(workout.date), 'EEE d MMM', { locale: fr })}
                          </span>
                          <IntensityBadge intensity={workout.intensity} />
                        </div>
                        <h4 className="font-bold text-sm text-slate-900">{workout.title}</h4>
                      </div>

                      <div className="text-right flex items-center gap-3">
                        <div>
                          <div className="flex items-center justify-end gap-1 text-slate-900 font-bold font-mono text-xs">
                            <span>{workout.durationMinutes}m</span>
                          </div>
                          <div className="flex justify-end mt-0.5">
                            <SportIcon sport={workout.sport} className="text-orange-600" size={14} />
                          </div>
                        </div>
                        <button 
                          onClick={() => setEditingWorkout(workout)}
                          className="text-slate-300 hover:text-orange-600 transition-colors p-1"
                        >
                          <Edit2 size={14} />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <div className="grid grid-cols-7 gap-1 mb-2">
                      {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(day => (
                        <div key={day} className="text-center mono-label text-[10px] text-slate-400 py-1">{day}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {Array.from({ length: 7 }).map((_, i) => {
                        const date = addDays(new Date(), i);
                        const dayWorkouts = workouts.filter(w => isSameDay(parseISO(w.date), date));
                        const isSelected = isSameDay(date, selectedDate);
                        
                        return (
                          <button 
                            key={i} 
                            onClick={() => setSelectedDate(date)}
                            className={cn(
                              "aspect-square border rounded-md p-1 flex flex-col gap-1 overflow-hidden transition-all",
                              isSelected ? "border-orange-500 bg-orange-50 ring-1 ring-orange-500" : "border-slate-100 hover:border-slate-200"
                            )}
                          >
                            <span className={cn(
                              "text-[8px] font-mono",
                              isSelected ? "text-orange-600 font-bold" : "text-slate-300"
                            )}>{format(date, 'd')}</span>
                            <div className="flex flex-wrap gap-0.5">
                              {dayWorkouts.map(w => (
                                <div 
                                  key={w.id} 
                                  className={cn(
                                    "w-1.5 h-1.5 rounded-full",
                                    w.completed ? "bg-green-400" : "bg-orange-400"
                                  )}
                                  title={w.title}
                                />
                              ))}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between px-1">
                      <h3 className="text-sm font-bold text-slate-900">
                        {format(selectedDate, 'EEEE d MMMM', { locale: fr })}
                      </h3>
                      <span className="mono-label text-[10px] text-slate-400">
                        {workouts.filter(w => isSameDay(parseISO(w.date), selectedDate)).length} séance(s)
                      </span>
                    </div>
                    
                    <div className="space-y-2">
                      {workouts
                        .filter(w => isSameDay(parseISO(w.date), selectedDate))
                        .map((workout, idx) => (
                          <motion.div 
                            key={workout.id}
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className={cn(
                              "bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex items-center gap-3 transition-all",
                              workout.completed && "opacity-60 bg-slate-50"
                            )}
                          >
                            <button 
                              onClick={() => toggleWorkout(workout.id)}
                              className={cn(
                                "w-6 h-6 rounded-md flex items-center justify-center transition-all",
                                workout.completed ? "bg-green-500 text-white" : "border border-slate-200 text-slate-300 hover:border-orange-400"
                              )}
                            >
                              {workout.completed ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                            </button>
                            
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-0.5">
                                <IntensityBadge intensity={workout.intensity} />
                                <SportIcon sport={workout.sport} className="text-orange-600" size={12} />
                              </div>
                              <h4 className="font-bold text-sm text-slate-900">{workout.title}</h4>
                            </div>

                            <div className="text-right flex items-center gap-3">
                              <div className="flex items-center justify-end gap-1 text-slate-900 font-bold font-mono text-xs">
                                <span>{workout.durationMinutes}m</span>
                              </div>
                              <button 
                                onClick={() => setEditingWorkout(workout)}
                                className="text-slate-300 hover:text-orange-600 transition-colors p-1"
                              >
                                <Edit2 size={14} />
                              </button>
                            </div>
                          </motion.div>
                        ))}
                      {workouts.filter(w => isSameDay(parseISO(w.date), selectedDate)).length === 0 && (
                        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-6 text-center">
                          <p className="text-xs text-slate-400 font-medium">Repos ou aucune séance prévue</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'coach' && (
            <motion.div 
              key="coach"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="h-[calc(100vh-180px)] flex flex-col bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden"
            >
              {/* Coach Header */}
              <div className="p-3 border-b border-slate-100 flex items-center gap-3 bg-slate-50">
                <div className="w-10 h-10 bg-slate-900 rounded-lg flex items-center justify-center text-orange-500 shadow-sm">
                  <Activity size={20} strokeWidth={2.5} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Coach AI</h3>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                    <span className="mono-label text-slate-400">Expert Performance</span>
                  </div>
                </div>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {chatHistory.length === 0 && (
                  <div className="text-center py-10 px-6">
                    <div className="w-12 h-12 bg-orange-50 rounded-xl flex items-center justify-center text-orange-600 mx-auto mb-3">
                      <MessageSquare size={24} />
                    </div>
                    <h4 className="font-bold text-slate-900 text-sm mb-1">Analyse de performance</h4>
                    <p className="text-xs text-slate-500 mb-5">
                      Pose tes questions techniques ou débriefe ta séance.
                    </p>
                    <div className="grid grid-cols-1 gap-2 max-w-[240px] mx-auto">
                      {[
                        "Ajuster ma séance (fatigue)",
                        "Nutrition avant sortie longue",
                        "Intérêt de la Zone 2"
                      ].map((q, i) => (
                        <button 
                          key={i}
                          onClick={() => handleSendMessage(q)}
                          className="text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-200 p-2 rounded-lg hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 transition-all text-left"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {chatHistory.map((msg, i) => (
                  <div key={i} className={cn(
                    "flex flex-col max-w-[90%]",
                    msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start"
                  )}>
                    <div className={cn(
                      "p-3 rounded-lg text-xs leading-relaxed group relative",
                      msg.role === 'user' 
                        ? "bg-slate-900 text-white rounded-tr-none" 
                        : "bg-slate-100 text-slate-800 rounded-tl-none border border-slate-200"
                    )}>
                      <div className="prose prose-sm prose-slate max-w-none">
                        <ReactMarkdown>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                      {msg.role === 'model' && (
                        <button 
                          onClick={() => playCoachResponse(msg.content)}
                          className="absolute -right-8 top-0 p-1.5 text-slate-300 hover:text-orange-600 transition-colors"
                          title="Écouter la réponse"
                        >
                          <Volume2 size={14} className={isSpeaking ? "animate-pulse text-orange-600" : ""} />
                        </button>
                      )}
                    </div>
                    <span className="mono-label text-slate-400 mt-1">
                      {msg.role === 'user' ? 'Athlète' : 'Coach'} • {format(msg.timestamp, 'HH:mm')}
                    </span>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex items-center gap-2 text-slate-400">
                    <Loader2 size={12} className="animate-spin" />
                    <span className="mono-label">Analyse en cours...</span>
                  </div>
                )}
              </div>

              {/* Chat Input */}
              <div className="p-3 border-t border-slate-100">
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    const input = (e.target as any).message;
                    handleSendMessage(input.value);
                    input.value = '';
                  }}
                  className="flex gap-2"
                >
                  <input 
                    name="message"
                    placeholder="Message au coach..."
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-orange-500 outline-none transition-all"
                  />
                  <button 
                    type="button"
                    onClick={toggleRecording}
                    className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center transition-all shadow-sm",
                      isRecording ? "bg-red-500 text-white animate-pulse" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    )}
                  >
                    {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
                  </button>
                  <button 
                    type="submit"
                    disabled={isLoading}
                    className="bg-orange-600 text-white w-10 h-10 rounded-lg flex items-center justify-center hover:bg-orange-700 transition-all shadow-sm disabled:opacity-50"
                  >
                    <Send size={16} />
                  </button>
                </form>
              </div>
            </motion.div>
          )}

          {activeTab === 'profile' && (
            <motion.div 
              key="profile"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="h-24 bg-slate-900 relative">
                  <div className="absolute -bottom-10 left-6">
                    <div className="w-20 h-20 bg-white rounded-xl p-1 shadow-md relative group">
                      <div className="w-full h-full bg-slate-50 rounded-lg flex items-center justify-center text-slate-300 overflow-hidden">
                        {profile.avatarUrl ? (
                          <img src={profile.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                        ) : (
                          <User size={40} />
                        )}
                      </div>
                      <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-lg">
                        <Camera className="text-white" size={20} />
                        <input type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                      </label>
                    </div>
                  </div>
                </div>
                <div className="pt-12 pb-5 px-6">
                  <h2 className="text-xl font-bold tracking-tight">{profile.name || 'Athlète'}</h2>
                  <p className="mono-label text-slate-400 mt-1">{profile.fitnessLevel} • {profile.goalMode}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-sm flex items-center gap-2">
                      <Trophy size={16} className="text-orange-600" />
                      <span className="mono-label">Compte</span>
                    </h3>
                    <button 
                      onClick={handleLogout}
                      className="text-red-500 hover:bg-red-50 px-2 py-1 rounded-md transition-colors text-xs font-bold flex items-center gap-1"
                    >
                      <LogOut size={14} /> Déconnexion
                    </button>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <p className="text-[10px] mono-label text-slate-400 mb-1">Connecté en tant que</p>
                    <p className="text-xs font-bold text-slate-900 truncate">{user.email}</p>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="font-bold text-sm flex items-center gap-2">
                    <Trophy size={16} className="text-orange-600" />
                    <span className="mono-label">Objectif Principal</span>
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="mono-label text-slate-400 block mb-1">Course cible</label>
                      <input 
                        value={profile.targetRace}
                        onChange={e => saveProfile({...profile, targetRace: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="mono-label text-slate-400 block mb-1">Date</label>
                      <input 
                        type="date"
                        value={profile.raceDate}
                        onChange={e => saveProfile({...profile, raceDate: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="font-bold text-sm flex items-center gap-2">
                    <User size={16} className="text-orange-600" />
                    <span className="mono-label">Profil Physique</span>
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mono-label text-slate-400 block mb-1">Âge</label>
                      <input 
                        type="number"
                        value={profile.age}
                        onChange={e => saveProfile({...profile, age: parseInt(e.target.value)})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="mono-label text-slate-400 block mb-1">Poids (kg)</label>
                      <input 
                        type="number"
                        value={profile.weight}
                        onChange={e => saveProfile({...profile, weight: parseInt(e.target.value)})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="mono-label text-slate-400 block mb-1">Taille (cm)</label>
                      <input 
                        type="number"
                        value={profile.height}
                        onChange={e => saveProfile({...profile, height: parseInt(e.target.value)})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="mono-label text-slate-400 block mb-1">Profession</label>
                      <input 
                        value={profile.profession}
                        onChange={e => saveProfile({...profile, profession: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="font-bold text-sm flex items-center gap-2">
                    <Settings size={16} className="text-orange-600" />
                    <span className="mono-label">Configuration</span>
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="mono-label text-slate-400 block mb-1">Volume Hebdo (h)</label>
                      <input 
                        type="number"
                        value={profile.weeklyHoursGoal}
                        onChange={e => saveProfile({...profile, weeklyHoursGoal: parseInt(e.target.value)})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="mono-label text-slate-400 block mb-1">Niveau</label>
                      <select 
                        value={profile.fitnessLevel}
                        onChange={e => saveProfile({...profile, fitnessLevel: e.target.value as any})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                      >
                        <option value="Beginner">Débutant</option>
                        <option value="Intermediate">Intermédiaire</option>
                        <option value="Advanced">Avancé</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-sm flex items-center gap-2">
                      <Calendar size={16} className="text-orange-600" />
                      <span className="mono-label">Courses Secondaires</span>
                    </h3>
                    <button 
                      onClick={() => saveProfile({...profile, secondaryRaces: [...(profile.secondaryRaces || []), 'Nouvelle course']})}
                      className="text-orange-600 hover:bg-orange-50 p-1 rounded-md transition-colors"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {(profile.secondaryRaces || []).map((race, idx) => (
                      <div key={idx} className="flex gap-2">
                        <input 
                          value={race}
                          onChange={e => {
                            const newRaces = [...(profile.secondaryRaces || [])];
                            newRaces[idx] = e.target.value;
                            saveProfile({...profile, secondaryRaces: newRaces});
                          }}
                          className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                        />
                        <button 
                          onClick={() => {
                            const newRaces = (profile.secondaryRaces || []).filter((_, i) => i !== idx);
                            saveProfile({...profile, secondaryRaces: newRaces});
                          }}
                          className="text-slate-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    {(profile.secondaryRaces || []).length === 0 && (
                      <p className="text-[10px] text-slate-400 italic">Aucune course secondaire définie.</p>
                    )}
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="font-bold text-sm flex items-center gap-2">
                    <Activity size={16} className="text-orange-600" />
                    <span className="mono-label">Services Connectés</span>
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-[#FC4C02] rounded-md flex items-center justify-center text-white">
                          <Activity size={18} />
                        </div>
                        <div>
                          <p className="text-xs font-bold">Strava</p>
                          <p className="text-[10px] text-slate-400">
                            {profile.stravaConnected ? 'Connecté' : 'Synchronisation des activités'}
                          </p>
                        </div>
                      </div>
                      <button 
                        onClick={handleConnectStrava}
                        disabled={profile.stravaConnected}
                        className={cn(
                          "text-[10px] font-bold px-3 py-1 rounded-md transition-all border",
                          profile.stravaConnected 
                            ? "text-green-600 bg-green-50 border-green-200 cursor-default"
                            : "text-orange-600 bg-white border-orange-200 hover:bg-orange-50"
                        )}
                      >
                        {profile.stravaConnected ? 'Connecté' : 'Connecter'}
                      </button>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-[#007CC3] rounded-md flex items-center justify-center text-white">
                          <Activity size={18} />
                        </div>
                        <div>
                          <p className="text-xs font-bold">Garmin Connect</p>
                          <p className="text-[10px] text-slate-400">Données biométriques & plans</p>
                        </div>
                      </div>
                      <button className="text-[10px] font-bold text-orange-600 bg-white border border-orange-200 px-3 py-1 rounded-md hover:bg-orange-50 transition-all">
                        Connecter
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 italic leading-relaxed">
                    La connexion à Strava ou Garmin permet à Sub12 d'analyser ta fatigue réelle et d'ajuster ton plan automatiquement.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-md bg-white/80 backdrop-blur-xl border border-white/20 px-6 py-3 z-40 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
        <div className="flex justify-between items-center">
          <NavButton 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')} 
            icon={<LayoutGrid size={20} />} 
            label="Home" 
          />
          <NavButton 
            active={activeTab === 'plan'} 
            onClick={() => setActiveTab('plan')} 
            icon={<Calendar size={20} />} 
            label="Plan" 
          />
          <NavButton 
            active={activeTab === 'coach'} 
            onClick={() => setActiveTab('coach')} 
            icon={<MessageSquare size={20} />} 
            label="Coach" 
          />
          <NavButton 
            active={activeTab === 'profile'} 
            onClick={() => setActiveTab('profile')} 
            icon={<User size={20} />} 
            label="Profil" 
          />
        </div>
      </nav>

      {/* Edit Workout Modal */}
      <AnimatePresence>
        {editingWorkout && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden"
            >
              <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h3 className="font-bold text-sm mono-label">Modifier la séance</h3>
                <button 
                  onClick={() => setEditingWorkout(null)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="mono-label text-[10px] text-slate-400 block mb-1">Titre</label>
                  <input 
                    value={editingWorkout.title}
                    onChange={e => setEditingWorkout({...editingWorkout, title: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-1 focus:ring-orange-500 outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mono-label text-[10px] text-slate-400 block mb-1">Sport</label>
                    <select 
                      value={editingWorkout.sport}
                      onChange={e => setEditingWorkout({...editingWorkout, sport: e.target.value as any})}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                    >
                      <option value="Run">Course</option>
                      <option value="Bike">Vélo</option>
                      <option value="Swim">Natation</option>
                      <option value="Strength">Renfo</option>
                      <option value="Rest">Repos</option>
                    </select>
                  </div>
                  <div>
                    <label className="mono-label text-[10px] text-slate-400 block mb-1">Durée (min)</label>
                    <input 
                      type="number"
                      value={editingWorkout.durationMinutes}
                      onChange={e => setEditingWorkout({...editingWorkout, durationMinutes: parseInt(e.target.value)})}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-1 focus:ring-orange-500 outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="mono-label text-[10px] text-slate-400 block mb-1">Description</label>
                  <textarea 
                    rows={3}
                    value={editingWorkout.description}
                    onChange={e => setEditingWorkout({...editingWorkout, description: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium focus:ring-1 focus:ring-orange-500 outline-none resize-none"
                  />
                </div>
                <button 
                  onClick={async () => {
                    if (!user) return;
                    const path = `users/${user.uid}/workouts/${editingWorkout.id}`;
                    try {
                      await setDoc(doc(db, path), editingWorkout, { merge: true });
                      setEditingWorkout(null);
                    } catch (error) {
                      handleFirestoreError(error, OperationType.UPDATE, path);
                    }
                  }}
                  className="w-full bg-orange-600 text-white py-3 rounded-lg font-bold text-sm hover:bg-orange-700 transition-all shadow-sm"
                >
                  Enregistrer les modifications
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 transition-all duration-300 relative group",
        active ? "text-orange-600" : "text-slate-400 hover:text-slate-600"
      )}
    >
      <div className={cn(
        "p-2 rounded-xl transition-all duration-300",
        active ? "bg-orange-50 shadow-sm" : "group-hover:bg-slate-50"
      )}>
        {icon}
      </div>
      <span className={cn(
        "mono-label text-[9px] font-bold tracking-wider uppercase",
        active ? "opacity-100" : "opacity-60"
      )}>{label}</span>
      {active && (
        <motion.div 
          layoutId="nav-indicator"
          className="absolute -bottom-1.5 w-1 h-1 bg-orange-600 rounded-full shadow-[0_0_8px_rgba(234,88,12,0.6)]"
        />
      )}
    </button>
  );
}
