import React, { useState, useEffect, useRef } from 'react';
import { 
  Trophy, 
  Target,
  Calendar, 
  MessageSquare, 
  User, 
  ChevronRight, 
  ArrowRight,
  Twitter,
  Instagram,
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
  Info,
  Mic,
  MicOff,
  Volume2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, differenceInDays, parseISO, addDays, isSameDay, startOfDay, startOfWeek, subDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  AreaChart,
  Area
} from 'recharts';
import ReactMarkdown from 'react-markdown';
import { cn } from './lib/utils';
import { AthleteProfile, Workout, ChatMessage, Sport, SecondaryRace } from './types';
import { generateTrainingPlan, getCoachAdvice, generateSpeech, generateDailyCoachInsight } from './services/gemini';
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
  deleteDoc,
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






const RaceLogo = ({ name, className = "w-10 h-10" }: { name: string, className?: string }) => {
  const lowerName = name.toLowerCase();
  
  let icon = <Trophy size={20} className="text-orange-600" />;
  let bgColor = "bg-orange-50";
  
  if (lowerName.includes('triathlon') || lowerName.includes('ironman')) {
    icon = <Activity size={20} className="text-blue-600" />;
    bgColor = "bg-blue-50";
  } else if (lowerName.includes('marathon') || lowerName.includes('run') || lowerName.includes('10k') || lowerName.includes('semi')) {
    icon = <Footprints size={20} className="text-orange-600" />;
    bgColor = "bg-orange-50";
  } else if (lowerName.includes('bike') || lowerName.includes('ride') || lowerName.includes('cyclisme')) {
    icon = <Bike size={20} className="text-green-600" />;
    bgColor = "bg-green-50";
  } else if (lowerName.includes('swim') || lowerName.includes('natation')) {
    icon = <Waves size={20} className="text-cyan-600" />;
    bgColor = "bg-cyan-50";
  } else if (lowerName.includes('trail') || lowerName.includes('mountain')) {
    icon = <TrendingUp size={20} className="text-emerald-600" />;
    bgColor = "bg-emerald-50";
  } else if (lowerName.includes('hyrox') || lowerName.includes('crossfit') || lowerName.includes('strength')) {
    icon = <Dumbbell size={20} className="text-slate-600" />;
    bgColor = "bg-slate-100";
  }

  return (
    <div className={cn("rounded-xl flex items-center justify-center border border-slate-100 flex-shrink-0 shadow-sm", bgColor, className)}>
      {icon}
    </div>
  );
};

const SportImage = ({ sport, className }: { sport: Sport; className?: string }) => {
  const keywords: Record<Sport, string> = {
    'Swim': 'swimming-pool-athlete',
    'Bike': 'cycling-road-bike-race',
    'Run': 'running-athlete-track-marathon',
    'Strength': 'gym-workout-weights',
    'Rest': 'recovery-massage-sleep'
  };
  const seed = `${sport}-pro-athlete-sub12`;
  return (
    <img 
      src={`https://picsum.photos/seed/${encodeURIComponent(seed)}/400/300`} 
      alt={sport} 
      className={cn("w-full h-full object-cover", className)}
      referrerPolicy="no-referrer"
    />
  );
};

const Logo = ({ className = "w-10 h-10", iconOnly = false }: { className?: string, iconOnly?: boolean }) => (
  <div className={cn("flex items-center gap-3", className)}>
    <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-orange-600/20 flex-shrink-0">
      <svg viewBox="0 0 32 32" className="w-7 h-7" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M26 16h-4l-3 9-6-18-3 9h-4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
    {!iconOnly && <span className="text-2xl font-black tracking-tight text-slate-900">Sub12</span>}
  </div>
);

