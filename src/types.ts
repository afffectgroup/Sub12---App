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
}

export interface AthleteProfile {
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
  secondaryRaces?: string[];
  avatarUrl?: string;
  stravaConnected?: boolean;
  stravaId?: number;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}
