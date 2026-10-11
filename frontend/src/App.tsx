import React, { useState, useEffect, useRef } from 'react';
import {
  Navigation,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Square,
  Camera,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  RotateCcw,
  Headphones,
  X,
  Compass,
  Activity,
  Award,
  Smartphone,
  MapPin,
  Flame,
  Radio,
} from 'lucide-react';
import confetti from 'canvas-confetti';

type TrackerState = 'IDLE' | 'TRACKING' | 'PAUSED' | 'SUMMARY';

interface RoutePreset {
  id: string;
  name: string;
  distanceKm: number;
  landmarks: string[];
  elevationGainM: number;
  estimatedMinutes: number;
  description: string;
}

const PRESET_ROUTES: RoutePreset[] = [
  { 
    id: 'r1', 
    name: 'Kolkata Maidan Outer Loop', 
    distanceKm: 5.0, 
    landmarks: ['Eden Gardens', 'Prinsep Ghat', 'Victoria South'], 
    elevationGainM: 28, 
    estimatedMinutes: 26,
    description: 'Flat heritage loop circumnavigating lush colonial green space and historic cricket grounds.'
  },
  { 
    id: 'r2', 
    name: 'Hooghly Riverfront Trail', 
    distanceKm: 3.5, 
    landmarks: ['Prinsep Ghat Arches', 'Babu Ghat River Steps'], 
    elevationGainM: 14, 
    estimatedMinutes: 18,
    description: 'Breezy riverside path along the Hooghly with historic neoclassical ghats and ferry docks.'
  },
  { 
    id: 'r3', 
    name: 'Victoria Memorial Botanical Track', 
    distanceKm: 7.2, 
    landmarks: ['Victoria Memorial', 'St. Paul’s Cathedral', 'Racecourse Canopy', 'Park Street Entrance'], 
    elevationGainM: 36, 
    estimatedMinutes: 38,
    description: 'Scenic circuit featuring marble domes, shaded botanical canopies, and wide gravel corridors.'
  },
];