const LandingPage = ({ onLogin, onLoginStrava }: { onLogin: () => void, onLoginStrava: () => void }) => {
  return (
    <div className="min-h-screen bg-white selection:bg-orange-100">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <Logo className="w-12 h-12" />
          <button 
            onClick={onLogin}
            className="bg-slate-900 text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-slate-800 transition-all shadow-lg active:scale-95"
          >
            Se connecter
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-40 pb-20 px-6">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-8"
          >
            <div className="inline-flex items-center gap-2 bg-orange-50 text-orange-600 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest border border-orange-100">
              <Zap size={14} /> L'IA au service de ta performance
            </div>
            <h1 className="text-6xl lg:text-7xl font-black text-slate-900 leading-[1.1] tracking-tight italic">
              Entraîne-toi <br />
              <span className="text-orange-600">sans compromis.</span>
            </h1>
            <p className="text-xl text-slate-500 max-w-lg leading-relaxed">
              Sub12 est le coach IA qui adapte ton plan d'entraînement à ton agenda d'entrepreneur. Synchronise Strava, définis tes objectifs, et laisse l'IA faire le reste.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <button 
                onClick={onLogin}
                className="bg-orange-600 text-white px-10 py-5 rounded-2xl font-black text-lg hover:bg-orange-700 transition-all shadow-2xl shadow-orange-500/20 active:scale-95 flex items-center justify-center gap-3"
              >
                Commencer maintenant <ArrowRight size={20} />
              </button>
              <button 
                onClick={onLoginStrava}
                className="bg-[#FC4C02] text-white px-10 py-5 rounded-2xl font-black text-lg hover:bg-[#E34402] transition-all shadow-2xl shadow-orange-500/10 active:scale-95 flex items-center justify-center gap-3"
              >
                <Activity size={20} /> Login with Strava
              </button>
            </div>
            <div className="flex items-center gap-6 pt-8">
              <div className="flex -space-x-3">
                {[1,2,3,4].map(i => (
                  <img key={i} src={`https://i.pravatar.cc/100?u=${i}`} className="w-10 h-10 rounded-full border-2 border-white shadow-sm" referrerPolicy="no-referrer" />
                ))}
              </div>
              <p className="text-sm text-slate-400 font-medium">
                Rejoint par <span className="text-slate-900 font-bold">+500 athlètes</span> cette semaine
              </p>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="relative"
          >
            <div className="absolute -inset-4 bg-orange-500/10 blur-3xl rounded-full" />
            <div className="relative bg-slate-900 rounded-[2.5rem] p-4 shadow-2xl border border-slate-800 overflow-hidden group">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-orange-500 to-orange-600" />
              <img 
                src="https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?auto=format&fit=crop&q=80&w=1000" 
                className="rounded-[2rem] w-full h-auto object-cover opacity-80 group-hover:scale-105 transition-transform duration-700"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent" />
              <div className="absolute bottom-10 left-10 right-10">
                <div className="bg-white/10 backdrop-blur-md border border-white/20 p-6 rounded-2xl">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 bg-orange-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                      <Activity size={24} />
                    </div>
                    <div>
                      <p className="text-white font-bold">Séance du jour</p>
                      <p className="text-white/60 text-xs">Intervalle Seuil • 45min</p>
                    </div>
                  </div>
                  <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                    <div className="w-[75%] h-full bg-orange-500" />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-20 space-y-4">
            <h2 className="text-4xl font-black text-slate-900 tracking-tight italic">Pourquoi Sub12 ?</h2>
            <p className="text-slate-500">L'outil ultime pour ceux qui n'ont pas le temps de gérer leur plan, mais qui veulent des résultats.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: <Zap className="text-orange-600" />, title: "IA Adaptative", desc: "Ton plan se recalcule si tu rates une séance ou si ton agenda change." },
              { icon: <Activity className="text-orange-600" />, title: "Sync Strava", desc: "Tes séances réelles sont comparées à ton plan pour mesurer ta progression." },
              { icon: <MessageSquare className="text-orange-600" />, title: "Coach 24/7", desc: "Pose tes questions à ton coach IA, il connaît tes données par cœur." }
            ].map((f, i) => (
              <div key={i} className="bg-white p-10 rounded-3xl border border-slate-200 shadow-sm hover:shadow-xl transition-all group">
                <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-orange-50 transition-colors">
                  {f.icon}
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-4 tracking-tight">{f.title}</h3>
                <p className="text-slate-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <Logo className="w-10 h-10" />
          <p className="text-slate-400 text-sm font-medium">© 2026 Sub12. Tous droits réservés.</p>
          <div className="flex items-center gap-6">
            <a href="#" className="text-slate-400 hover:text-slate-900 transition-colors"><Twitter size={20} /></a>
            <a href="#" className="text-slate-400 hover:text-slate-900 transition-colors"><Instagram size={20} /></a>
          </div>
        </div>
      </footer>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'plan' | 'coach' | 'profile'>('dashboard');
  const [profile, setProfile] = useState<AthleteProfile>({
    uid: '',
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
    coachGender: 'Man',
    coachName: 'Coach Sub12',
    voiceEnabled: true,
    gender: 'Man',
    prs: {
      vma: 15,
      ftp: 200,
      css: '1:50',
      maxHr: 190,
      restHr: 50
    }
  });

  const [onboardingStep, setOnboardingStep] = useState(0);
  const [planView, setPlanView] = useState<'list' | 'calendar'>('list');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [editingWorkout, setEditingWorkout] = useState<Workout | null>(null);
  const [editingProfile, setEditingProfile] = useState<AthleteProfile | null>(null);

  const [stravaFilter, setStravaFilter] = useState<{
    period: 'week' | 'month' | 'year' | 'all';
    type: string;
  }>({ period: 'month', type: 'all' });

  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [stravaActivities, setStravaActivities] = useState<any[]>([]);
  const [coachInsight, setCoachInsight] = useState<string>("");
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'fr-FR';

      recognitionRef.current.onstart = () => {
        console.log("Speech recognition started");
        setIsRecording(true);
      };

      recognitionRef.current.onresult = (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        const currentTranscript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join('');
        setMessageInput(currentTranscript);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
        if (event.error === 'not-allowed') {
          showToast("Accès au micro refusé. Vérifie les paramètres de ton navigateur.", "error");
        } else if (event.error === 'no-speech') {
          showToast("Aucune voix détectée. Réessaie.", "error");
        } else {
          showToast(`Erreur micro: ${event.error}`, "error");
        }
      };

      recognitionRef.current.onend = () => {
        console.log("Speech recognition ended");
        setIsRecording(false);
        showToast("Transcription terminée. Tu peux relire et envoyer.", "success");
      };

      return () => {
        if (recognitionRef.current) {
          recognitionRef.current.abort();
        }
      };
    }
  }, []);

  const initAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  };

  const toggleRecording = () => {
    initAudioContext(); // Resume context on user gesture
    if (!recognitionRef.current) {
      showToast("La reconnaissance vocale n'est pas supportée par ton navigateur.", "error");
      return;
    }

    if (isRecording) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.error("Stop error:", e);
      }
      setIsRecording(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsRecording(true);
      } catch (e) {
        console.error("Start error:", e);
        showToast("Impossible de démarrer le micro. Vérifie les autorisations.", "error");
        setIsRecording(false);
      }
    }
  };

  const stopSpeaking = () => {
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch (e) {}
      currentSourceRef.current = null;
    }
    setIsSpeaking(false);
  };

  const playCoachResponse = async (text: string, force: boolean = false) => {
    if (!profile.voiceEnabled && !force) return;
    
    if (isSpeaking) {
      stopSpeaking();
      return;
    }

    try {
      const ctx = initAudioContext();
      setIsSpeaking(true);
      
      const base64Audio = await generateSpeech(text, profile.coachGender);
      if (base64Audio) {
        const binaryString = window.atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        // Convert PCM16 to Float32
        const pcm16 = new Int16Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 2));
        const float32 = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) {
          float32[i] = pcm16[i] / 32768;
        }

        const buffer = ctx.createBuffer(1, float32.length, 24000);
        buffer.getChannelData(0).set(float32);

        stopSpeaking(); // Stop any current audio

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => {
          if (currentSourceRef.current === source) {
            setIsSpeaking(false);
            currentSourceRef.current = null;
          }
        };
        currentSourceRef.current = source;
        source.start();
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

  // --- Strava Calculations ---
  const calculateMetrics = (activities: any[]) => {
    if (!activities || activities.length === 0) return { ctl: 0, atl: 0, tsb: 0 };

    // Simple TSS estimation: (duration in min) * intensity
    // Run: 1.0, Bike: 0.8, Swim: 1.2, Strength: 0.5
    const getTss = (activity: any) => {
      const durationMin = activity.moving_time / 60;
      let multiplier = 0.8; // default bike
      if (activity.type === 'Run') multiplier = 1.0;
      if (activity.type === 'Swim') multiplier = 1.2;
      if (activity.type === 'WeightTraining') multiplier = 0.5;
      
      // Adjust by relative effort if available
      const effort = activity.suffer_score || 50;
      const intensityFactor = effort / 50; // 50 is "moderate"
      
      return durationMin * multiplier * intensityFactor;
    };

    const now = new Date();
    const dayTss: Record<string, number> = {};
    
    // Aggregate TSS by day for the last 90 days
    activities.forEach(activity => {
      const dateStr = format(parseISO(activity.start_date), 'yyyy-MM-dd');
      const tss = getTss(activity);
      dayTss[dateStr] = (dayTss[dateStr] || 0) + tss;
    });

    // CTL: 42-day rolling average
    // ATL: 7-day rolling average
    let ctl = 0;
    let atl = 0;
    
    for (let i = 0; i < 42; i++) {
      const d = format(addDays(now, -i), 'yyyy-MM-dd');
      ctl += (dayTss[d] || 0);
    }
    ctl = Math.round(ctl / 42);

    for (let i = 0; i < 7; i++) {
      const d = format(addDays(now, -i), 'yyyy-MM-dd');
      atl += (dayTss[d] || 0);
    }
    atl = Math.round(atl / 7);

    const tsb = ctl - atl;
    return { ctl, atl, tsb };
  };

  const metrics = calculateMetrics(stravaActivities);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchStravaActivities = async () => {
    if (!user || !profile.stravaConnected) return;
    try {
      const response = await fetch(`/api/strava/activities?uid=${user.uid}`);
      if (response.ok) {
        const data = await response.json();
        setStravaActivities(data);
      }
    } catch (error) {
      console.error("Failed to fetch Strava activities:", error);
    }
  };

  const [trainingDataView, setTrainingDataView] = useState<'week' | 'month'>('week');

  const getWeeklyTrainingData = () => {
    const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const startOfThisWeek = startOfWeek(new Date(), { weekStartsOn: 1 });
    
    return days.map((day, idx) => {
      const date = addDays(startOfThisWeek, idx);
      const dateStr = format(date, 'yyyy-MM-dd');
      
      // Planned TSS from workouts
      const plannedWorkout = workouts.find(w => format(parseISO(w.date), 'yyyy-MM-dd') === dateStr);
      const plannedTss = plannedWorkout?.tss || 0;
      
      // Real TSS from Strava
      // Strava activities duration is in seconds. We can estimate TSS or just use duration/60
      const dayActivities = stravaActivities.filter(a => format(parseISO(a.start_date), 'yyyy-MM-dd') === dateStr);
      const realDuration = dayActivities.reduce((acc, curr) => acc + curr.moving_time, 0) / 60;
      
      // Simple TSS estimation if not provided: (duration * intensity_factor)
      // For now let's just use duration as a proxy if TSS isn't there, or just show duration vs duration
      // But the user asked for TSS. Let's try to estimate it or just use duration if preferred.
      // The user said "volume of the week? compared to Strava? I want it to be compared to strava + daily objective compared to the plan so bars would be more judicious."
      
      return {
        day,
        real: Math.round(realDuration), // Using duration in minutes as volume
        planned: plannedWorkout?.durationMinutes || 0,
        fullDay: format(date, 'EEEE d MMMM', { locale: fr })
      };
    });
  };

  const getMonthlyTrainingData = () => {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const date = addDays(now, -i * 30);
      const monthLabel = format(date, 'MMM', { locale: fr });
      const monthStart = startOfDay(addDays(now, -i * 30 - 30));
      const monthEnd = startOfDay(addDays(now, -i * 30));
      
      const monthActivities = stravaActivities.filter(a => {
        const d = parseISO(a.start_date);
        return d >= monthStart && d <= monthEnd;
      });
      const realDuration = monthActivities.reduce((acc, curr) => acc + curr.moving_time, 0) / 60;
      
      const monthWorkouts = workouts.filter(w => {
        const d = parseISO(w.date);
        return d >= monthStart && d <= monthEnd;
      });
      const plannedDuration = monthWorkouts.reduce((acc, curr) => acc + curr.durationMinutes, 0);

      months.push({
        day: monthLabel,
        real: Math.round(realDuration / 60), // Hours for monthly
        planned: Math.round(plannedDuration / 60),
        fullDay: format(date, 'MMMM yyyy', { locale: fr })
      });
    }
    return months;
  };

  const weeklyData = getWeeklyTrainingData();
  const monthlyData = getMonthlyTrainingData();
  const trainingData = trainingDataView === 'week' ? weeklyData : monthlyData;

  // Strava Activities Sync
  useEffect(() => {
    fetchStravaActivities();
  }, [user, profile.stravaConnected]);

  // Coach Daily Insight Generation
  useEffect(() => {
    if (!user || !profile.onboarded || coachInsight) return;

    const generateInsight = async () => {
      const todayWorkout = workouts.find(w => isSameDay(parseISO(w.date), new Date()));
      const lastActivity = stravaActivities[0];
      
      // Check if we already have a cached insight for today in Firestore
      const insightRef = doc(db, 'users', user.uid, 'insights', format(new Date(), 'yyyy-MM-dd'));
      const insightSnap = await getDoc(insightRef);
      
      if (insightSnap.exists()) {
        setCoachInsight(insightSnap.data().text);
      } else {
        const text = await generateDailyCoachInsight(profile, lastActivity, todayWorkout, workouts);
        setCoachInsight(text);
        // Cache it
        await setDoc(insightRef, { text, timestamp: Date.now() });
      }
    };

    if (stravaActivities.length > 0 || !profile.stravaConnected) {
      generateInsight();
    }
  }, [user, profile.onboarded, stravaActivities, workouts]);

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
        const data = docSnap.data() as AthleteProfile;
        // Ensure PRs and gender are initialized if missing from old profiles
        const updatedData = {
          ...data,
          gender: data.gender || 'Man',
          coachName: data.coachName || 'Coach Sub12',
          prs: data.prs || {
            vma: 15,
            ftp: 200,
            css: '1:50',
            maxHr: 190,
            restHr: 50
          }
        };
        setProfile(updatedData);
        if (!editingProfile) setEditingProfile(updatedData);
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, `users/${user.uid}`));
    return () => unsubscribe();
  }, [user, editingProfile]);

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
              uid: firebaseUser.uid,
              name: athlete.firstname + ' ' + athlete.lastname,
              targetRace: 'Marathon',
              raceDate: '2026-06-07',
              weeklyHoursGoal: 8,
              fitnessLevel: 'Intermediate',
              experience: '',
              goalMode: 'Finisher',
              onboarded: true,
              isPremium: false,
              progressionScore: 45,
              stravaConnected: true
            };
            
            // Save to Firestore using the new anonymous UID
            const path = `users/${firebaseUser.uid}`;
            try {
              await setDoc(doc(db, path), {
                ...initialProfile,
                stravaId: athlete.id,
                updatedAt: Date.now()
              });
              
              // Also save the Strava tokens to this new UID
              await setDoc(doc(db, path), {
                strava: event.data.stravaTokens
              }, { merge: true });
            } catch (error) {
              handleFirestoreError(error, OperationType.WRITE, path);
            }

          } catch (error) {
            console.error("Failed to sign in with Strava:", error);
          }
        } else {
          const updatedProfile = { ...profile, stravaConnected: true };
          setProfile(updatedProfile);
          setEditingProfile(updatedProfile);
          showToast("Strava connecté avec succès !");
          // Trigger immediate fetch
          setTimeout(fetchStravaActivities, 1000);
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
        uid: '',
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
        coachGender: 'Man',
        voiceEnabled: true,
        gender: 'Man',
        prs: {
          vma: 15,
          ftp: 200,
          css: '1:50',
          maxHr: 190,
          restHr: 50
        },
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

  const saveProfile = (newProfile: AthleteProfile) => {
    setEditingProfile(newProfile);
  };

  const handleOnboardingComplete = async () => {
    if (!user) return;
    const finalProfile = { ...profile, uid: user.uid, onboarded: true };
    const path = `users/${user.uid}`;
    try {
      await setDoc(doc(db, path), {
        ...finalProfile,
        updatedAt: Date.now()
      }, { merge: true });
      setProfile(finalProfile);
      setEditingProfile(finalProfile);
      handleGeneratePlan();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
      showToast("Erreur lors de la finalisation de l'onboarding", "error");
    }
  };

  const handleSaveProfile = async () => {
    if (!user || !editingProfile) return;
    const path = `users/${user.uid}`;
    try {
      await setDoc(doc(db, path), { ...editingProfile, uid: user.uid, updatedAt: Date.now() }, { merge: true });
      setProfile(editingProfile);
      showToast("Profil mis à jour avec succès !");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
      showToast("Erreur lors de la sauvegarde", "error");
    }
  };

  const handleGeneratePlan = async () => {
    if (!user) return;
    setIsGeneratingPlan(true);
    try {
      setIsGeneratingPlan(true);
      const newWorkouts = await generateTrainingPlan(profile, chatHistory);
      if (!newWorkouts || newWorkouts.length === 0) {
        showToast("Désolé, je n'ai pas pu générer de plan. Peux-tu réessayer ?", "error");
        return;
      }
      
      for (const workout of newWorkouts) {
        const path = `users/${user.uid}/workouts/${workout.id}`;
        try {
          await setDoc(doc(db, path), { 
            ...workout, 
            uid: user.uid,
            updatedAt: Date.now() 
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, path);
        }
      }
      
      setActiveTab('plan');
      showToast("Ton nouveau plan d'entraînement est prêt !");
    } catch (error) {
      console.error("Plan generation error:", error);
      showToast("Une erreur est survenue lors de la génération du plan.", "error");
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
      showToast(workout.completed ? "Séance marquée comme non terminée" : "Séance terminée !");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const handleAddWorkout = (date?: Date) => {
    const newWorkout: Workout = {
      id: Math.random().toString(36).substr(2, 9),
      title: 'Nouvelle séance',
      sport: 'Run',
      durationMinutes: 60,
      intensity: 'Moderate',
      completed: false,
      date: format(date || selectedDate, 'yyyy-MM-dd'),
      description: '',
      tss: 0
    };
    setEditingWorkout(newWorkout);
  };

  const deleteWorkout = async (id: string) => {
    if (!user) return;
    const path = `users/${user.uid}/workouts/${id}`;
    try {
      await deleteDoc(doc(db, path));
      setEditingWorkout(null);
      showToast("Séance supprimée");
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const saveWorkout = async (workout: Workout) => {
    if (!user) return;
    const path = `users/${user.uid}/workouts/${workout.id}`;
    try {
      await setDoc(doc(db, path), { 
        ...workout, 
        uid: user.uid,
        updatedAt: Date.now() 
      });
      setEditingWorkout(null);
      showToast("Séance enregistrée");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const [streamingText, setStreamingText] = useState("");

  async function handleSendMessage(content: string) {
    if (!content.trim() && !selectedImage) return;
    if (!user) return;
    
    const timestamp = Date.now();
    const userMsg: ChatMessage = { 
      uid: user.uid, 
      role: 'user', 
      content, 
      timestamp,
    };
    if (selectedImage) {
      userMsg.image = selectedImage;
    }
    const userMsgPath = `users/${user.uid}/messages/${timestamp}`;
    
    try {
      setIsLoading(true);
      setStreamingText("");
      await setDoc(doc(db, userMsgPath), userMsg);
      const currentImage = selectedImage;
      setSelectedImage(null); // Clear image after sending
      setActiveTab('coach');

      const { text, functionCalls } = await getCoachAdvice(
        content, 
        chatHistory, 
        profile, 
        workouts, 
        stravaActivities,
        (chunk) => setStreamingText(chunk),
        currentImage || undefined
      );
      
      if (functionCalls) {
        for (const call of functionCalls) {
          if (call.name === 'updateWorkouts') {
            const { newWorkouts } = call.args as { newWorkouts: Workout[] };
            for (const workout of newWorkouts) {
              await setDoc(doc(db, `users/${user.uid}/workouts/${workout.id}`), {
                ...workout,
                uid: user.uid,
                updatedAt: Date.now()
              });
            }
            // No need to write a system message to Firestore here, 
            // the model's text response will explain the changes.
          }
        }
      }

      if (text) {
        const modelMsg: ChatMessage = { 
          uid: user.uid,
          role: 'model', 
          content: text, 
          timestamp: Date.now() 
        };
        await setDoc(doc(db, `users/${user.uid}/messages/${Date.now() + 1}`), modelMsg);
        
        // Auto-play coach response
        playCoachResponse(text);
      }
    } catch (error) {
      console.error("Chat error:", error);
      // Show a temporary error message in the chat UI if possible, or just alert
      alert("Désolé, une erreur technique est survenue. Peux-tu réessayer dans un instant ?");
    } finally {
      setIsLoading(false);
      setStreamingText("");
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

  const daysToRace = differenceInDays(startOfDay(parseISO(profile.raceDate)), startOfDay(new Date()));

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-orange-600" size={32} />
      </div>
    );
  }

  if (!user) {
    return <LandingPage onLogin={handleLogin} onLoginStrava={handleLoginStrava} />;
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
            <svg viewBox="0 0 32 32" className="w-8 h-8" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M26 16h-4l-3 9-6-18-3 9h-4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          
          <div className="absolute top-4 right-4">
            <button 
              onClick={handleLogout}
              className="text-slate-400 hover:text-red-500 transition-colors p-2"
              title="Déconnexion"
            >
              <LogOut size={20} />
            </button>
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
              <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                {['5K', '10K', 'Semi-Marathon', 'Marathon', 'Trail', 'Hyrox', 'Triathlon S/M', 'Triathlon L/XXL', 'Autre'].map(race => (
                  <button 
                    key={race}
                    onClick={() => {
                      if (race === 'Autre') {
                        saveProfile({...profile, targetRace: ''});
                        setOnboardingStep(1.5); // Special step for custom input
                      } else {
                        saveProfile({...profile, targetRace: race});
                        setOnboardingStep(2);
                      }
                    }}
                    className="p-3 bg-slate-50 rounded-lg text-left font-semibold hover:bg-orange-50 hover:text-orange-600 transition-all border border-slate-200 hover:border-orange-200"
                  >
                    {race}
                  </button>
                ))}
              </div>
            </div>
          )}

          {onboardingStep === 1.5 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-center tracking-tight">Ton Objectif Perso</h2>
              <p className="text-slate-500 text-center text-xs">Ex: Courir 20km / semaine, Perte de poids...</p>
              <input 
                autoFocus
                placeholder="Décris ton objectif"
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-base font-medium focus:ring-2 focus:ring-orange-500 outline-none"
                value={profile.targetRace}
                onChange={(e) => saveProfile({...profile, targetRace: e.target.value})}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && profile.targetRace) {
                    setOnboardingStep(2);
                  }
                }}
              />
              <button 
                disabled={!profile.targetRace}
                onClick={() => setOnboardingStep(2)}
                className="w-full bg-orange-600 text-white py-3 rounded-lg font-bold text-base hover:bg-orange-700 transition-all shadow-sm disabled:opacity-50"
              >
                Suivant
              </button>
            </div>
          )}

          {onboardingStep === 2 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-center tracking-tight">Ton Coach Sub12</h2>
              <div className="space-y-4">
                <div>
                  <label className="mono-label text-slate-400 block mb-2">Genre du Coach</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => saveProfile({...profile, coachGender: 'Man'})}
                      className={cn("p-3 rounded-lg border text-sm font-bold transition-all", profile.coachGender === 'Man' ? "bg-orange-600 text-white border-orange-600" : "bg-slate-50 text-slate-600 border-slate-200")}
                    >
                      Homme
                    </button>
                    <button 
                      onClick={() => saveProfile({...profile, coachGender: 'Woman'})}
                      className={cn("p-3 rounded-lg border text-sm font-bold transition-all", profile.coachGender === 'Woman' ? "bg-orange-600 text-white border-orange-600" : "bg-slate-50 text-slate-600 border-slate-200")}
                    >
                      Femme
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <div>
                    <p className="font-bold text-sm">Synthèse Vocale</p>
                    <p className="text-[10px] text-slate-500">Le coach te parle après ses réponses.</p>
                  </div>
                  <button 
                    onClick={() => saveProfile({...profile, voiceEnabled: !profile.voiceEnabled})}
                    className={cn("w-12 h-6 rounded-full transition-all relative", profile.voiceEnabled ? "bg-orange-600" : "bg-slate-300")}
                  >
                    <div className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all", profile.voiceEnabled ? "right-1" : "left-1")} />
                  </button>
                </div>
              </div>
              <button 
                onClick={() => setOnboardingStep(3)}
                className="w-full bg-orange-600 text-white py-3 rounded-lg font-bold text-base hover:bg-orange-700 transition-all shadow-sm"
              >
                Suivant
              </button>
            </div>
          )}

          {onboardingStep === 3 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-center tracking-tight">Mode de Coaching ?</h2>
              <div className="grid grid-cols-1 gap-3">
                <button 
                  onClick={() => {
                    saveProfile({...profile, goalMode: 'Finisher'});
                    setOnboardingStep(4);
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
                    setOnboardingStep(4);
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

          {onboardingStep === 4 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-center tracking-tight">Profil Physique</h2>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="mono-label text-slate-400 block mb-2">Ton Genre</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => saveProfile({...profile, gender: 'Man'})}
                      className={cn("p-3 rounded-lg border text-sm font-bold transition-all", profile.gender === 'Man' ? "bg-orange-600 text-white border-orange-600" : "bg-slate-50 text-slate-600 border-slate-200")}
                    >
                      Homme
                    </button>
                    <button 
                      onClick={() => saveProfile({...profile, gender: 'Woman'})}
                      className={cn("p-3 rounded-lg border text-sm font-bold transition-all", profile.gender === 'Woman' ? "bg-orange-600 text-white border-orange-600" : "bg-slate-50 text-slate-600 border-slate-200")}
                    >
                      Femme
                    </button>
                  </div>
                </div>
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
                onClick={() => setOnboardingStep(5)}
                className="w-full bg-orange-600 text-white py-3 rounded-lg font-bold text-base hover:bg-orange-700 transition-all shadow-sm"
              >
                Suivant
              </button>
            </div>
          )}

          {onboardingStep === 5 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-center tracking-tight">C'est parti !</h2>
              <p className="text-slate-500 text-center text-sm">Sub12 prépare ton plan adaptatif...</p>
              <div className="flex justify-center py-6">
                <Loader2 className="animate-spin text-orange-600" size={32} />
              </div>
              <button 
                onClick={handleOnboardingComplete}
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
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-30 py-3 px-4">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <Logo className="w-10 h-10" />
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block border-r border-slate-100 pr-4">
              <p className="mono-label text-[10px] text-orange-600 font-bold uppercase tracking-wider">{profile.targetRace}</p>
              <p className="text-sm font-black font-mono text-slate-900">J-{daysToRace}</p>
            </div>
            <button 
              onClick={() => setActiveTab('profile')}
              className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center border border-slate-200 hover:bg-white hover:border-orange-500/30 hover:shadow-lg hover:shadow-orange-500/5 transition-all duration-300 group overflow-hidden"
            >
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User size={20} className="text-slate-600 group-hover:text-orange-600 transition-colors" />
              )}
            </button>
          </div>
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
              {/* Coach Quick Insight */}
              <div className="bg-slate-900 p-6 rounded-2xl shadow-xl overflow-hidden relative group border border-slate-800">
                <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
                  <MessageSquare size={80} className="text-orange-500" />
                </div>
                <div className="flex gap-5 items-start relative z-10">
                  <div className="space-y-2 flex-1">
                    <div className="flex justify-between items-center">
                      <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-500">{profile.coachName || "Coach Sub12"} Insight</h4>
                      <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Live Analysis</span>
                    </div>
                    <p className="text-sm font-medium leading-relaxed text-slate-200 italic">
                      {coachInsight || "Analyse de tes données en cours..."}
                    </p>
                    <button 
                      onClick={() => setActiveTab('coach')}
                      className="text-[10px] font-black uppercase tracking-widest text-orange-500 flex items-center gap-1 hover:text-orange-400 transition-colors pt-2"
                    >
                      Discuter avec le coach <ChevronRight size={12} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Today's Workout - More Prominent */}
              {(() => {
                const todayWorkout = workouts.find(w => isSameDay(parseISO(w.date), new Date()));
                if (!todayWorkout) return (
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm text-center">
                    <p className="mono-label text-slate-400 text-xs mb-2">Aujourd'hui</p>
                    <h3 className="text-lg font-bold text-slate-900">Jour de repos</h3>
                    <p className="text-slate-500 text-xs mt-1">La récupération est une séance à part entière.</p>
                  </div>
                );
                
                return (
                  <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm relative overflow-hidden group">
                    <div className="relative z-10">
                      <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-2">
                          <div className={cn("w-2 h-2 rounded-full animate-pulse", todayWorkout.completed ? "bg-green-500" : "bg-orange-500")} />
                          <p className="mono-label text-slate-400 text-[10px] font-black uppercase tracking-widest">Séance du jour</p>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                          {format(new Date(), 'EEEE d MMMM', { locale: fr })}
                        </span>
                      </div>
                      
                      <div className="flex justify-between items-start gap-4">
                        <div className="flex-1">
                          <h3 className="text-2xl font-black mb-2 tracking-tight leading-tight text-slate-900">{todayWorkout.title}</h3>
                          <p className="text-slate-500 text-xs line-clamp-2 mb-4 font-medium leading-relaxed">
                            {todayWorkout.description}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="flex items-center gap-1.5 bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-xl text-[10px] font-bold text-slate-600">
                              <Timer size={12} className="text-orange-500" /> {todayWorkout.durationMinutes}m
                            </span>
                            <span className="flex items-center gap-1.5 bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-xl text-[10px] font-bold text-slate-600">
                              <SportIcon sport={todayWorkout.sport} size={12} className="text-orange-500" />
                              {todayWorkout.sport}
                            </span>
                          </div>
                        </div>
                        <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center border border-slate-100 shadow-inner">
                          <SportIcon sport={todayWorkout.sport} size={32} className="text-orange-500" />
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3 mt-6">
                        <button 
                          onClick={() => setActiveTab('plan')}
                          className="bg-slate-50 text-slate-600 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-100 transition-all duration-300 flex items-center justify-center gap-2 border border-slate-200"
                        >
                          Détails
                        </button>
                        <button 
                          onClick={async () => {
                            if (!user) return;
                            const path = `users/${user.uid}/workouts/${todayWorkout.id}`;
                            try {
                              await setDoc(doc(db, path), { completed: !todayWorkout.completed }, { merge: true });
                              showToast(todayWorkout.completed ? "Séance marquée non terminée" : "Félicitations ! Séance terminée.");
                            } catch (error) {
                              handleFirestoreError(error, OperationType.UPDATE, path);
                            }
                          }}
                          className={cn(
                            "py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2 shadow-lg shadow-orange-500/10",
                            todayWorkout.completed 
                              ? "bg-green-500 text-white hover:bg-green-600" 
                              : "bg-orange-600 text-white hover:bg-orange-700"
                          )}
                        >
                          {todayWorkout.completed ? <><CheckCircle2 size={14} /> Terminée</> : "Marquer terminée"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-500 mb-2">
                    <Flame size={14} className="text-orange-500" />
                    <span className="mono-label">Charge (CTL)</span>
                  </div>
                  <p className="text-2xl font-bold font-mono">{metrics.ctl}</p>
                  <p className="text-[10px] text-green-600 font-bold flex items-center gap-0.5">
                    <TrendingUp size={10} /> +12%
                  </p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative group">
                  <div className="flex items-center gap-2 text-slate-500 mb-2">
                    <Timer size={14} className={cn(metrics.atl > 80 ? "text-red-500" : metrics.atl > 50 ? "text-orange-500" : "text-green-500")} />
                    <span className="mono-label">Fatigue (ATL)</span>
                    <div className="relative group/info">
                      <Info size={10} className="text-slate-300 cursor-help" />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-900 text-white text-[8px] rounded-lg opacity-0 group-hover/info:opacity-100 transition-opacity pointer-events-none z-50 leading-tight">
                        L'ATL (Acute Training Load) représente ta fatigue accumulée sur les 7 derniers jours.
                      </div>
                    </div>
                  </div>
                  <p className={cn(
                    "text-2xl font-bold font-mono",
                    metrics.atl > 80 ? "text-red-600" : metrics.atl > 50 ? "text-orange-600" : "text-green-600"
                  )}>{metrics.atl}</p>
                  <p className="text-[10px] text-slate-400 font-bold">Volume Hebdo: {(weeklyData.reduce((acc, d) => acc + d.real, 0) / 60).toFixed(1)}h</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative group">
                  <div className="flex items-center gap-2 text-slate-500 mb-2">
                    <Zap size={14} className={cn(metrics.tsb < -30 ? "text-red-500" : metrics.tsb < -10 ? "text-orange-500" : "text-green-500")} />
                    <span className="mono-label">Forme (TSB)</span>
                    <div className="relative group/info">
                      <Info size={10} className="text-slate-300 cursor-help" />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-900 text-white text-[8px] rounded-lg opacity-0 group-hover/info:opacity-100 transition-opacity pointer-events-none z-50 leading-tight">
                        Le TSB (Training Stress Balance) mesure ta fraîcheur. 
                        Un score négatif indique une fatigue accumulée. 
                        Calculé par la différence entre ta charge long terme (CTL) et court terme (ATL).
                      </div>
                    </div>
                  </div>
                  <p className={cn(
                    "text-2xl font-bold font-mono",
                    metrics.tsb < -30 ? "text-red-600" : metrics.tsb < -10 ? "text-orange-600" : "text-green-600"
                  )}>{metrics.tsb}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">
                    {metrics.tsb < -30 ? "Risque" : metrics.tsb < -10 ? "Fatigué" : "Optimal"}
                  </p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-500 mb-2">
                    <Calendar size={14} className="text-orange-500" />
                    <span className="mono-label">Countdown</span>
                  </div>
                  <p className="text-2xl font-bold font-mono">{daysToRace}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Jours restants</p>
                </div>
              </div>

              {/* Strava Dashboard Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <h3 className="font-black text-[11px] uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                    <Activity size={14} className="text-orange-500" />
                    Tableau de Bord Strava
                  </h3>
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex gap-2">
                      <select 
                        value={stravaFilter.period}
                        onChange={e => setStravaFilter({...stravaFilter, period: e.target.value as any})}
                        className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-[9px] font-bold outline-none focus:ring-1 focus:ring-orange-500"
                      >
                        <option value="week">Semaine</option>
                        <option value="month">Mois</option>
                        <option value="year">Année</option>
                        <option value="all">Tout</option>
                      </select>
                      <select 
                        value={stravaFilter.type}
                        onChange={e => setStravaFilter({...stravaFilter, type: e.target.value})}
                        className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-[9px] font-bold outline-none focus:ring-1 focus:ring-orange-500"
                      >
                        <option value="all">Tous sports</option>
                        <option value="Run">Course</option>
                        <option value="Ride">Vélo</option>
                        <option value="Swim">Natation</option>
                        <option value="Walk">Marche</option>
                        <option value="Hike">Rando</option>
                        <option value="WeightTraining">Renfo</option>
                      </select>
                    </div>
                    <p className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter px-1">
                      {(() => {
                        const now = new Date();
                        if (stravaFilter.period === 'all') return 'Toutes les activités';
                        let days = 7;
                        if (stravaFilter.period === 'month') days = 30;
                        if (stravaFilter.period === 'year') days = 365;
                        const start = subDays(now, days);
                        return `${format(start, 'd MMM', { locale: fr })} au ${format(now, 'd MMM', { locale: fr })}`;
                      })()}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* PRs Summary */}
                  <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-xl text-white">
                    <p className="mono-label text-slate-500 text-[9px] uppercase tracking-widest mb-4">Mes Records (PRs)</p>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Footprints size={14} className="text-orange-500" />
                          <span className="text-[10px] font-bold">VMA</span>
                        </div>
                        <span className="text-sm font-black font-mono">{profile.prs?.vma || '--'} km/h</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Bike size={14} className="text-orange-500" />
                          <span className="text-[10px] font-bold">FTP</span>
                        </div>
                        <span className="text-sm font-black font-mono">{profile.prs?.ftp || '--'} W</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Waves size={14} className="text-orange-500" />
                          <span className="text-[10px] font-bold">CSS</span>
                        </div>
                        <span className="text-sm font-black font-mono">{profile.prs?.css || '--'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Filtered Stats */}
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm md:col-span-2">
                    {(() => {
                      const filtered = stravaActivities.filter(a => {
                        const date = parseISO(a.start_date);
                        const now = new Date();
                        if (stravaFilter.period === 'week' && differenceInDays(now, date) > 7) return false;
                        if (stravaFilter.period === 'month' && differenceInDays(now, date) > 30) return false;
                        if (stravaFilter.period === 'year' && differenceInDays(now, date) > 365) return false;
                        if (stravaFilter.type !== 'all' && a.type !== stravaFilter.type) return false;
                        return true;
                      });
                      
                      const totalDist = filtered.reduce((acc, a) => acc + a.distance, 0) / 1000;
                      const totalElev = filtered.reduce((acc, a) => acc + a.total_elevation_gain, 0);
                      const totalTime = filtered.reduce((acc, a) => acc + a.moving_time, 0) / 3600;

                      return (
                        <div className="space-y-6">
                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <p className="text-[9px] mono-label text-slate-400 uppercase">Distance Totale</p>
                              <p className="text-lg font-black font-mono text-orange-600">{totalDist.toFixed(1)}km</p>
                            </div>
                            <div>
                              <p className="text-[9px] mono-label text-slate-400 uppercase">Dénivelé</p>
                              <p className="text-lg font-black font-mono text-slate-900">{totalElev.toLocaleString()}m</p>
                            </div>
                            <div>
                              <p className="text-[9px] mono-label text-slate-400 uppercase">Temps Total</p>
                              <p className="text-lg font-black font-mono text-slate-900">{totalTime.toFixed(1)}h</p>
                            </div>
                          </div>
                          
                          <div className="space-y-2 max-h-[150px] overflow-y-auto pr-2 custom-scrollbar">
                            {filtered.slice(0, 10).map((a, i) => (
                              <div key={i} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100 text-[10px]">
                                <div className="flex items-center gap-2">
                                  {a.type === 'Run' && <Footprints size={12} className="text-orange-500" />}
                                  {a.type === 'Ride' && <Bike size={12} className="text-orange-500" />}
                                  {a.type === 'Swim' && <Waves size={12} className="text-orange-500" />}
                                  {a.type === 'Walk' && <Footprints size={12} className="text-green-500" />}
                                  {a.type === 'Hike' && <TrendingUp size={12} className="text-green-600" />}
                                  {a.type === 'WeightTraining' && <Dumbbell size={12} className="text-slate-500" />}
                                  <span className="font-bold truncate max-w-[120px]">{a.name}</span>
                                </div>
                                <div className="flex gap-3 font-mono text-slate-500">
                                  <span>{(a.distance / 1000).toFixed(1)}km</span>
                                  <span>{format(parseISO(a.start_date), 'dd/MM/yy')}</span>
                                </div>
                              </div>
                            ))}
                            {filtered.length === 0 && (
                              <p className="text-center text-slate-400 py-4 text-[10px]">Aucune activité trouvée.</p>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>

                {/* Training Load Graph */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-sm flex items-center gap-2">
                      <TrendingUp size={16} className="text-orange-600" />
                      <span className="mono-label">Volume {trainingDataView === 'week' ? 'Hebdomadaire (min)' : 'Mensuel (h)'}</span>
                    </h3>
                    <div className="flex items-center gap-3">
                      <div className="flex bg-slate-100 p-0.5 rounded-lg mr-2">
                        <button 
                          onClick={() => setTrainingDataView('week')}
                          className={cn("px-2 py-1 text-[8px] font-bold rounded-md transition-all", trainingDataView === 'week' ? "bg-white text-orange-600 shadow-sm" : "text-slate-400")}
                        >
                          Semaine
                        </button>
                        <button 
                          onClick={() => setTrainingDataView('month')}
                          className={cn("px-2 py-1 text-[8px] font-bold rounded-md transition-all", trainingDataView === 'month' ? "bg-white text-orange-600 shadow-sm" : "text-slate-400")}
                        >
                          Mois
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-orange-500" />
                        <span className="text-[9px] font-bold text-slate-400 uppercase">Réel</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-slate-200" />
                        <span className="text-[9px] font-bold text-slate-400 uppercase">Prévu</span>
                      </div>
                    </div>
                  </div>
                  <div className="h-48 w-full min-h-[192px] min-w-0 overflow-hidden">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={50}>
                      <BarChart data={trainingData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="day" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{fontSize: 10, fontWeight: 600, fill: '#94a3b8', fontFamily: 'JetBrains Mono'}} 
                        />
                        <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8'}} />
                        <Tooltip 
                          cursor={{fill: '#f8fafc'}}
                          contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', fontFamily: 'JetBrains Mono', fontSize: '10px' }}
                          labelStyle={{ fontWeight: 800, color: '#ea580c' }}
                          formatter={(value: any) => [`${value} ${trainingDataView === 'week' ? 'min' : 'h'}`, '']}
                        />
                        <Bar dataKey="planned" fill="#e2e8f0" radius={[4, 4, 0, 0]} barSize={trainingDataView === 'week' ? 20 : 30} />
                        <Bar dataKey="real" fill="#ea580c" radius={[4, 4, 0, 0]} barSize={trainingDataView === 'week' ? 20 : 30} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* All Objectives Section */}
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
                  <Trophy size={16} className="text-orange-600" />
                  <span className="mono-label">Mes Objectifs</span>
                </h3>
                <div className="space-y-3">
                  {/* Main Objective */}
                  <div className="flex items-center justify-between p-3 bg-orange-50 rounded-xl border border-orange-100">
                    <div className="flex items-center gap-3">
                      <RaceLogo name={profile.targetRace} className="w-12 h-12" />
                      <div>
                        <p className="text-xs font-bold text-slate-900">{profile.targetRace}</p>
                        <p className="text-[10px] text-slate-400 font-medium">Objectif Principal • {profile.raceDate ? format(parseISO(profile.raceDate), 'd MMM yyyy', { locale: fr }) : 'Date non définie'}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black text-orange-600 uppercase tracking-wider">{profile.goalMode}</p>
                      <p className="text-[9px] text-slate-400 font-bold font-mono">
                        {profile.raceDate ? `J-${daysToRace}` : '-'}
                      </p>
                    </div>
                  </div>

                  {/* Secondary Objectives */}
                  {(profile.secondaryRaces || []).map((race, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex items-center gap-3">
                        <RaceLogo name={race.name} className="w-10 h-10" />
                        <div>
                          <p className="text-xs font-bold text-slate-900">{race.name}</p>
                          <p className="text-[10px] text-slate-400 font-medium">
                            {race.type === 'race' ? race.location : race.location} • {race.date ? format(parseISO(race.date), 'd MMM yyyy', { locale: fr }) : 'Date non définie'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-black text-orange-600 uppercase tracking-wider">{race.objective}</p>
                        <p className="text-[9px] text-slate-400 font-bold font-mono">
                          {race.date ? `J-${differenceInDays(startOfDay(parseISO(race.date)), startOfDay(new Date()))}` : '-'}
                        </p>
                      </div>
                    </div>
                  ))}
                  
                  {(profile.secondaryRaces || []).length === 0 && !profile.targetRace && (
                    <p className="text-[10px] text-slate-400 italic text-center py-2">Aucun objectif défini.</p>
                  )}
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
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => handleAddWorkout()}
                    className="bg-orange-600 text-white p-1.5 rounded-lg hover:bg-orange-700 transition-all shadow-sm"
                    title="Ajouter une séance"
                  >
                    <Plus size={16} />
                  </button>
                  <button 
                    onClick={handleGeneratePlan}
                    disabled={isGeneratingPlan}
                    className="bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-slate-800 transition-all disabled:opacity-50"
                  >
                    {isGeneratingPlan ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
                    Générer
                  </button>
                </div>
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
                      {[...workouts].sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime()).map((workout, idx) => (
                        <motion.div 
                          key={workout.id}
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.03 }}
                          className={cn(
                            "p-3 rounded-lg border shadow-sm flex items-center gap-3 transition-all",
                            workout.sport === 'Rest' 
                              ? "bg-slate-50 border-slate-100 border-dashed" 
                              : "bg-white border-slate-200",
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
                        <div className="flex flex-col gap-1">
                          <button 
                            onClick={() => setEditingWorkout(workout)}
                            className="text-slate-300 hover:text-orange-600 transition-colors p-1"
                            title="Modifier"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button 
                            onClick={() => deleteWorkout(workout.id)}
                            className="text-slate-300 hover:text-red-500 transition-colors p-1"
                            title="Supprimer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
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
                      {(() => {
                        const startOfThisWeek = startOfWeek(new Date(), { weekStartsOn: 1 });
                        return Array.from({ length: 14 }).map((_, i) => {
                          const date = addDays(startOfThisWeek, i);
                          const dayWorkouts = workouts.filter(w => isSameDay(parseISO(w.date), date));
                          const isSelected = isSameDay(date, selectedDate);
                          const isToday = isSameDay(date, new Date());
                          
                          return (
                            <button 
                              key={i} 
                              onClick={() => setSelectedDate(date)}
                              className={cn(
                                "aspect-square border rounded-md p-1 flex flex-col gap-1 overflow-hidden transition-all relative",
                                isSelected ? "border-orange-500 bg-orange-50 ring-1 ring-orange-500" : "border-slate-100 hover:border-slate-200",
                                isToday && !isSelected && "border-orange-200 bg-orange-50/30"
                              )}
                            >
                              <span className={cn(
                                "text-[8px] font-mono",
                                isSelected ? "text-orange-600 font-bold" : isToday ? "text-orange-500 font-bold" : "text-slate-300"
                              )}>{format(date, 'd')}</span>
                              <div className="flex flex-wrap gap-1 mt-auto">
                                {dayWorkouts.map(w => (
                                  <div key={w.id} className="relative group/icon">
                                    <SportIcon 
                                      sport={w.sport} 
                                      size={14} 
                                      className={cn(w.completed ? "text-green-500" : "text-orange-500")} 
                                    />
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/icon:block bg-slate-900 text-white text-[6px] px-1 py-0.5 rounded whitespace-nowrap z-50">
                                      {w.title}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </button>
                          );
                        });
                      })()}
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
                              "p-3 rounded-lg border shadow-sm flex items-center gap-3 transition-all",
                              workout.sport === 'Rest' 
                                ? "bg-slate-50 border-slate-100 border-dashed" 
                                : "bg-white border-slate-200",
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
                                <SportIcon sport={workout.sport} className="text-orange-600" size={12} />
                              </div>
                              <h4 className="font-bold text-sm text-slate-900">{workout.title}</h4>
                            </div>

                            <div className="text-right flex items-center gap-3">
                              <div className="flex items-center justify-end gap-1 text-slate-900 font-bold font-mono text-xs">
                                <span>{workout.durationMinutes}m</span>
                              </div>
                              <div className="flex flex-col gap-1">
                                <button 
                                  onClick={() => setEditingWorkout(workout)}
                                  className="text-slate-300 hover:text-orange-600 transition-colors p-1"
                                  title="Modifier"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button 
                                  onClick={() => deleteWorkout(workout.id)}
                                  className="text-slate-300 hover:text-red-500 transition-colors p-1"
                                  title="Supprimer"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      {workouts.filter(w => isSameDay(parseISO(w.date), selectedDate)).length === 0 && (
                        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-6 text-center">
                          <p className="text-xs text-slate-400 font-medium">Repos ou aucune séance prévue</p>
                          <button 
                            onClick={() => handleAddWorkout(selectedDate)}
                            className="mt-3 text-orange-600 text-[10px] font-bold hover:underline"
                          >
                            + Ajouter une séance
                          </button>
                        </div>
                      )}
                      {workouts.filter(w => isSameDay(parseISO(w.date), selectedDate)).length > 0 && (
                        <button 
                          onClick={() => handleAddWorkout(selectedDate)}
                          className="w-full py-3 border border-dashed border-slate-200 rounded-lg text-slate-400 text-[10px] font-bold hover:bg-slate-50 transition-colors"
                        >
                          + Ajouter une séance
                        </button>
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
                  <svg viewBox="0 0 32 32" className="w-6 h-6" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M26 16h-4l-3 9-6-18-3 9h-4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">{profile.coachName || "Coach AI"}</h3>
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
                      "p-3 rounded-lg text-xs leading-relaxed group relative shadow-sm",
                      msg.role === 'user' 
                        ? "bg-slate-900 text-white rounded-tr-none border border-slate-800" 
                        : "bg-slate-100 text-slate-800 rounded-tl-none border border-slate-200"
                    )}>
                      <div className={cn(
                        "prose prose-sm max-w-none",
                        msg.role === 'user' ? "prose-invert text-white" : "prose-slate"
                      )}>
                        <ReactMarkdown>
                          {msg.content}
                        </ReactMarkdown>
                        {msg.image && (
                          <img 
                            src={msg.image} 
                            alt="Attached" 
                            className="mt-2 rounded-lg max-w-full h-auto border border-white/20 shadow-sm" 
                            referrerPolicy="no-referrer"
                          />
                        )}
                      </div>
                      {msg.role === 'model' && (
                        <button 
                          onClick={() => playCoachResponse(msg.content, true)}
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
                {streamingText && (
                  <div className="flex flex-col max-w-[90%] mr-auto items-start">
                    <div className="p-3 rounded-lg text-xs leading-relaxed bg-slate-100 text-slate-800 rounded-tl-none border border-slate-200 shadow-sm">
                      <div className="prose prose-sm max-w-none prose-slate">
                        <ReactMarkdown>
                          {streamingText}
                        </ReactMarkdown>
                      </div>
                    </div>
                    <span className="mono-label text-slate-400 mt-1">
                      Coach • En train d'écrire...
                    </span>
                  </div>
                )}
                {isLoading && !streamingText && (
                  <div className="flex items-center gap-2 text-slate-400">
                    <Loader2 size={12} className="animate-spin" />
                    <span className="mono-label">Analyse en cours...</span>
                  </div>
                )}
              </div>

              {/* Chat Input */}
              <div className="p-3 border-t border-slate-100 bg-white">
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendMessage(messageInput);
                    setMessageInput('');
                  }}
                  className="flex gap-2 items-end"
                >
                  <div className="flex-1 flex flex-col gap-2">
                    {selectedImage && (
                      <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-slate-200 shadow-sm group">
                        <img src={selectedImage} alt="Preview" className="w-full h-full object-cover" />
                        <button 
                          type="button"
                          onClick={() => setSelectedImage(null)}
                          className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )}
                    <input 
                      name="message"
                      autoComplete="off"
                      placeholder="Message au coach..."
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 outline-none transition-all shadow-inner"
                    />
                  </div>
                  
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    ref={fileInputRef}
                    onChange={handleImageUpload}
                  />
                  
                  <div className="flex gap-1.5">
                    <button 
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-11 h-11 rounded-xl flex items-center justify-center bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all border border-slate-200"
                      title="Ajouter une image"
                    >
                      <Camera size={18} />
                    </button>
                    
                    <button 
                      type="button"
                      onClick={toggleRecording}
                      className={cn(
                        "w-11 h-11 rounded-xl flex items-center justify-center transition-all border",
                        isRecording 
                          ? "bg-red-500 text-white border-red-600 animate-pulse shadow-lg shadow-red-500/20" 
                          : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
                      )}
                    >
                      {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
                    </button>
                    
                    <button 
                      type="submit"
                      disabled={isLoading}
                      className="bg-orange-600 text-white w-11 h-11 rounded-xl flex items-center justify-center hover:bg-orange-700 transition-all shadow-lg shadow-orange-600/20 disabled:opacity-50 disabled:shadow-none"
                    >
                      {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          )}

          {activeTab === 'profile' && editingProfile && (
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
                        {editingProfile.avatarUrl ? (
                          <img src={editingProfile.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
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
                  <div className="absolute top-4 right-4">
                    <button 
                      onClick={handleSaveProfile}
                      className="bg-orange-600 text-white px-4 py-2 rounded-lg font-bold text-xs hover:bg-orange-700 transition-all shadow-lg flex items-center gap-2"
                    >
                      <CheckCircle2 size={14} /> Enregistrer
                    </button>
                  </div>
                </div>
                <div className="pt-12 pb-5 px-6">
                  <h2 className="text-xl font-bold tracking-tight">{editingProfile.name || 'Athlète'}</h2>
                  <p className="mono-label text-slate-400 mt-1">{editingProfile.fitnessLevel} • {editingProfile.goalMode}</p>
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
                    <p className="text-xs font-bold text-slate-900 truncate">{user?.email}</p>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="font-bold text-sm flex items-center gap-2">
                    <Activity size={16} className="text-orange-600" />
                    <span className="mono-label">Coach</span>
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="mono-label text-[10px] text-slate-400 block mb-1">Nom de ton Coach</label>
                      <input 
                        value={editingProfile.coachName || ''}
                        onChange={e => setEditingProfile({...editingProfile, coachName: e.target.value})}
                        placeholder="Ex: Coach Sub12"
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold focus:ring-1 focus:ring-orange-500 outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="font-bold text-sm flex items-center gap-2">
                    <Trophy size={16} className="text-orange-600" />
                    <span className="mono-label">Objectif Principal</span>
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="mono-label text-slate-400 block mb-1">Objectif cible</label>
                      <input 
                        list="race-suggestions"
                        value={editingProfile.targetRace}
                        onChange={e => saveProfile({...editingProfile, targetRace: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                        placeholder="Ex: Marathon, Hyrox, Trail..."
                      />
                      <datalist id="race-suggestions">
                        <option value="5K" />
                        <option value="10K" />
                        <option value="Semi-Marathon" />
                        <option value="Marathon" />
                        <option value="Trail" />
                        <option value="Hyrox" />
                        <option value="Triathlon S/M" />
                        <option value="Triathlon L/XXL" />
                      </datalist>
                    </div>
                    <div>
                      <label className="mono-label text-slate-400 block mb-1">Date</label>
                      <input 
                        type="date"
                        value={editingProfile.raceDate}
                        onChange={e => saveProfile({...editingProfile, raceDate: e.target.value})}
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
                  <div className="space-y-4">
                    <div>
                      <label className="mono-label text-slate-400 block mb-2">Ton Genre</label>
                      <div className="grid grid-cols-2 gap-3">
                        <button 
                          onClick={() => saveProfile({...editingProfile, gender: 'Man'})}
                          className={cn("p-2 rounded-lg border text-xs font-bold transition-all", editingProfile.gender === 'Man' ? "bg-orange-600 text-white border-orange-600" : "bg-slate-50 text-slate-600 border-slate-200")}
                        >
                          Homme
                        </button>
                        <button 
                          onClick={() => saveProfile({...editingProfile, gender: 'Woman'})}
                          className={cn("p-2 rounded-lg border text-xs font-bold transition-all", editingProfile.gender === 'Woman' ? "bg-orange-600 text-white border-orange-600" : "bg-slate-50 text-slate-600 border-slate-200")}
                        >
                          Femme
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mono-label text-slate-400 block mb-1">Âge</label>
                        <input 
                          type="number"
                          value={editingProfile.age}
                          onChange={e => saveProfile({...editingProfile, age: parseInt(e.target.value)})}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="mono-label text-slate-400 block mb-1">Poids (kg)</label>
                        <input 
                          type="number"
                          value={editingProfile.weight}
                          onChange={e => saveProfile({...editingProfile, weight: parseInt(e.target.value)})}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="mono-label text-slate-400 block mb-1">Taille (cm)</label>
                        <input 
                          type="number"
                          value={editingProfile.height}
                          onChange={e => saveProfile({...editingProfile, height: parseInt(e.target.value)})}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="mono-label text-slate-400 block mb-1">Profession</label>
                        <input 
                          value={editingProfile.profession}
                          onChange={e => saveProfile({...editingProfile, profession: e.target.value})}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="font-bold text-sm flex items-center gap-2">
                    <Zap size={16} className="text-orange-600" />
                    <span className="mono-label">Records Personnels (PRs)</span>
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mono-label text-slate-400 block mb-1">VMA (km/h)</label>
                      <input 
                        type="number"
                        step="0.1"
                        value={editingProfile.prs?.vma}
                        onChange={e => saveProfile({...editingProfile, prs: {...(editingProfile.prs || {}), vma: parseFloat(e.target.value)}})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="mono-label text-slate-400 block mb-1">FTP (Watts)</label>
                      <input 
                        type="number"
                        value={editingProfile.prs?.ftp}
                        onChange={e => saveProfile({...editingProfile, prs: {...(editingProfile.prs || {}), ftp: parseInt(e.target.value)}})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="mono-label text-slate-400 block mb-1">CSS (min/100m)</label>
                      <input 
                        placeholder="1:45"
                        value={editingProfile.prs?.css}
                        onChange={e => saveProfile({...editingProfile, prs: {...(editingProfile.prs || {}), css: e.target.value}})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="mono-label text-slate-400 block mb-1">FC Max</label>
                      <input 
                        type="number"
                        value={editingProfile.prs?.maxHr}
                        onChange={e => saveProfile({...editingProfile, prs: {...(editingProfile.prs || {}), maxHr: parseInt(e.target.value)}})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                      />
                    </div>
                  </div>
                </div>


                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="font-bold text-sm flex items-center gap-2">
                    <MessageSquare size={16} className="text-orange-600" />
                    <span className="mono-label">Paramètres Coach</span>
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="mono-label text-slate-400 block mb-2">Genre du Coach</label>
                      <div className="grid grid-cols-2 gap-3">
                        <button 
                          onClick={() => saveProfile({...editingProfile, coachGender: 'Man'})}
                          className={cn("p-2 rounded-lg border text-xs font-bold transition-all", editingProfile.coachGender === 'Man' ? "bg-orange-600 text-white border-orange-600" : "bg-slate-50 text-slate-600 border-slate-200")}
                        >
                          Homme
                        </button>
                        <button 
                          onClick={() => saveProfile({...editingProfile, coachGender: 'Woman'})}
                          className={cn("p-2 rounded-lg border text-xs font-bold transition-all", editingProfile.coachGender === 'Woman' ? "bg-orange-600 text-white border-orange-600" : "bg-slate-50 text-slate-600 border-slate-200")}
                        >
                          Femme
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                      <div>
                        <p className="font-bold text-xs">Synthèse Vocale</p>
                        <p className="text-[9px] text-slate-500">Le coach parle après ses réponses.</p>
                      </div>
                      <button 
                        onClick={() => saveProfile({...editingProfile, voiceEnabled: !editingProfile.voiceEnabled})}
                        className={cn("w-10 h-5 rounded-full transition-all relative", editingProfile.voiceEnabled ? "bg-orange-600" : "bg-slate-300")}
                      >
                        <div className={cn("absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all", editingProfile.voiceEnabled ? "right-0.5" : "left-0.5")} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="font-bold text-sm flex items-center gap-2">
                    <Activity size={16} className="text-orange-600" />
                    <span className="mono-label">Intégrations</span>
                  </h3>
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center",
                        editingProfile.stravaConnected ? "bg-orange-100 text-orange-600" : "bg-slate-200 text-slate-400"
                      )}>
                        <Activity size={20} />
                      </div>
                      <div>
                        <p className="text-xs font-bold">Strava</p>
                        <p className="text-[10px] text-slate-400">
                          {editingProfile.stravaConnected ? "Connecté" : "Non connecté"}
                        </p>
                      </div>
                    </div>
                    {editingProfile.stravaConnected ? (
                      <button 
                        onClick={() => saveProfile({...editingProfile, stravaConnected: false, stravaId: undefined})}
                        className="text-[10px] font-bold text-red-500 bg-red-50 px-3 py-1.5 rounded-lg border border-red-100 hover:bg-red-100 transition-colors"
                      >
                        Déconnecter
                      </button>
                    ) : (
                      <button 
                        onClick={handleConnectStrava}
                        className="text-[10px] font-bold text-white bg-[#FC4C02] px-3 py-1.5 rounded-lg hover:bg-[#E34402] transition-colors"
                      >
                        Connecter
                      </button>
                    )}
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
                        value={editingProfile.weeklyHoursGoal}
                        onChange={e => saveProfile({...editingProfile, weeklyHoursGoal: parseInt(e.target.value)})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="mono-label text-slate-400 block mb-1">Niveau</label>
                      <select 
                        value={editingProfile.fitnessLevel}
                        onChange={e => saveProfile({...editingProfile, fitnessLevel: e.target.value as any})}
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
                      <span className="mono-label">Objectifs Intermédiaires</span>
                    </h3>
                    <button 
                      onClick={() => saveProfile({...editingProfile, secondaryRaces: [...(editingProfile.secondaryRaces || []), { name: 'Nouvel objectif', location: '', date: '', objective: '', type: 'race' }]})}
                      className="text-orange-600 hover:bg-orange-50 p-1 rounded-md transition-colors"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <div className="space-y-3">
                    {(editingProfile.secondaryRaces || []).map((race, idx) => (
                      <div key={idx} className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                        <div className="flex gap-2">
                          <select
                            value={race.type || 'race'}
                            onChange={e => {
                              const newRaces = [...(editingProfile.secondaryRaces || [])];
                              newRaces[idx] = { ...race, type: e.target.value as any };
                              saveProfile({...editingProfile, secondaryRaces: newRaces});
                            }}
                            className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold focus:ring-1 focus:ring-orange-500 outline-none"
                          >
                            <option value="race">Course</option>
                            <option value="volume">Volume</option>
                            <option value="other">Autre</option>
                          </select>
                          <input 
                            placeholder="Nom de l'objectif"
                            value={race.name}
                            onChange={e => {
                              const newRaces = [...(editingProfile.secondaryRaces || [])];
                              newRaces[idx] = { ...race, name: e.target.value };
                              saveProfile({...editingProfile, secondaryRaces: newRaces});
                            }}
                            className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold focus:ring-1 focus:ring-orange-500 outline-none"
                          />
                          <button 
                            onClick={() => {
                              const newRaces = (editingProfile.secondaryRaces || []).filter((_, i) => i !== idx);
                              saveProfile({...editingProfile, secondaryRaces: newRaces});
                            }}
                            className="text-slate-300 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {race.type === 'race' ? (
                            <input 
                              placeholder="Lieu"
                              value={race.location}
                              onChange={e => {
                                const newRaces = [...(editingProfile.secondaryRaces || [])];
                                newRaces[idx] = { ...race, location: e.target.value };
                                saveProfile({...editingProfile, secondaryRaces: newRaces});
                              }}
                              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-[10px] font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                            />
                          ) : (
                            <input 
                              placeholder="Période (ex: Hebdo)"
                              value={race.location}
                              onChange={e => {
                                const newRaces = [...(editingProfile.secondaryRaces || [])];
                                newRaces[idx] = { ...race, location: e.target.value };
                                saveProfile({...editingProfile, secondaryRaces: newRaces});
                              }}
                              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-[10px] font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                            />
                          )}
                          <input 
                            type="date"
                            value={race.date}
                            onChange={e => {
                              const newRaces = [...(editingProfile.secondaryRaces || [])];
                              newRaces[idx] = { ...race, date: e.target.value };
                              saveProfile({...editingProfile, secondaryRaces: newRaces});
                            }}
                            className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-[10px] font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                          />
                        </div>
                        <input 
                          placeholder={race.type === 'volume' ? "Objectif (ex: 10h, 50km...)" : "Objectif (ex: Finisher, Sub 4h...)"}
                          value={race.objective}
                          onChange={e => {
                            const newRaces = [...(editingProfile.secondaryRaces || [])];
                            newRaces[idx] = { ...race, objective: e.target.value };
                            saveProfile({...editingProfile, secondaryRaces: newRaces});
                          }}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-[10px] font-medium focus:ring-1 focus:ring-orange-500 outline-none"
                        />
                      </div>
                    ))}
                    {(editingProfile.secondaryRaces || []).length === 0 && (
                      <p className="text-[10px] text-slate-400 italic">Aucun objectif défini.</p>
                    )}
                  </div>
                </div>

              </div>

              <div className="flex justify-center pt-8 pb-12">
                <button 
                  onClick={handleSaveProfile}
                  className="w-full max-w-xs bg-orange-600 text-white py-4 rounded-2xl font-black text-sm hover:bg-orange-700 transition-all shadow-xl shadow-orange-600/20 flex items-center justify-center gap-3"
                >
                  <CheckCircle2 size={20} /> Enregistrer les modifications
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2 w-full sm:max-w-4xl px-0 sm:px-4 z-40">
        <div className="bg-white/90 backdrop-blur-2xl border-t sm:border border-slate-200/50 px-8 py-3 sm:rounded-3xl shadow-[0_-10px_30px_rgba(0,0,0,0.05)] sm:shadow-[0_20px_50px_rgba(0,0,0,0.15)] flex justify-between items-center">
          <NavButton 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')} 
            icon={<LayoutGrid size={22} />} 
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
                <div className="flex justify-between items-center pt-2">
                  <button 
                    onClick={() => deleteWorkout(editingWorkout.id)}
                    className="text-red-500 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors text-xs font-bold flex items-center gap-2"
                  >
                    <Trash2 size={14} /> Supprimer
                  </button>
                  <button 
                    onClick={() => saveWorkout(editingWorkout)}
                    className="bg-orange-600 text-white px-6 py-2 rounded-lg font-bold text-sm hover:bg-orange-700 transition-all shadow-lg shadow-orange-600/20"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50"
          >
            <div className={cn(
              "px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border backdrop-blur-xl",
              toast.type === 'success' ? "bg-green-500/90 text-white border-green-400" : "bg-red-500/90 text-white border-red-400"
            )}>
              {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
              <span className="text-sm font-bold tracking-tight">{toast.message}</span>
            </div>
          </motion.div>
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
