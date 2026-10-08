import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ActiveTimer } from '../types/cook';

interface TimerContextType {
  timers: ActiveTimer[];
  addTimer: (name: string, durationSeconds: number, recipeId?: string, stepNumber?: number) => string;
  startTimer: (id: string) => void;
  pauseTimer: (id: string) => void;
  resetTimer: (id: string) => void;
  addTime: (id: string, extraSeconds: number) => void;
  removeTimer: (id: string) => void;
  activeCount: number;
}

const TimerContext = createContext<TimerContextType | undefined>(undefined);

// Kitchen chime synthesizer using Web Audio API
function playTimerChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;
    // Ascending melody chime (D5, F#5, A5)
    const notes = [587.33, 739.99, 880.0];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.16);
      gain.gain.setValueAtTime(0.25, now + idx * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.16 + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.16);
      osc.stop(now + idx * 0.16 + 0.45);
    });
  } catch {
    // Audio context may be restricted before user interaction
  }
}

// Android & Web notification trigger
async function notifyTimerFinished(timer: ActiveTimer) {
  const title = 'Timer abgelaufen! ⏱️';
  const body = `${timer.name || 'Rezept-Timer'} ist fertig!`;

  // 1. Android Vibration pattern
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate([400, 150, 400, 150, 400]);
    } catch {
      // Ignore
    }
  }

  // 2. Audible chime
  playTimerChime();

  // 3. ServiceWorker Notification (best on Android PWA)
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        reg.showNotification(title, {
          body,
          icon: '/pwa-icon.svg',
          badge: '/pwa-icon.svg',
          vibrate: [400, 150, 400, 150, 400],
          tag: `timer_${timer.id}`,
          renotify: true
        } as NotificationOptions);
        return;
      }
    } catch {
      // Fallback
    }
  }

  // 4. Fallback standard Web Notification
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        icon: '/pwa-icon.svg'
      });
    } catch {
      // Ignore
    }
  }
}

// Request notification permission on user action
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    try {
      Notification.requestPermission().catch(() => {});
    } catch {
      // Ignore
    }
  }
}

export const TimerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [timers, setTimers] = useState<ActiveTimer[]>([]);

  // Ticking effect using high resolution delta
  useEffect(() => {
    const hasRunning = timers.some((t) => t.isRunning && t.remainingSeconds > 0);
    if (!hasRunning) return;

    const interval = setInterval(() => {
      setTimers((prevTimers) => {
        return prevTimers.map((timer) => {
          if (!timer.isRunning || timer.remainingSeconds <= 0) {
            return timer;
          }

          const newRemaining = timer.remainingSeconds - 1;

          if (newRemaining === 0) {
            // Trigger completion notification & sound
            notifyTimerFinished(timer);
            return {
              ...timer,
              remainingSeconds: 0,
              isRunning: false
            };
          }

          return {
            ...timer,
            remainingSeconds: newRemaining
          };
        });
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timers]);

  const addTimer = useCallback((
    name: string,
    durationSeconds: number,
    recipeId?: string,
    stepNumber?: number
  ): string => {
    requestNotificationPermission();
    const id = `timer_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newTimer: ActiveTimer = {
      id,
      name: name || 'Step Timer',
      durationSeconds,
      remainingSeconds: durationSeconds,
      isRunning: true,
      recipeId,
      stepNumber
    };

    setTimers((prev) => [...prev, newTimer]);
    return id;
  }, []);

  const startTimer = useCallback((id: string) => {
    requestNotificationPermission();
    setTimers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isRunning: true } : t))
    );
  }, []);

  const pauseTimer = useCallback((id: string) => {
    setTimers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isRunning: false } : t))
    );
  }, []);

  const resetTimer = useCallback((id: string) => {
    setTimers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, remainingSeconds: t.durationSeconds, isRunning: false } : t))
    );
  }, []);

  const addTime = useCallback((id: string, extraSeconds: number) => {
    setTimers((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              remainingSeconds: Math.max(0, t.remainingSeconds + extraSeconds),
              durationSeconds: Math.max(t.durationSeconds, t.remainingSeconds + extraSeconds)
            }
          : t
      )
    );
  }, []);

  const removeTimer = useCallback((id: string) => {
    setTimers((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const activeCount = timers.filter((t) => t.isRunning && t.remainingSeconds > 0).length;

  return (
    <TimerContext.Provider
      value={{
        timers,
        addTimer,
        startTimer,
        pauseTimer,
        resetTimer,
        addTime,
        removeTimer,
        activeCount
      }}
    >
      {children}
    </TimerContext.Provider>
  );
};

export function useTimers(): TimerContextType {
  const context = useContext(TimerContext);
  if (!context) {
    throw new Error('useTimers must be used within a TimerProvider');
  }
  return context;
}
