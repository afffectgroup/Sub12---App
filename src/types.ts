export type Sport = 'Swim' | 'Bike' | 'Run' | 'Strength' | 'Rest';

export interface Workout {
  id: string;
  date: string;
  sport: Sport;
  title: string;
  description: string;
  durationMinutes: number;
  intensity: 'Low' | 'Moderate' | 'High' | 'Intervals';
  completed: boolean;
  tss?: number;
}

export interface SecondaryRace {
  name: string;
  location: string;
  date: string;
  objective: string;
  type?: 'race' | 'volume' | 'other';
}

export interface AthleteProfile {
  uid: string;
  name: string;
  targetRace: string;
  raceDate: string;
  weeklyHoursGoal: number;
  fitnessLevel: 'Beginner' | 'Intermediate' | 'Advanced';
  experience: string;
  goalMode: 'Finisher' | 'Chrono';
  onboarded: boolean;
  isPremium: boolean;
  progressionScore: number;
  weight?: number;
  height?: number;
  age?: number;
  profession?: string;
  secondaryRaces?: SecondaryRace[];
  avatarUrl?: string;
  stravaConnected?: boolean;
  stravaId?: number;
  strava?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    athleteId: number;
    connectedAt: number;
  };
}

export interface ChatMessage {
  uid: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}
