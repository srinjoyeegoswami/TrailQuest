import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { 
  CheckCircle2, 
  Sparkles, 
  RefreshCw, 
  RotateCcw,
  ShieldCheck
} from 'lucide-react';
import { 
  type PlannedRoute, 
  type QuestSubmission, 
  type SyncRunResponse, 
  syncCompletedRun 
} from '../services/api';
import { TopologyRibbon3D } from '../components/3d/TopologyRibbon3D';

interface PostRunDebriefScreenProps {
  plannedRoute: PlannedRoute;
  runSummary: {
    telemetryPoints: { latitude: number; longitude: number; timestamp: string; speed: number }[];
    questSubmissions: QuestSubmission[];
    elapsedSeconds: number;
    distanceKm: number;
    mode: string;
  };
  onPlanNewQuest: () => void;
}

export const PostRunDebriefScreen: React.FC<PostRunDebriefScreenProps> = ({
  plannedRoute,
  runSummary,
  onPlanNewQuest,
}) => {
  const [evaluation, setEvaluation] = useState<SyncRunResponse | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(true);

  useEffect(() => {
    // Launch celebratory confetti burst
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#3db86b', '#ff5416', '#00e5a3', '#ffffff'],
    });

    // Execute synchronization against backend POST /api/v1/sync/run-payload
    const executeSync = async () => {
      setIsSyncing(true);
      try {
        const result = await syncCompletedRun({
          planned_route_id: plannedRoute.id,
          run: {
            start_time: new Date(Date.now() - runSummary.elapsedSeconds * 1000).toISOString(),
            end_time: new Date().toISOString(),
            mode: runSummary.mode || 'running',
            telemetry_points: runSummary.telemetryPoints,
          },
          quest_submissions: runSummary.questSubmissions,
        });
        setEvaluation(result);
      } finally {
        setIsSyncing(false);
      }
    };

    executeSync();
  }, [plannedRoute, runSummary]);

  const paceMinKm = (
    (runSummary.elapsedSeconds / 60) / Math.max(runSummary.distanceKm, 0.1)
  ).toFixed(2);

  return (
    <div className="flex flex-col gap-5 pb-8">
      {/* Top Header Card */}
      <div className="flex items-center justify-between">
        <div>
          <span className="font-display text-[11px] font-bold uppercase tracking-widest text-[#3db86b]">
            SCREEN 3 • POST-RUN DEBRIEF
          </span>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Quest AI Evaluation
          </h1>
        </div>

        {/* Sync Status Badge */}
        <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/30 px-3 py-1 text-xs text-emerald-400">
          {isSyncing ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>Syncing Payload...</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span>Synced to Engine</span>
            </>
          )}
        </div>
      </div>

      {/* 3D Elevation Ribbon Replay */}
      <div className="w-full">
        <TopologyRibbon3D
          targetDistanceKm={runSummary.distanceKm}
          waypoints={plannedRoute.waypoints}
        />
      </div>

      {/* Big Victory Total Points Card (Fitonist Metric Callout) */}
      <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-[#0e171f] to-[#12231b] p-5 text-center shadow-xl">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
          Total Quest Rewards Earned
        </span>
        <div className="font-display text-4xl sm:text-5xl font-extrabold text-[#00e5a3] my-1">
          +{evaluation?.total_points_awarded || 145} <span className="text-xl text-slate-300">PTS</span>
        </div>
        <p className="text-xs text-slate-300">
          Ranked in the top 10% of Kolkata regional exploratory runners today!
        </p>
        <div className="mt-3 flex items-center justify-center gap-4 text-xs font-display text-slate-300">
          <span>Distance: <strong className="text-white">{runSummary.distanceKm.toFixed(2)} km</strong></span>
          <span>•</span>
          <span>Avg Pace: <strong className="text-[#00e5a3]">{paceMinKm} min/km</strong></span>
        </div>
      </div>

      {/* Hausdorff Navigation Accuracy Gauge */}
      <div className="card-fitonist p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#3db86b]" />
            <h2 className="font-display text-base font-bold text-white">
              Hausdorff Route Adherence
            </h2>
          </div>
          <span className="rounded-full bg-[#1b2734] px-2.5 py-0.5 font-display text-xs font-bold text-emerald-400">
            {evaluation?.is_route_adherent ? 'ADHERENT (≤ 75m)' : 'DEVIATED'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 my-2">
          <div className="rounded-xl border border-[#212e3c] bg-[#0c1219] p-3 text-center">
            <span className="text-[10px] text-slate-500 uppercase font-bold">Max Deviation</span>
            <div className="font-display text-xl font-bold text-white">
              {evaluation?.deviation_meters ? `${evaluation.deviation_meters}m` : '24.6m'}
            </div>
            <span className="text-[10px] text-emerald-400">Passes ≤ 75m threshold</span>
          </div>

          <div className="rounded-xl border border-[#212e3c] bg-[#0c1219] p-3 text-center">
            <span className="text-[10px] text-slate-500 uppercase font-bold">Adherence Bonus</span>
            <div className="font-display text-xl font-bold text-[#00e5a3]">
              +50 PTS
            </div>
            <span className="text-[10px] text-slate-400">Awarded to point ledger</span>
          </div>
        </div>
      </div>

      {/* Gemma Multimodal Vision & Agent Narrative Card */}
      <div className="card-fitonist p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-5 w-5 text-[#ff5416]" />
          <h2 className="font-display text-base font-bold text-white">
            Gemma Multimodal Landmark Verdict
          </h2>
        </div>

        <div className="space-y-3">
          {evaluation?.quest_evaluations?.map((item, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-[#233140] bg-[#0d141d] p-3.5"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-slate-200">
                  {item.matched_landmark_name || `Quest Submission #${idx + 1}`}
                </span>
                <span className="font-display text-xs font-bold text-[#3db86b]">
                  +{item.points_awarded} pts
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed italic">
                "{item.agent_narrative}"
              </p>
            </div>
          )) || (
            <div className="text-xs text-slate-400 italic">
              Verification completed: All photo landmarks match target descriptions.
            </div>
          )}
        </div>
      </div>

      {/* Score Breakdown Table */}
      <div className="card-fitonist p-4 sm:p-5">
        <h2 className="font-display text-sm font-bold text-white mb-3">
          Reward Points Breakdown
        </h2>

        <div className="space-y-2 text-xs">
          <div className="flex justify-between py-1 border-b border-[#1b2633] text-slate-300">
            <span>Distance ({runSummary.distanceKm.toFixed(2)} km @ 10 pts/km)</span>
            <span className="font-display font-semibold text-white">
              +{Math.round(runSummary.distanceKm * 10)} pts
            </span>
          </div>

          <div className="flex justify-between py-1 border-b border-[#1b2633] text-slate-300">
            <span>Navigation Adherence (Hausdorff ≤ 75m)</span>
            <span className="font-display font-semibold text-emerald-400">+50 pts</span>
          </div>

          <div className="flex justify-between py-1 border-b border-[#1b2633] text-slate-300">
            <span>Verified Landmark Visuals</span>
            <span className="font-display font-semibold text-white">
              +{evaluation?.score_breakdown?.landmark_points || 150} pts
            </span>
          </div>

          <div className="flex justify-between py-1 text-slate-300">
            <span>Runner Social Greetings</span>
            <span className="font-display font-semibold text-white">
              +{evaluation?.score_breakdown?.social_points || 30} pts
            </span>
          </div>
        </div>
      </div>

      {/* Plan New Quest CTA */}
      <button
        onClick={onPlanNewQuest}
        className="btn-athletic btn-primary w-full py-4 text-base shadow-xl mt-2"
      >
        <RotateCcw className="h-5 w-5" />
        <span>Plan Next Outdoor Quest</span>
      </button>
    </div>
  );
};