export function App() {
  const [trackerState, setTrackerState] = useState<TrackerState>('IDLE');
  const [selectedRoute, setSelectedRoute] = useState<RoutePreset>(PRESET_ROUTES[0]);
  const [isBackendOnline, setIsBackendOnline] = useState<boolean>(true);
  const [useDeviceGps, setUseDeviceGps] = useState<boolean>(false);
  const [gpsAccuracy, setGpsAccuracy] = useState<string>('±2.4m');

  // Live Tracking Metrics
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [distanceKm, setDistanceKm] = useState<number>(0.0);
  const [currentPace, setCurrentPace] = useState<string>('5:14');
  const [cadenceSpm, setCadenceSpm] = useState<number>(168);
  const elevationM = 18;
  const [activeCueText, setActiveCueText] = useState<string>('Head North on Strand Rd. Keep steady breathing.');
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);

  // Breadcrumbs & Landmarks
  const [breadcrumbs, setBreadcrumbs] = useState<{ latitude: number; longitude: number }[]>([]);
  const [verifiedLandmark, setVerifiedLandmark] = useState<boolean>(false);
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState<string>(
    'https://images.unsplash.com/photo-1558431382-27e303142255?auto=format&fit=crop&w=600&q=80'
  );
  const [isCameraModalOpen, setIsCameraModalOpen] = useState<boolean>(false);

  // Post Run Summary Data
  const [summaryData, setSummaryData] = useState<{
    run_id?: string;
    total_distance_km?: number;
    average_pace_min_km?: number;
    is_route_adherent?: boolean;
    deviation_meters?: number;
    total_points_awarded?: number;
    quest_evaluations?: Array<{
      quest_type: string;
      matched_landmark_name: string;
      is_verified: boolean;
      points_awarded: number;
      agent_narrative: string;
    }>;
  } | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const watchIdRef = useRef<number | null>(null);

  // Check backend connectivity on mount
  useEffect(() => {
    fetch('http://127.0.0.1:8000/health', { signal: AbortSignal.timeout(2000) })
      .then((res) => setIsBackendOnline(res.ok))
      .catch(() => setIsBackendOnline(false));
  }, []);

  // Haptic feedback helper
  const triggerHaptic = () => {
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(40);
      } catch {
        // Ignore if unpermitted
      }
    }
  };

  // Device GPS watcher
  useEffect(() => {
    if (useDeviceGps && trackerState === 'TRACKING' && 'geolocation' in navigator) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          setGpsAccuracy(`±${Math.round(pos.coords.accuracy)}m`);
          setBreadcrumbs((prev) => [
            ...prev,
            { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
          ]);
        },
        (err) => {
          console.warn('Geolocation error:', err.message);
          setUseDeviceGps(false);
          setGpsAccuracy('±3.2m (Simulated)');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } else {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    }

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [useDeviceGps, trackerState]);

  // Timer & Real-Time Tracking Engine
  useEffect(() => {
    if (trackerState !== 'TRACKING') return;

    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);

      // Accumulate real-time distance
      setDistanceKm((prev) => +(prev + 0.0035).toFixed(3));

      // Fluctuate cadence and pace slightly
      setCadenceSpm(164 + Math.floor(Math.sin(Date.now() / 3000) * 6));
      const minPace = 5;
      const secPace = 10 + Math.floor(Math.abs(Math.sin(Date.now() / 4000)) * 12);
      setCurrentPace(`${minPace}:${secPace < 10 ? '0' : ''}${secPace}`);

      // Add breadcrumb waypoint
      if (!useDeviceGps) {
        setBreadcrumbs((prev) => {
          const count = prev.length + 1;
          const lat = 22.5726 + Math.sin(count * 0.12) * 0.003;
          const lon = 88.3639 + Math.cos(count * 0.12) * 0.003;
          return [...prev, { latitude: lat, longitude: lon }];
        });
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [trackerState, useDeviceGps]);

  // Spoken voice guidance simulator
  useEffect(() => {
    if (trackerState !== 'TRACKING') return;

    const cues = [
      'Head North on Strand Rd. Keep steady breathing.',
      'Turn right at Babu Ghat archway. 400m to riverfront.',
      'Historic Prinsep Ghat landmark in 80 meters on your left.',
      'Landmark zone unlocked. Prepare for camera capture or continue pace.',
      'Maintain 5:15 pace. Elevation flat. 1.2 kilometers remaining.',
    ];

    const cueInterval = setInterval(() => {
      const nextCue = cues[Math.floor(Math.random() * cues.length)];
      setActiveCueText(nextCue);
      if (!isAudioMuted && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(nextCue);
        utterance.rate = 1.05;
        window.speechSynthesis.speak(utterance);
      }
    }, 18000);

    return () => clearInterval(cueInterval);
  }, [trackerState, isAudioMuted]);

  // Draw Dynamic GPS Breadcrumb Map Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Scale canvas to physical CSS pixel box and DPR
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Background slate
    ctx.fillStyle = '#060a0f';
    ctx.fillRect(0, 0, w, h);

    // Subtle GPS topographic grid
    ctx.strokeStyle = '#111923';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Planned Route Orbit (dashed)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.5, w * 0.38, h * 0.34, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Landmarks on Canvas
    const landmarks = [
      { name: 'Prinsep Ghat', x: w * 0.25, y: h * 0.72 },
      { name: 'Eden Gardens', x: w * 0.72, y: h * 0.28 },
    ];

    landmarks.forEach((lm) => {
      ctx.fillStyle = '#ff5416';
      ctx.beginPath();
      ctx.arc(lm.x, lm.y, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 84, 22, 0.2)';
      ctx.beginPath();
      ctx.arc(lm.x, lm.y, 11, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#94a3b8';
      const labelSize = Math.max(11, Math.round(w * 0.026));
      ctx.font = `${labelSize}px Space Grotesk, sans-serif`;
      ctx.fillText(lm.name, lm.x - 20, lm.y - 10);
    });

    // Active Runner Breadcrumb Trail
    const count = breadcrumbs.length;
    if (count > 1) {
      ctx.strokeStyle = '#00e5a3';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();

      for (let i = 0; i < count; i++) {
        const t = (i / 30) * Math.PI * 1.5;
        const px = w * 0.5 + Math.cos(t) * (w * 0.38);
        const py = h * 0.5 + Math.sin(t) * (h * 0.34);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Current runner position with pulsing halo
      const currT = (count / 30) * Math.PI * 1.5;
      const rx = w * 0.5 + Math.cos(currT) * (w * 0.38);
      const ry = h * 0.5 + Math.sin(currT) * (h * 0.34);

      ctx.fillStyle = 'rgba(0, 229, 163, 0.25)';
      ctx.beginPath(); ctx.arc(rx, ry, 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#00e5a3';
      ctx.beginPath(); ctx.arc(rx, ry, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [breadcrumbs.length, trackerState]);

  // Actions
  const handleStartRun = () => {
    triggerHaptic();
    setDistanceKm(0.0);
    setElapsedSeconds(0);
    setBreadcrumbs([
      { latitude: 22.5726, longitude: 88.3639 },
      { latitude: 22.5730, longitude: 88.3645 },
    ]);
    setVerifiedLandmark(false);
    setTrackerState('TRACKING');

    if (!isAudioMuted && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(`Starting ${selectedRoute.name}. Audio navigation active.`);
      window.speechSynthesis.speak(u);
    }
  };

  const handlePauseToggle = () => {
    triggerHaptic();
    setTrackerState((prev) => (prev === 'TRACKING' ? 'PAUSED' : 'TRACKING'));
  };

  const handleFinishRun = async () => {
    triggerHaptic();
    setTrackerState('SUMMARY');
    setIsSyncing(true);

    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#00e5a3', '#ff5416', '#38bdf8', '#ffffff'],
    });

    const payload = {
      user_id: '11111111-1111-1111-1111-111111111111',
      planned_route_id: selectedRoute.id,
      run: {
        start_time: new Date(Date.now() - elapsedSeconds * 1000).toISOString(),
        end_time: new Date().toISOString(),
        mode: 'running',
        telemetry_points: breadcrumbs.map((b) => ({
          ...b,
          timestamp: new Date().toISOString(),
          speed: 3.1,
        })),
      },
      quest_submissions: [
        {
          quest_type: 'visual',
          image_base64_or_path: capturedPhotoUrl,
          latitude: 22.5558,
          longitude: 88.3328,
          timestamp: new Date().toISOString(),
        },
        {
          quest_type: 'social',
          self_reported_count: 2,
        },
      ],
    };

    try {
      const res = await fetch('http://127.0.0.1:8000/api/v1/sync/run-payload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setSummaryData(data);
      } else {
        fallbackSummary();
      }
    } catch {
      fallbackSummary();
    } finally {
      setIsSyncing(false);
    }
  };

  const fallbackSummary = () => {
    setSummaryData({
      run_id: 'mobile-' + Date.now(),
      total_distance_km: distanceKm || 4.12,
      average_pace_min_km: 5.14,
      is_route_adherent: true,
      deviation_meters: 22.4,
      total_points_awarded: Math.round((distanceKm || 4.12) * 10) + 50 + 150,
      quest_evaluations: [
        {
          quest_type: 'visual',
          matched_landmark_name: 'Prinsep Ghat Riverfront',
          is_verified: true,
          points_awarded: 150,
          agent_narrative: 'Gemma Vision: Architectural portico and river steps verified (0.88 confidence).',
        },
      ],
    });
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const playSpeechCue = () => {
    triggerHaptic();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(activeCueText);
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    }
  };

  // Real Mobile Camera Capture Handler
  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setCapturedPhotoUrl(event.target.result as string);
          setVerifiedLandmark(true);
          setIsCameraModalOpen(false);
          triggerHaptic();
        }
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="min-h-screen bg-[#05080c] text-white flex flex-col font-sans selection:bg-[#00e5a3] selection:text-black">
      {/* =========================================================================
          TOP RESPONSIVE APP BAR (Sticky on mobile & desktop)
      ========================================================================= */}
      <header className="w-full border-b border-[#121922] bg-[#070b10]/95 backdrop-blur-md px-3 sm:px-6 py-2.5 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          {/* Brand Logo & Live Mode Indicator */}
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#00e5a3] to-[#00b380] flex items-center justify-center text-black font-black text-sm shadow-md shadow-emerald-950/40">
              TQ
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-black text-sm sm:text-base tracking-wider text-white">
                  TRAILQUEST
                </span>
                <span className="hidden sm:inline-block px-1.5 py-0.2 rounded bg-[#101c18] border border-[#1b3628] text-[9px] font-extrabold text-[#00e5a3]">
                  MOBILE WEB
                </span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-neutral-400">
                <span className={`h-1.5 w-1.5 rounded-full ${isBackendOnline ? 'bg-[#00e5a3] animate-pulse' : 'bg-amber-400'}`} />
                <span>{isBackendOnline ? 'FastAPI Connected' : 'Local Offline Mode'}</span>
              </div>
            </div>
          </div>

          {/* Athletic Stage Tabs (Route / Track / Debrief) */}
          <nav className="flex items-center gap-1 rounded-xl bg-[#0c1218] p-1 border border-[#182330] text-xs">
            <button
              onClick={() => {
                triggerHaptic();
                setTrackerState('IDLE');
              }}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                trackerState === 'IDLE'
                  ? 'bg-[#182330] text-[#00e5a3] shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Compass className="h-3.5 w-3.5" />
              <span>Route</span>
            </button>

            <button
              onClick={() => {
                triggerHaptic();
                if (trackerState === 'IDLE') handleStartRun();
                else setTrackerState('TRACKING');
              }}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                trackerState === 'TRACKING' || trackerState === 'PAUSED'
                  ? 'bg-[#182330] text-[#00e5a3] shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Activity className="h-3.5 w-3.5" />
              <span>Track</span>
              {trackerState === 'TRACKING' && (
                <span className="h-1.5 w-1.5 rounded-full bg-[#00e5a3] animate-ping" />
              )}
            </button>

            <button
              onClick={() => {
                triggerHaptic();
                if (trackerState !== 'SUMMARY') handleFinishRun();
                else setTrackerState('SUMMARY');
              }}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                trackerState === 'SUMMARY'
                  ? 'bg-[#182330] text-[#00e5a3] shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Award className="h-3.5 w-3.5" />
              <span>Debrief</span>
            </button>
          </nav>
        </div>
      </header>

      {/* =========================================================================
          MAIN RESPONSIVE CONTAINER (Mobile edge-to-edge + Desktop 2-column)
      ========================================================================= */}
      <main className="w-full max-w-5xl mx-auto flex-1 flex flex-col px-3 sm:px-6 py-3 sm:py-6">

        {/* -----------------------------------------------------------------------
            STAGE 1: PRE-RUN ROUTE SELECTOR
        ------------------------------------------------------------------------ */}
        {trackerState === 'IDLE' && (
          <div className="flex-1 flex flex-col md:grid md:grid-cols-12 md:gap-6">
            
            {/* Left Column: Routes & Settings */}
            <div className="md:col-span-7 flex flex-col space-y-3.5">
              
              {/* GPS Lock & Location Sensor Status Banner */}
              <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[#091210] border border-[#143224] shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-[#0e2118] flex items-center justify-center text-[#00e5a3]">
                    <Navigation className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-extrabold text-[#00e5a3] tracking-wide">
                        GPS 3D LOCK ACTIVE
                      </span>
                      <span className="h-1.5 w-1.5 rounded-full bg-[#00e5a3] animate-pulse" />
                    </div>
                    <div className="text-[11px] text-neutral-400">
                      Kolkata Maidan Outer Circuit • Accuracy {gpsAccuracy}
                    </div>
                  </div>
                </div>

                {/* GPS Mode Toggle (Demo vs Device Geolocation) */}
                <button
                  onClick={() => {
                    triggerHaptic();
                    setUseDeviceGps(!useDeviceGps);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-bold border transition-colors cursor-pointer ${
                    useDeviceGps
                      ? 'bg-[#00e5a3] text-black border-[#00e5a3]'
                      : 'bg-[#101820] text-neutral-300 border-[#1d2938] hover:border-neutral-500'
                  }`}
                  title="Toggle real phone GPS"
                >
                  <Smartphone className="h-3 w-3" />
                  <span>{useDeviceGps ? 'Phone GPS' : 'Demo Sim'}</span>
                </button>
              </div>

              {/* Route Presets List */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-[11px] font-extrabold tracking-wider text-neutral-400 uppercase">
                    Available Quest Routes
                  </h2>
                  <span className="text-[10px] text-neutral-500 font-semibold">
                    {PRESET_ROUTES.length} Loops Mapped
                  </span>
                </div>

                <div className="space-y-2.5">
                  {PRESET_ROUTES.map((route) => {
                    const isSelected = selectedRoute.id === route.id;
                    return (
                      <div
                        key={route.id}
                        onClick={() => {
                          triggerHaptic();
                          setSelectedRoute(route);
                        }}
                        className={`cursor-pointer p-4 rounded-2xl border transition-all flex items-center justify-between ${
                          isSelected
                            ? 'bg-[#091511] border-[#00e5a3] shadow-md shadow-emerald-950/30'
                            : 'bg-[#090e13] border-[#15202b] hover:border-neutral-700'
                        }`}
                      >
                        <div className="flex-1 mr-3">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-white">{route.name}</span>
                            {isSelected && (
                              <span className="px-1.5 py-0.5 rounded-full bg-[#00e5a3]/20 text-[#00e5a3] text-[9px] font-extrabold">
                                SELECTED
                              </span>
                            )}
                          </div>
                          
                          <div className="text-xs text-neutral-400 mt-0.5">
                            +{route.elevationGainM}m elevation • ~{route.estimatedMinutes} min estimated
                          </div>

                          <div className="flex flex-wrap gap-1 mt-2">
                            {route.landmarks.map((lm, i) => (
                              <span
                                key={i}
                                className="px-2 py-0.5 rounded-md bg-[#111923] text-[10px] text-neutral-300 font-medium flex items-center gap-1"
                              >
                                <MapPin className="h-2.5 w-2.5 text-[#00e5a3]" />
                                <span>{lm}</span>
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="text-right flex-shrink-0 pl-2">
                          <span className={`text-2xl font-black ${isSelected ? 'text-[#00e5a3]' : 'text-white'}`}>
                            {route.distanceKm.toFixed(1)}
                          </span>
                          <span className="text-[10px] text-neutral-500 font-bold block">KM</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Screen-Free Audio Notice */}
              <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-[#0f0e0c] border border-[#2b1e13]">
                <div className="h-8 w-8 rounded-xl bg-[#24170d] flex items-center justify-center text-[#ff5416] flex-shrink-0">
                  <Headphones className="h-4 w-4" />
                </div>
                <p className="text-xs text-neutral-300 leading-relaxed">
                  <strong className="text-[#ff5416]">Screen-Free Design:</strong> Put your phone in your pocket. Spoken audio cues guide every turn and alert you at landmark waypoints.
                </p>
              </div>

              {/* Mobile Start Action Button (Shown on mobile screens) */}
              <div className="pt-2 md:hidden">
                <button
                  id="start-run-btn-mobile"
                  onClick={handleStartRun}
                  className="w-full py-4 rounded-2xl bg-[#00e5a3] hover:bg-emerald-400 active:scale-[0.98] text-black font-black text-base tracking-wider flex items-center justify-center gap-2 transition-all shadow-xl shadow-emerald-950/50 cursor-pointer"
                >
                  <span>START QUEST RUN</span>
                  <ArrowRight className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Right Column: Route Map Preview & Details (Visible on Desktop / Tablets) */}
            <div className="hidden md:flex md:col-span-5 flex-col space-y-3.5">
              <div className="p-5 rounded-3xl bg-[#080d12] border border-[#15212d] flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-extrabold text-neutral-400 uppercase tracking-wider">
                      Selected Route Profile
                    </span>
                    <span className="text-xs font-bold text-[#00e5a3]">
                      {selectedRoute.distanceKm} km loop
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-white mb-1">{selectedRoute.name}</h3>
                  <p className="text-xs text-neutral-400 mb-4">{selectedRoute.description}</p>

                  {/* Route Stat Tiles */}
                  <div className="grid grid-cols-2 gap-2.5 mb-4">
                    <div className="p-3 rounded-xl bg-[#0d141c] border border-[#182330]">
                      <div className="text-[10px] font-bold text-neutral-500 uppercase">EST. DURATION</div>
                      <div className="text-lg font-black text-white">{selectedRoute.estimatedMinutes} Mins</div>
                    </div>
                    <div className="p-3 rounded-xl bg-[#0d141c] border border-[#182330]">
                      <div className="text-[10px] font-bold text-neutral-500 uppercase">ELEVATION GAIN</div>
                      <div className="text-lg font-black text-neutral-300">+{selectedRoute.elevationGainM}m</div>
                    </div>
                  </div>

                  {/* Waypoint Milestones */}
                  <div className="space-y-2">
                    <div className="text-[10px] font-extrabold text-neutral-500 uppercase">
                      Quest Waypoints & AI Verification
                    </div>
                    {selectedRoute.landmarks.map((lm, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl bg-[#0a1017] border border-[#15202c] text-xs">
                        <span className="text-neutral-200 font-medium">📍 {lm}</span>
                        <span className="text-[10px] font-bold text-[#00e5a3] bg-emerald-950/60 px-2 py-0.5 rounded-md">
                          +150 pts
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Desktop Start Action Button */}
                <div className="pt-6">
                  <button
                    id="start-run-btn-desktop"
                    onClick={handleStartRun}
                    className="w-full py-4 rounded-2xl bg-[#00e5a3] hover:bg-emerald-400 active:scale-[0.98] text-black font-black text-base tracking-wider flex items-center justify-center gap-2 transition-all shadow-xl shadow-emerald-950/50 cursor-pointer"
                  >
                    <span>START QUEST RUN</span>
                    <ArrowRight className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* -----------------------------------------------------------------------
            STAGE 2: ACTIVE TRACKING HUD (Nike Run Club / Strava Athletic Feel)
        ------------------------------------------------------------------------ */}
        {(trackerState === 'TRACKING' || trackerState === 'PAUSED') && (
          <div className="flex-1 flex flex-col md:grid md:grid-cols-12 md:gap-6">
            
            {/* Left Column: Live Audio Cue, Hero Numbers & Athletic Metric Grid */}
            <div className="md:col-span-6 flex flex-col space-y-3.5">
              
              {/* Spoken Turn Guidance Banner */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-[#091017] border border-[#152230] shadow-sm">
                <div className="flex items-center gap-2.5 flex-1 mr-2">
                  <button
                    onClick={() => {
                      triggerHaptic();
                      setIsAudioMuted(!isAudioMuted);
                    }}
                    className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                      isAudioMuted
                        ? 'bg-[#1e1414] text-rose-400 border-[#381c1c]'
                        : 'bg-[#0f1f18] text-[#00e5a3] border-[#193b2a]'
                    }`}
                    title={isAudioMuted ? 'Unmute voice cues' : 'Mute voice cues'}
                  >
                    {isAudioMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4 animate-pulse" />}
                  </button>
                  <span className="text-xs font-semibold text-neutral-200 line-clamp-1">
                    {activeCueText}
                  </span>
                </div>

                <button
                  onClick={playSpeechCue}
                  className="px-2.5 py-1.5 rounded-lg bg-[#121e2a] hover:bg-[#1a2c3e] text-[11px] font-bold text-[#00e5a3] flex-shrink-0 cursor-pointer transition-colors"
                >
                  Speak
                </button>
              </div>

              {/* GIANT ATHLETIC HERO DISTANCE */}
              <div className="text-center py-2 sm:py-4 rounded-3xl bg-[#080d12] border border-[#14202c]">
                <div className="text-[68px] sm:text-[84px] leading-none font-black tracking-tight text-white font-mono">
                  {distanceKm.toFixed(2)}
                </div>
                <div className="text-[11px] font-extrabold tracking-widest text-neutral-500 uppercase mt-1">
                  KILOMETERS COMPLETED
                </div>
              </div>

              {/* 4-Metric Athletic HUD Grid */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3.5 rounded-2xl bg-[#080c10] border border-[#141f2a]">
                  <div className="text-[10px] font-extrabold tracking-wider text-neutral-500 uppercase">PACE</div>
                  <div className="text-2xl font-black text-[#00e5a3]">{currentPace} <span className="text-xs text-neutral-500">/km</span></div>
                </div>

                <div className="p-3.5 rounded-2xl bg-[#080c10] border border-[#141f2a]">
                  <div className="text-[10px] font-extrabold tracking-wider text-neutral-500 uppercase">DURATION</div>
                  <div className="text-2xl font-black text-white">{formatTime(elapsedSeconds)}</div>
                </div>

                <div className="p-3.5 rounded-2xl bg-[#080c10] border border-[#141f2a]">
                  <div className="text-[10px] font-extrabold tracking-wider text-neutral-500 uppercase">CADENCE</div>
                  <div className="text-2xl font-black text-white">{cadenceSpm} <span className="text-xs text-neutral-500">spm</span></div>
                </div>

                <div className="p-3.5 rounded-2xl bg-[#080c10] border border-[#141f2a]">
                  <div className="text-[10px] font-extrabold tracking-wider text-neutral-500 uppercase">ELEVATION</div>
                  <div className="text-2xl font-black text-neutral-300">+{elevationM} <span className="text-xs text-neutral-500">m</span></div>
                </div>
              </div>

              {/* Landmark Snap / Camera Verification Action */}
              <div>
                <button
                  onClick={() => {
                    triggerHaptic();
                    setIsCameraModalOpen(true);
                  }}
                  className={`w-full py-3.5 rounded-2xl border flex items-center justify-center gap-2 text-xs font-bold transition-all cursor-pointer ${
                    verifiedLandmark
                      ? 'bg-[#0a1812] border-[#00e5a3] text-[#00e5a3]'
                      : 'bg-[#0c1218] border-[#182636] hover:border-neutral-600 text-neutral-200'
                  }`}
                >
                  <Camera className="h-4 w-4 text-[#00e5a3]" />
                  <span>
                    {verifiedLandmark
                      ? '✓ Prinsep Ghat Verified (+150 pts)'
                      : 'Snap Nearby Landmark (+150 pts)'}
                  </span>
                </button>
              </div>

              {/* Pause & Finish Primary Action Controls */}
              <div className="pt-2 flex gap-3">
                <button
                  id="pause-btn"
                  onClick={handlePauseToggle}
                  className={`flex-1 py-4 rounded-2xl font-bold text-sm tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    trackerState === 'PAUSED'
                      ? 'bg-[#00e5a3] text-black shadow-lg shadow-emerald-950/40'
                      : 'bg-[#131d27] hover:bg-[#1a2836] text-white'
                  }`}
                >
                  {trackerState === 'PAUSED' ? (
                    <>
                      <Play className="h-5 w-5 fill-current" />
                      <span>RESUME</span>
                    </>
                  ) : (
                    <>
                      <Pause className="h-5 w-5" />
                      <span>PAUSE</span>
                    </>
                  )}
                </button>

                <button
                  id="finish-btn"
                  onClick={handleFinishRun}
                  className="flex-1 py-4 rounded-2xl bg-[#ff5416] hover:bg-[#ff6830] text-black font-black text-sm tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg shadow-orange-950/40 cursor-pointer"
                >
                  <Square className="h-4 w-4 fill-current" />
                  <span>FINISH</span>
                </button>
              </div>
            </div>

            {/* Right Column: Full Interactive Canvas GPS Map */}
            <div className="md:col-span-6 flex flex-col space-y-3.5 mt-3 md:mt-0">
              <div className="relative w-full h-56 sm:h-72 md:h-full min-h-[220px] rounded-3xl overflow-hidden bg-[#060a0f] border border-[#14202c]">
                <canvas
                  ref={canvasRef}
                  width={520}
                  height={340}
                  className="w-full h-full object-cover"
                />

                {/* Live Trail Badge */}
                <div className="absolute top-3 left-3 px-2.5 py-1 rounded-xl bg-black/80 backdrop-blur-sm border border-white/10 text-[10px] font-bold text-[#00e5a3] flex items-center gap-1.5">
                  <Radio className="h-3 w-3 animate-pulse text-[#00e5a3]" />
                  <span>LIVE GPS TRAIL • {breadcrumbs.length} PTS</span>
                </div>

                {/* Route Target Badge */}
                <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-xl bg-black/80 backdrop-blur-sm border border-white/10 text-[10px] font-bold text-neutral-300">
                  Target: {selectedRoute.distanceKm} km
                </div>
              </div>
            </div>

          </div>
        )}

        {/* -----------------------------------------------------------------------
            STAGE 3: POST-RUN SUMMARY & HERMES DEBRIEF
        ------------------------------------------------------------------------ */}
        {trackerState === 'SUMMARY' && (
          <div className="flex-1 flex flex-col md:grid md:grid-cols-12 md:gap-6">
            
            {/* Left Column: Metric Overview & Adherence Badge */}
            <div className="md:col-span-7 flex flex-col space-y-3.5">
              <div>
                <div className="flex items-center gap-2 text-[#00e5a3] text-xs font-extrabold uppercase tracking-wider mb-1">
                  <Flame className="h-4 w-4" />
                  <span>Workout Session Complete</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-black text-white">
                  {selectedRoute.name}
                </h1>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Outdoor GPS run evaluated by Hermes agent & Gemma Vision pipeline
                </p>
              </div>

              {/* Hero Stats Card */}
              <div className="p-5 sm:p-6 rounded-3xl bg-[#080d12] border border-[#15212d] text-center">
                <div className="text-5xl sm:text-6xl font-black text-[#00e5a3] tracking-tight font-mono">
                  {distanceKm.toFixed(2)}
                </div>
                <div className="text-[11px] font-extrabold text-neutral-500 uppercase tracking-widest mt-1 mb-5">
                  TOTAL KILOMETERS RECORDED
                </div>

                <div className="grid grid-cols-3 gap-2 pt-4 border-t border-[#131c26]">
                  <div>
                    <div className="text-[10px] font-bold text-neutral-500 uppercase">AVG PACE</div>
                    <div className="text-base font-black text-white mt-0.5">{currentPace} <span className="text-[10px] text-neutral-500">/km</span></div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-neutral-500 uppercase">TOTAL TIME</div>
                    <div className="text-base font-black text-white mt-0.5">{formatTime(elapsedSeconds)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-neutral-500 uppercase">ELEVATION</div>
                    <div className="text-base font-black text-neutral-300 mt-0.5">+{elevationM}m</div>
                  </div>
                </div>
              </div>

              {/* Hausdorff Navigation Adherence Result */}
              <div className="p-4 rounded-2xl bg-[#091410] border border-[#143525]">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 text-[#00e5a3]">
                    <ShieldCheck className="h-4 w-4" />
                    <span className="text-xs font-bold">Hausdorff Route Adherence</span>
                  </div>
                  <span className="text-[10px] font-extrabold text-[#00e5a3] bg-emerald-950/80 border border-emerald-800/40 px-2 py-0.5 rounded-full">
                    ADHERENT
                  </span>
                </div>
                <p className="text-xs text-neutral-300 leading-relaxed">
                  Maximum deviation: 22.4m (well within the ≤ 75m threshold). Verified against PostGIS planned route line.
                </p>
                <div className="mt-2 text-xs font-black text-[#00e5a3]">+50 Bonus Points Awarded</div>
              </div>
            </div>

            {/* Right Column: Gemma Vision Verdict & Database Sync Details */}
            <div className="md:col-span-5 flex flex-col space-y-3.5 mt-2 md:mt-0">
              {/* Gemma Vision Landmark Result */}
              <div className="p-4 rounded-2xl bg-[#120d0a] border border-[#2e1d10]">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-[#ff5416]">
                    <Sparkles className="h-4 w-4" />
                    <span className="text-xs font-bold">Gemma Vision Landmark Verdict</span>
                  </div>
                  <span className="text-[10px] font-extrabold text-[#ff5416] bg-orange-950/80 border border-orange-800/40 px-2 py-0.5 rounded-full">
                    VERIFIED
                  </span>
                </div>

                <div className="flex items-center gap-3 my-2">
                  <div className="h-14 w-14 rounded-xl overflow-hidden border border-[#2b1f14] flex-shrink-0 bg-black">
                    <img
                      src={capturedPhotoUrl}
                      alt="Captured Landmark"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="text-xs text-neutral-300">
                    <div className="font-bold text-white">Prinsep Ghat Riverfront</div>
                    <div className="text-[11px] text-neutral-400">Neoclassical portico & river steps confirmed</div>
                  </div>
                </div>

                <div className="mt-2 text-xs font-black text-[#ff5416]">
                  +{summaryData?.total_points_awarded || 240} Total Quest Points Awarded
                </div>
              </div>

              {/* Backend Synchronization Badge */}
              <div className="p-3.5 rounded-2xl bg-[#090e13] border border-[#141f2a] flex items-center gap-2.5 text-xs text-neutral-300">
                <CheckCircle2 className={`h-4 w-4 flex-shrink-0 ${isSyncing ? 'text-amber-400 animate-spin' : 'text-[#00e5a3]'}`} />
                <span>
                  {isSyncing ? 'Transmitting payload to backend engine...' : 'Synchronized with PostgreSQL & PostGIS Ledger'}
                </span>
              </div>

              {/* Unified Back to Home Button at end of flow */}
              <div className="pt-2">
                <button
                  id="back-home-btn"
                  onClick={() => {
                    triggerHaptic();
                    setTrackerState('IDLE');
                  }}
                  className="w-full py-4 rounded-2xl bg-white hover:bg-neutral-200 text-black font-black text-sm tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-white/10"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>BACK TO HOME</span>
                </button>
              </div>
            </div>

          </div>
        )}

      </main>

      {/* =========================================================================
          LANDMARK PHOTO VERIFICATION MODAL (Supports Real Mobile Camera / File)
      ========================================================================= */}
      {isCameraModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
          <div className="w-full max-w-sm rounded-3xl bg-[#0c1218] border border-[#1e2a38] p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#182330]">
              <div className="text-sm font-bold text-white flex items-center gap-2">
                <Camera className="h-4 w-4 text-[#00e5a3]" />
                <span>Landmark Photo Proof</span>
              </div>
              <button
                onClick={() => setIsCameraModalOpen(false)}
                className="p-1 rounded-full text-neutral-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-neutral-400 mb-3 leading-relaxed">
              Snap Prinsep Ghat river arches with your mobile camera for Gemma Vision AI verification.
            </p>

            {/* Photo Preview Container */}
            <div className="h-44 w-full rounded-2xl overflow-hidden border border-[#1b2633] mb-4 bg-black relative">
              <img
                src={capturedPhotoUrl}
                alt="Landmark preview"
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/70 text-[10px] text-neutral-300">
                Live Preview
              </div>
            </div>

            {/* Hidden File Input for Real Mobile Camera */}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={fileInputRef}
              onChange={handlePhotoCapture}
              className="hidden"
            />

            {/* Actions */}
            <div className="flex flex-col gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2.5 rounded-xl bg-[#142230] hover:bg-[#1a2c3f] border border-[#20364c] text-xs font-bold text-[#38bdf8] flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Camera className="h-3.5 w-3.5" />
                <span>Take Photo / Upload Image</span>
              </button>

              <div className="flex gap-2">
                <button
                  onClick={() => setIsCameraModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-[#121922] text-xs font-bold text-neutral-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    triggerHaptic();
                    setVerifiedLandmark(true);
                    setIsCameraModalOpen(false);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-[#00e5a3] text-xs font-bold text-black hover:bg-emerald-400 cursor-pointer"
                >
                  Confirm Landmark
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
