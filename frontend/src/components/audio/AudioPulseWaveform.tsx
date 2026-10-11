import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Sparkles, Flame, Play } from 'lucide-react';

interface AudioPulseWaveformProps {
  persona: 'friendly' | 'savage';
  isSpeaking: boolean;
  duckingLevel: number; // 0.0 to 1.0 (e.g. 0.20 when ducked, 1.0 when normal)
  activeCueText?: string;
  onPersonaChange?: (newPersona: 'friendly' | 'savage') => void;
  onTriggerCueSpeech?: (text: string) => void;
}

export const AudioPulseWaveform: React.FC<AudioPulseWaveformProps> = ({
  persona,
  isSpeaking,
  duckingLevel,
  activeCueText = "Keep steady stride along Strand Road. Turn approach in 200m.",
  onPersonaChange,
  onTriggerCueSpeech,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [isPlayingMusic, setIsPlayingMusic] = useState<boolean>(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let step = 0;
    const render = () => {
      step += persona === 'savage' ? 0.08 : 0.04;
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Primary color scheme based on Persona & Speaking state
      const isSavage = persona === 'savage';
      const baseColor = isSavage ? '#ff5416' : '#3db86b';
      const secondaryColor = isSavage ? '#ef4444' : '#00e5a3';

      // 1. Outer Ducking / Music Energy Ring
      ctx.beginPath();
      const ringRadius = 88 + Math.sin(step * 1.5) * (isSpeaking ? 12 : 4);
      ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
      ctx.strokeStyle = isSpeaking ? (isSavage ? 'rgba(239, 68, 68, 0.4)' : 'rgba(0, 229, 163, 0.4)') : 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = isSpeaking ? 3 : 1.5;
      ctx.stroke();

      // 2. Multi-Layer Organic Topological Waveform Rings (Organimo style)
      const layers = 5;
      for (let l = 1; l <= layers; l++) {
        ctx.beginPath();
        const baseRadius = 30 + l * 11;
        const points = isSavage ? 64 : 48;

        for (let i = 0; i <= points; i++) {
          const angle = (i / points) * Math.PI * 2;
          
          // Noise modulation
          let frequency = isSavage ? 8 : 4;
          let waveAmp = isSpeaking ? 14 : (isSavage ? 9 : 4);
          
          // Harmonics
          let offset = Math.sin(angle * frequency + step * l) * waveAmp;
          if (isSavage) {
            // Jagged spikes
            offset += (Math.random() - 0.5) * (isSpeaking ? 8 : 3);
          }

          const r = baseRadius + offset;
          const x = centerX + Math.cos(angle) * r;
          const y = centerY + Math.sin(angle) * r;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();

        const alpha = (layers - l + 1) / layers;
        ctx.strokeStyle = l === layers ? baseColor : secondaryColor;
        ctx.globalAlpha = isSpeaking ? alpha * 0.9 : alpha * 0.45;
        ctx.lineWidth = l === layers ? 2.5 : 1.2;
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;

      // 3. Central Glowing Core
      ctx.beginPath();
      const coreR = 18 + (isSpeaking ? Math.sin(step * 4) * 5 : Math.sin(step * 2) * 2);
      ctx.arc(centerX, centerY, coreR, 0, Math.PI * 2);
      ctx.fillStyle = isSavage ? '#ff5416' : '#00e5a3';
      ctx.shadowColor = isSavage ? 'rgba(255, 84, 22, 0.8)' : 'rgba(0, 229, 163, 0.8)';
      ctx.shadowBlur = isSpeaking ? 24 : 12;
      ctx.fill();
      ctx.shadowBlur = 0;

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [persona, isSpeaking, duckingLevel]);

  // Demo audio trigger
  const handlePlayVoiceSample = () => {
    if (onTriggerCueSpeech) {
      onTriggerCueSpeech(activeCueText);
    } else if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(activeCueText);
      utterance.pitch = persona === 'savage' ? 0.85 : 1.1;
      utterance.rate = persona === 'savage' ? 1.15 : 0.95;
      window.speechSynthesis.speak(utterance);
    }
  };

  return (
    <div className="relative flex flex-col items-center justify-center p-4">
      {/* Halo Header: Real-Time Music Ducking Indicator */}
      <div className="mb-3 flex items-center justify-between w-full max-w-xs px-3 py-1.5 rounded-full border border-white/10 bg-[#0d1319]/80 backdrop-blur-md">
        <button
          onClick={() => setIsPlayingMusic(!isPlayingMusic)}
          className="flex items-center gap-2 text-left"
          title="Toggle Music Track"
        >
          {isPlayingMusic ? (
            <Volume2 className="h-4 w-4 text-emerald-400 animate-pulse" />
          ) : (
            <VolumeX className="h-4 w-4 text-slate-500" />
          )}
          <span className="font-display text-[11px] font-semibold tracking-wider text-slate-300">
            {isSpeaking
              ? `MUSIC DUCKED (${Math.round(duckingLevel * 100)}%)`
              : isPlayingMusic ? `MUSIC PLAYING (100%)` : `MUSIC MUTED (0%)`}
          </span>
        </button>
        <div className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${
              isSpeaking
                ? persona === 'savage'
                  ? 'bg-rose-500 animate-ping'
                  : 'bg-emerald-400 animate-ping'
                : 'bg-emerald-500'
            }`}
          />
          <span className="text-[10px] font-display font-medium text-slate-400">
            {isSpeaking ? 'TTS ACTIVE' : 'STANDBY'}
          </span>
        </div>
      </div>

      {/* Central Canvas Container with Organic Halo */}
      <div className="relative flex items-center justify-center my-2">
        <canvas
          ref={canvasRef}
          width={260}
          height={260}
          className="relative z-10"
        />

        {/* Ambient Backlight Glow */}
        <div
          className={`absolute h-48 w-48 rounded-full blur-3xl transition-all duration-700 pointer-events-none ${
            persona === 'savage'
              ? 'bg-orange-600/25'
              : 'bg-emerald-500/20'
          }`}
        />
      </div>

      {/* Current Spoken Audio Cue Banner */}
      <div className="w-full max-w-sm rounded-xl border border-[#202c38] bg-[#111720]/90 p-3.5 text-center shadow-lg backdrop-blur-md">
        <div className="flex items-center justify-center gap-1.5 text-[11px] font-display font-bold tracking-wider uppercase mb-1 text-slate-400">
          <span>Spoken Turn Prompt</span>
          <button
            onClick={handlePlayVoiceSample}
            className="ml-2 inline-flex items-center gap-1 text-[#00e5a3] hover:text-white transition-colors"
          >
            <Play className="h-3 w-3 fill-current" />
            <span>Speak</span>
          </button>
        </div>
        <p className="text-sm font-medium text-white italic">
          "{activeCueText}"
        </p>
      </div>

      {/* Persona Morph Switcher ('Friendly' vs 'Savage') */}
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#1f2a36] bg-[#0c1219] p-1">
        <button
          onClick={() => onPersonaChange && onPersonaChange('friendly')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-display font-semibold transition-all ${
            persona === 'friendly'
              ? 'bg-[#3db86b] text-white shadow-md shadow-emerald-900/50'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Friendly Explorer</span>
        </button>

        <button
          onClick={() => onPersonaChange && onPersonaChange('savage')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-display font-semibold transition-all ${
            persona === 'savage'
              ? 'bg-[#ff5416] text-white shadow-md shadow-orange-900/50'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Flame className="h-3.5 w-3.5" />
          <span>Savage Coach</span>
        </button>
      </div>
    </div>
  );
};
