import { createContext, useContext } from 'react';
import type { ActiveTimer } from '../types/cook';

export interface TimerContextType {
  timers: ActiveTimer[];
  addTimer: (name: string, durationSeconds: number, recipeId?: string, stepNumber?: number) => string;
  startTimer: (id: string) => void;
  pauseTimer: (id: string) => void;
  resetTimer: (id: string) => void;
  addTime: (id: string, extraSeconds: number) => void;
  removeTimer: (id: string) => void;
  activeCount: number;
}

export const TimerContext = createContext<TimerContextType | undefined>(undefined);

export function useTimers(): TimerContextType {
  const context = useContext(TimerContext);
  if (!context) {
    throw new Error('useTimers must be used within a TimerProvider');
  }
  return context;
}
