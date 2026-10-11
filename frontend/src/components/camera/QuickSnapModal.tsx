import React, { useState } from 'react';
import { Camera, X, Check, Image as ImageIcon, Sparkles } from 'lucide-react';
import type { Landmark } from '../../services/api';

interface QuickSnapModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPhotoCaptured: (photoData: { base64: string; landmarkId?: string; landmarkName?: string }) => void;
  nearbyLandmark?: Landmark;
}

export const QuickSnapModal: React.FC<QuickSnapModalProps> = ({
  isOpen,
  onClose,
  onPhotoCaptured,
  nearbyLandmark,
}) => {
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  if (!isOpen) return null;

  // Curated demo landmark photos for instant zero-hassle testing
  const SAMPLE_PHOTOS = [
    {
      title: 'Victoria Memorial Dome',
      url: 'https://images.unsplash.com/photo-1558431382-27e303142255?auto=format&fit=crop&w=600&q=80',
    },
    {
      title: 'Prinsep Ghat River Arches',
      url: 'https://images.unsplash.com/photo-1608889825103-eb5ed706fc64?auto=format&fit=crop&w=600&q=80',
    },
    {
      title: 'Heritage Flora & Greenery',
      url: 'https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?auto=format&fit=crop&w=600&q=80',
    }
  ];

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleConfirm = () => {
    if (previewImage) {
      onPhotoCaptured({
        base64: previewImage,
        landmarkId: nearbyLandmark?.id,
        landmarkName: nearbyLandmark?.name || 'Curated Landmark',
      });
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-sm rounded-3xl border border-[#273544] bg-[#0c1219] p-5 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#1b2531]">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-[#3db86b]" />
            <h3 className="font-display font-bold text-white text-base">
              Landmark Quick-Snap
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Target Landmark Indicator */}
        <div className="my-3 rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Target: {nearbyLandmark?.name || 'Nearest Regional Geofence'}</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400 line-clamp-2">
            {nearbyLandmark?.target_description || 'Snap architectural portico, heritage clock tower, or regional flora.'}
          </p>
        </div>

        {/* Viewfinder Area */}
        <div className="relative my-3 h-52 w-full overflow-hidden rounded-2xl border-2 border-dashed border-[#2b3a4a] bg-[#121922] flex items-center justify-center">
          {previewImage ? (
            <img
              src={previewImage}
              alt="Landmark preview"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-center p-4">
              <Camera className="h-10 w-10 text-slate-500 animate-pulse" />
              <span className="text-xs text-slate-400">
                Select a sample photo or upload from camera
              </span>
            </div>
          )}

          {/* Crosshair Viewfinder overlays */}
          <div className="pointer-events-none absolute inset-3 border border-white/20 rounded-xl" />
        </div>

        {/* Quick Sample Selector */}
        <div className="mb-4">
          <span className="text-[11px] font-semibold text-slate-400 block mb-1.5">
            Quick Sample Photos (Simulated Camera):
          </span>
          <div className="grid grid-cols-3 gap-2">
            {SAMPLE_PHOTOS.map((sample, i) => (
              <button
                key={i}
                onClick={() => setPreviewImage(sample.url)}
                className={`overflow-hidden rounded-lg border text-left text-[10px] transition-all ${
                  previewImage === sample.url
                    ? 'border-[#3db86b] ring-2 ring-[#3db86b]/40'
                    : 'border-[#223140] hover:border-slate-500'
                }`}
              >
                <img
                  src={sample.url}
                  alt={sample.title}
                  className="h-12 w-full object-cover"
                />
                <span className="block truncate px-1 py-0.5 text-slate-300">
                  {sample.title.split(' ')[0]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <label className="flex-1 cursor-pointer">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileUpload}
              className="hidden"
            />
            <span className="flex items-center justify-center gap-1.5 rounded-xl border border-[#2b3a4a] bg-[#151e29] py-2.5 text-xs font-semibold text-white hover:bg-[#1c2735]">
              <ImageIcon className="h-4 w-4 text-[#38bdf8]" />
              Upload Photo
            </span>
          </label>

          <button
            onClick={handleConfirm}
            disabled={!previewImage}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-display font-bold text-white transition-all ${
              previewImage
                ? 'bg-gradient-to-r from-[#3db86b] to-emerald-600 shadow-lg shadow-emerald-900/50 hover:brightness-110'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            <Check className="h-4 w-4" />
            Attach & Verify
          </button>
        </div>
      </div>
    </div>
  );
};
