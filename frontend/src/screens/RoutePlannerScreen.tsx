import React, { useState } from 'react';
import { 
  Compass, 
  Sliders, 
  Sparkles, 
  Navigation, 
  Trees, 
  Flower2, 
  Landmark as LandmarkIcon, 
  Mountain,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { 
  CURATED_REGIONAL_LANDMARKS, 
  type PlannedRoute, 
  planQuestRun 
} from '../services/api';
import { TopologyRibbon3D } from '../components/3d/TopologyRibbon3D';

interface RoutePlannerScreenProps {
  onStartRun: (route: PlannedRoute) => void;
  isBackendOnline: boolean;
}

export const RoutePlannerScreen: React.FC<RoutePlannerScreenProps> = ({
  onStartRun,
  isBackendOnline,
}) => {
  const [originLat, setOriginLat] = useState<number>(22.5726);
  const [originLon, setOriginLon] = useState<number>(88.3639);
  const [targetDistanceKm, setTargetDistanceKm] = useState<number>(5.0);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(['park', 'flora']);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Available Category Tags
  const CATEGORIES = [
    { id: 'park', label: 'Park', icon: Trees },
    { id: 'flora', label: 'Flora', icon: Flower2 },
    { id: 'heritage', label: 'Heritage', icon: LandmarkIcon },
    { id: 'scenic_view', label: 'Scenic View', icon: Mountain },
  ];

  const toggleCategory = (catId: string) => {
    if (selectedCategories.includes(catId)) {
      if (selectedCategories.length > 1) {
        setSelectedCategories(selectedCategories.filter(c => c !== catId));
      }
    } else {
      setSelectedCategories([...selectedCategories, catId]);
    }
  };

  const handleUseCurrentLocation = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setOriginLat(+pos.coords.latitude.toFixed(4));
          setOriginLon(+pos.coords.longitude.toFixed(4));
        },
        () => {
          // Keep Kolkata center
          setOriginLat(22.5726);
          setOriginLon(88.3639);
        }
      );
    }
  };

  const handleBeginQuest = async () => {
    setIsLoading(true);
    try {
      const planned = await planQuestRun({
        origin: { latitude: originLat, longitude: originLon },
        max_distance_km: targetDistanceKm,
        desired_categories: selectedCategories,
      });
      onStartRun(planned);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 pb-8">
      {/* Top Header Card */}
      <div className="flex items-center justify-between">
        <div>
          <span className="font-display text-[11px] font-bold uppercase tracking-widest text-[#3db86b]">
            SCREEN 1 • PRE-RUN
          </span>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Quest Route Planner
          </h1>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-[#121820] px-3 py-1.5 text-xs">
          <span
            className={`h-2 w-2 rounded-full ${
              isBackendOnline ? 'bg-emerald-400' : 'bg-amber-400'
            }`}
          />
          <span className="font-display font-medium text-slate-300">
            {isBackendOnline ? 'PostGIS Active' : 'Offline Ready'}
          </span>
        </div>
      </div>

      {/* 3D Route Topology Ribbon Canvas */}
      <div className="w-full">
        <TopologyRibbon3D
          targetDistanceKm={targetDistanceKm}
          waypoints={CURATED_REGIONAL_LANDMARKS.slice(0, 3)}
        />
      </div>

      {/* Origin GPS & Distance Config Card */}
      <div className="card-fitonist p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-[#3db86b]" />
            <h2 className="font-display text-base font-bold text-white">
              Origin & Target Range
            </h2>
          </div>
          <button
            onClick={handleUseCurrentLocation}
            className="flex items-center gap-1 text-xs font-semibold text-[#00e5a3] hover:underline"
          >
            <Navigation className="h-3.5 w-3.5" />
            <span>Use GPS</span>
          </button>
        </div>

        {/* GPS Coordinate Display */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-[#202c38] bg-[#0c1117] p-2.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase">Latitude</span>
            <div className="font-display text-sm font-semibold text-slate-200">
              {originLat}° N
            </div>
          </div>
          <div className="rounded-xl border border-[#202c38] bg-[#0c1117] p-2.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase">Longitude</span>
            <div className="font-display text-sm font-semibold text-slate-200">
              {originLon}° E
            </div>
          </div>
        </div>

        {/* Target Distance Slider */}
        <div className="mb-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Target Closed-Loop Distance</span>
            <span className="font-display text-lg font-bold text-[#ff5416]">
              {targetDistanceKm.toFixed(1)} km
            </span>
          </div>
          <input
            type="range"
            min="2.0"
            max="12.0"
            step="0.5"
            value={targetDistanceKm}
            onChange={(e) => setTargetDistanceKm(Number(e.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-[#1a2530] accent-[#ff5416]"
          />
          <div className="mt-1 flex justify-between text-[10px] text-slate-500 font-display">
            <span>2 km (Sprint)</span>
            <span>5 km (Standard Quest)</span>
            <span>12 km (Endurance)</span>
          </div>
        </div>
      </div>

      {/* Category Filter Tags */}
      <div className="card-fitonist p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <Sliders className="h-4 w-4 text-[#3db86b]" />
          <h2 className="font-display text-sm font-bold text-white">
            Waypoint Curation Filters
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isSelected = selectedCategories.includes(cat.id);
            return (
              <button
                key={cat.id}
                onClick={() => toggleCategory(cat.id)}
                className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-display font-semibold transition-all ${
                  isSelected
                    ? 'border-[#3db86b] bg-[#3db86b]/15 text-[#3db86b] shadow-sm shadow-emerald-900/30'
                    : 'border-[#202c38] bg-[#10161f] text-slate-400 hover:border-slate-600'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Curated Waypoints Carousel */}
      <div className="card-fitonist p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#ff5416]" />
            <h2 className="font-display text-sm font-bold text-white">
              Discovered Cultural Anchors
            </h2>
          </div>
          <span className="text-[11px] text-slate-500 font-medium">Pan-India Overpass Miner</span>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-2">
          {CURATED_REGIONAL_LANDMARKS.map((landmark) => (
            <div
              key={landmark.id}
              className="flex-shrink-0 w-60 rounded-xl border border-[#212d3a] bg-[#0d131a] p-3.5 hover:border-[#3db86b]/50 transition-colors"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="rounded-full bg-[#1b2632] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  {landmark.category}
                </span>
                <span className="text-[10px] font-display font-bold text-slate-400">
                  +{landmark.elevation_meters}m elev
                </span>
              </div>
              <h3 className="font-display text-sm font-bold text-white truncate">
                {landmark.name}
              </h3>
              <p className="mt-1 text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                {landmark.target_description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Big Action CTA: Begin Quest */}
      <button
        onClick={handleBeginQuest}
        disabled={isLoading}
        className="btn-athletic btn-primary w-full py-4 text-base shadow-xl"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Compiling OSRM Route & Audio Maneuvers...</span>
          </>
        ) : (
          <>
            <span>Begin Quest ({targetDistanceKm} km)</span>
            <ChevronRight className="h-5 w-5" />
          </>
        )}
      </button>
    </div>
  );
};
