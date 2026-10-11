import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  BatteryMedium, 
  Coffee, 
  Award, 
  Flag,
  Moon
} from 'lucide-react';
import type { PlannedRoute, QuestSubmission } from '../services/api';
import { AudioPulseWaveform } from '../components/audio/AudioPulseWaveform';
import { QuickSnapModal } from '../components/camera/QuickSnapModal';

interface ActiveRunCanvasScreenProps {
  plannedRoute: PlannedRoute;
  onFinishRun: (runData: {
    telemetryPoints: { latitude: number; longitude: number; timestamp: string; speed: number }[];
    questSubmissions: QuestSubmission[];
    elapsedSeconds: number;
    distanceKm: number;
    mode: string;
  }) => void;
}

export const ActiveRunCanvasScreen: React.FC<ActiveRunCanvasScreenProps> = ({
  plannedRoute,
  onFinishRun,
}) => {
  const [isRunning, setIsRunning] = useState<boolean>(true);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [distanceKm, setDistanceKm] = useState<number>(0.0);
  const [currentPace, setCurrentPace] = useState<string>('5:14');
  const [currentPoints, setCurrentPoints] = useState<number>(50); // Initial adherence pledge
  
  // Audio Engine & Persona State
  const [persona, setPersona] = useState<'friendly' | 'savage'>('friendly');
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [duckingLevel, setDuckingLevel] = useState<number>(1.0);
  const [activeCueIndex, setActiveCueIndex] = useState<number>(0);

  // Fatigue Break
  const [isFatigueBreak, setIsFatigueBreak] = useState<boolean>(false);
  const [breakCountdown, setBreakCountdown] = useState<number>(120); // 2 minutes

  // QuickSnap Camera
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const [questSubmissions, setQuestSubmissions] = useState<QuestSubmission[]>([
    { quest_type: 'social', self_reported_count: 2 } // Mock runner greeting
  ]);

  // AMOLED True Black Sentry Mode
  const [isAmoledSentry, setIsAmoledSentry] = useState<boolean>(false);

  // Telemetry buffer
  const telemetryPointsRef = useRef<{ latitude: number; longitude: number; timestamp: string; speed: number }[]>([]);

  const maneuvers = plannedRoute.maneuvers || [];
  const currentManeuver = maneuvers[activeCueIndex % maneuvers.length];

  // Run Clock Timer
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);

      // Accumulate distance (approx 12 km/h pace)
      setDistanceKm((prev) => +(prev + 0.0035).toFixed(3));

      // Append mock GPS telemetry breadcrumb
      const baseLat = 22.5726 + (telemetryPointsRef.current.length * 0.0001);
      const baseLon = 88.3639 + (telemetryPointsRef.current.length * 0.0001);
      telemetryPointsRef.current.push({
        latitude: +baseLat.toFixed(6),
        longitude: +baseLon.toFixed(6),
        timestamp: new Date().toISOString(),
        speed: 3.2,
      });

      // Fluctuate pace slightly
      if (Math.random() > 0.7) {
        const secondsPace = Math.floor(5 * 60 + Math.random() * 25);
        const m = Math.floor(secondsPace / 60);
        const s = secondsPace % 60;
        setCurrentPace(`${m}:${s < 10 ? '0' : ''}${s}`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning]);

  // 2-Minute Fatigue Rest Break Countdown
  useEffect(() => {
    if (!isFatigueBreak) return;
    const timer = setInterval(() => {
      setBreakCountdown((prev) => {
        if (prev <= 1) {
          setIsFatigueBreak(false);
          return 120;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isFatigueBreak]);

  // Periodic Spoken Audio Cue simulation (with SpeechSynthesis & music ducking)
  useEffect(() => {
    const cueTimer = setInterval(() => {
      if (isRunning && !isFatigueBreak && currentManeuver) {
        triggerCueSpeech(currentManeuver.spoken_text);
        setActiveCueIndex((prev) => (prev + 1) % Math.max(maneuvers.length, 1));
      }
    }, 18000); // Trigger spoken prompt every 18 seconds

    return () => clearInterval(cueTimer);
  }, [isRunning, isFatigueBreak, currentManeuver, maneuvers.length]);

  const triggerCueSpeech = (text: string) => {
    setIsSpeaking(true);
    setDuckingLevel(0.20); // Duck music volume down to 20%

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.pitch = persona === 'savage' ? 0.85 : 1.1;
      utterance.rate = persona === 'savage' ? 1.15 : 0.95;
      
      utterance.onend = () => {
        setIsSpeaking(false);
        setDuckingLevel(1.0); // Restore music volume to 100%
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        setDuckingLevel(1.0);
      };

      window.speechSynthesis.speak(utterance);
    } else {
      setTimeout(() => {
        setIsSpeaking(false);
        setDuckingLevel(1.0);
      }, 3500);
    }
  };

  const handleTriggerFatigueBreak = () => {
    setIsFatigueBreak(true);
    setBreakCountdown(120);
    triggerCueSpeech(
      persona === 'savage'
        ? "Fatigue break engaged! Catch your breath, drop your heart rate, and hydrate. 2 minutes on the clock!"
        : "Taking a gentle 2-minute fatigue break. Enjoy the outdoor surroundings and breathe."
    );
  };

  const handlePhotoCaptured = (photo: { base64: string; landmarkId?: string; landmarkName?: string }) => {
    const newSubmission: QuestSubmission = {
      quest_type: 'visual',
      image_base64_or_path: photo.base64,
      latitude: 22.5448,
      longitude: 88.3426,
      timestamp: new Date().toISOString(),
    };
    setQuestSubmissions((prev) => [...prev, newSubmission]);
    setCurrentPoints((prev) => prev + 150); // Real-time feedback for visual quest
  };

  const handleFinish = () => {
    setIsRunning(false);
    onFinishRun({
      telemetryPoints: telemetryPointsRef.current,
      questSubmissions,
      elapsedSeconds,
      distanceKm: Math.max(distanceKm, 1.2),
      mode: 'running',
    });
  };

  const formatTimer = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className={`flex flex-col gap-4 pb-8 transition-colors duration-500 ${
      isAmoledSentry ? 'bg-black min-h-screen text-white p-2' : ''
    }`}>
      {/* Top HUD: Status Bar & AMOLED Sentry Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <span className="font-display text-[11px] font-bold uppercase tracking-widest text-[#00e5a3]">
            SCREEN 2 • ACTIVE RUN
          </span>
          <h1 className="font-display text-xl font-bold tracking-tight text-white sm:text-2xl">
            Screen-Free Quest Canvas
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {/* AMOLED Power Sentry Mode Button */}
          <button
            onClick={() => setIsAmoledSentry(!isAmoledSentry)}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-all ${
              isAmoledSentry
                ? 'border-emerald-400 bg-emerald-950/40 text-emerald-400'
                : 'border-[#223140] bg-[#121922] text-slate-400 hover:text-white'
            }`}
          >
            <Moon className="h-3.5 w-3.5" />
            <span>{isAmoledSentry ? 'AMOLED ON' : 'OLED Sentry'}</span>
          </button>

          <div className="flex items-center gap-1 text-xs text-slate-400">
            <BatteryMedium className="h-4 w-4 text-emerald-400" />
            <span className="font-display font-bold">92%</span>
          </div>
        </div>
      </div>

      {/* Hero Glanceable Metric HUD (Fitonist Athletic Precision) */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="rounded-2xl border border-[#202b36] bg-[#0d131a] p-3 text-center shadow-lg">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Distance</span>
          <div className="font-display text-2xl font-extrabold text-white sm:text-3xl">
            {distanceKm.toFixed(2)}
          </div>
          <span className="text-[10px] text-slate-400">kilometers</span>
        </div>

        <div className="rounded-2xl border border-[#202b36] bg-[#0d131a] p-3 text-center shadow-lg">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Pace</span>
          <div className="font-display text-2xl font-extrabold text-[#00e5a3] sm:text-3xl">
            {currentPace}
          </div>
          <span className="text-[10px] text-slate-400">min / km</span>
        </div>

        <div className="rounded-2xl border border-[#202b36] bg-[#0d131a] p-3 text-center shadow-lg">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Time</span>
          <div className="font-display text-2xl font-extrabold text-white sm:text-3xl">
            {formatTimer(elapsedSeconds)}
          </div>
          <span className="text-[10px] text-slate-400">elapsed</span>
        </div>
      </div>

      {/* Central Interactive Audio Waveform Canvas */}
      <div className="card-fitonist overflow-hidden">
        <AudioPulseWaveform
          persona={persona}
          isSpeaking={isSpeaking}
          duckingLevel={duckingLevel}
          activeCueText={currentManeuver?.spoken_text || "Approaching next quest waypoint."}
          onPersonaChange={(p) => setPersona(p)}
          onTriggerCueSpeech={(text) => triggerCueSpeech(text)}
        />
      </div>

      {/* Fatigue Rest Break Card / Alert */}
      {isFatigueBreak ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-950/25 p-4 text-center shadow-xl animate-pulse">
          <div className="flex items-center justify-center gap-2 text-amber-400 mb-1">
            <Coffee className="h-5 w-5" />
            <h3 className="font-display text-base font-bold">2-Minute Fatigue Rest Break</h3>
          </div>
          <div className="font-display text-3xl font-extrabold text-white my-1">
            {formatTimer(breakCountdown)}
          </div>
          <p className="text-xs text-slate-300">
            Pacing paused. Inhale deeply, hydrate, and prepare for turn 4.
          </p>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-xl border border-[#1e2a37] bg-[#0f1620] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Coffee className="h-4 w-4 text-amber-400" />
            <span className="text-xs text-slate-300">Feeling exhausted or slowing down?</span>
          </div>
          <button
            onClick={handleTriggerFatigueBreak}
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-display font-semibold text-amber-400 hover:bg-amber-500/20"
          >
            Rest Break
          </button>
        </div>
      )}

      {/* In-Run Action Deck */}
      <div className="grid grid-cols-2 gap-3">
        {/* QuickSnap Shutter Button */}
        <button
          onClick={() => setIsCameraOpen(true)}
          className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-[#12231c] py-3.5 text-xs font-display font-bold text-emerald-300 shadow-lg hover:border-emerald-400 transition-all active:scale-95"
        >
          <Camera className="h-4 w-4 text-emerald-400" />
          <span>Snap Landmark ({questSubmissions.filter(q => q.quest_type === 'visual').length})</span>
        </button>

        {/* Live Points Pill */}
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-[#202d3c] bg-[#111822] py-3.5 text-xs font-display font-bold text-slate-200">
          <Award className="h-4 w-4 text-[#ff5416]" />
          <span>Earned: {currentPoints} pts</span>
        </div>
      </div>

      {/* Main Finish & Sync CTA */}
      <button
        onClick={handleFinish}
        className="btn-athletic btn-flora w-full py-4 text-base shadow-xl mt-2"
      >
        <Flag className="h-5 w-5" />
        <span>End Quest & Trigger Hermes Evaluation</span>
      </button>

      {/* Quick Snap Modal */}
      <QuickSnapModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onPhotoCaptured={handlePhotoCaptured}
        nearbyLandmark={plannedRoute.waypoints?.[0]}
      />
    </div>
  );
};
