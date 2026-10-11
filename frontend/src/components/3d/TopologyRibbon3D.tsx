import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Mountain, RotateCcw, Compass } from 'lucide-react';
import type { Landmark } from '../../services/api';

interface TopologyRibbonProps {
  coordinates?: [number, number][]; // [lon, lat]
  elevationProfile?: { dist_km: number; elevation_m: number }[];
  waypoints?: Landmark[];
  targetDistanceKm?: number;
  interactive?: boolean;
}

export const TopologyRibbon3D: React.FC<TopologyRibbonProps> = ({
  elevationProfile = [],
  waypoints = [],
  targetDistanceKm = 5.0,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const animationFrameId = useRef<number | null>(null);

  const [scrubPercent, setScrubPercent] = useState<number>(0);
  const [selectedWaypoint, setSelectedWaypoint] = useState<string | null>(null);
  const [isRotating, setIsRotating] = useState<boolean>(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 360;
    const height = container.clientHeight || 260;

    // 1. Scene & Camera setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 22, 28);
    camera.lookAt(0, 0, 0);

    // 2. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const rootGroup = new THREE.Group();
    groupRef.current = rootGroup;
    scene.add(rootGroup);

    // 3. Grid & Contour Rings (Organimo Topo Vibe)
    const gridHelper = new THREE.GridHelper(30, 15, 0x22303c, 0x141d24);
    gridHelper.position.y = -2;
    rootGroup.add(gridHelper);

    // 4. Extruded 3D Ribbon generation from Elevation Profile
    const pointsCount = Math.max(elevationProfile.length, 20);
    const curvePoints: THREE.Vector3[] = [];

    for (let i = 0; i <= pointsCount; i++) {
      const t = i / pointsCount;
      const angle = t * Math.PI * 2;
      const radius = 10 + Math.sin(angle * 3) * 2.2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      // Realistic elevation undulating between 0 and 6 units
      const elev = (elevationProfile[i % elevationProfile.length]?.elevation_m || 15) * 0.18;
      curvePoints.push(new THREE.Vector3(x, elev, z));
    }

    const curve = new THREE.CatmullRomCurve3(curvePoints, true);

    // 5. Extruded Tube Geometry for ribbon
    const tubeGeo = new THREE.TubeGeometry(curve, 90, 0.42, 8, true);
    
    // Shader or Gradient Material (Fitonist Emerald to Blaze Orange)
    const tubeMat = new THREE.MeshStandardMaterial({
      color: 0x3db86b,
      emissive: 0x143d22,
      roughness: 0.25,
      metalness: 0.65,
    });
    const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
    rootGroup.add(tubeMesh);

    // 6. Glowing Waypoint Pins
    waypoints.forEach((_wp, idx) => {
      const t = (idx + 1) / (waypoints.length + 1);
      const point = curve.getPointAt(t);

      // Pin stem
      const pinGeo = new THREE.CylinderGeometry(0.08, 0.08, 3, 8);
      const pinMat = new THREE.MeshBasicMaterial({ color: 0xff5416 });
      const pin = new THREE.Mesh(pinGeo, pinMat);
      pin.position.set(point.x, point.y + 1.5, point.z);
      rootGroup.add(pin);

      // Floating beacon sphere
      const sphereGeo = new THREE.SphereGeometry(0.65, 16, 16);
      const sphereMat = new THREE.MeshStandardMaterial({
        color: 0xff5416,
        emissive: 0xff5416,
        emissiveIntensity: 0.8,
      });
      const sphere = new THREE.Mesh(sphereGeo, sphereMat);
      sphere.position.set(point.x, point.y + 3, point.z);
      rootGroup.add(sphere);
    });

    // 7. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x00e5a3, 1.8);
    dirLight.position.set(15, 25, 20);
    scene.add(dirLight);

    const orangeBeacon = new THREE.PointLight(0xff5416, 2.5, 30);
    orangeBeacon.position.set(0, 10, 0);
    scene.add(orangeBeacon);

    // 8. Animation Loop
    let rotAngle = 0;
    const animate = () => {
      animationFrameId.current = requestAnimationFrame(animate);

      if (rootGroup && isRotating) {
        rotAngle += 0.006;
        rootGroup.rotation.y = rotAngle;
      }

      renderer.render(scene, camera);
    };
    animate();

    // 9. Resize observer
    const handleResize = () => {
      if (!container || !renderer) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      if (rendererRef.current && container) {
        rendererRef.current.dispose();
        container.innerHTML = '';
      }
    };
  }, [elevationProfile, waypoints, isRotating]);

  // Handle scrubber
  const currentScrubElevation = Math.round(12 + Math.sin(scrubPercent * 0.08) * 16);
  const currentScrubDistance = ((scrubPercent / 100) * targetDistanceKm).toFixed(2);

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-[#202b36] bg-[#0c1117] shadow-2xl">
      {/* 3D Canvas Viewport */}
      <div
        ref={containerRef}
        className="relative h-64 w-full cursor-grab active:cursor-grabbing sm:h-72"
        style={{ touchAction: 'none' }}
      />

      {/* Top Overlay Badge */}
      <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full border border-white/10 bg-[#080d12]/80 px-3 py-1.5 backdrop-blur-md">
        <Compass className="h-4 w-4 text-[#3db86b] animate-spin-slow" />
        <span className="font-display text-xs font-semibold tracking-wider text-emerald-400">
          3D TOPO RIBBON • {targetDistanceKm} KM LOOP
        </span>
      </div>

      {/* Control Buttons */}
      <div className="absolute right-3 top-3 flex items-center gap-1.5">
        <button
          onClick={() => setIsRotating(!isRotating)}
          title="Toggle Auto-Rotation"
          className={`flex h-8 w-8 items-center justify-center rounded-lg border text-xs transition-colors ${
            isRotating
              ? 'border-[#3db86b]/40 bg-[#3db86b]/20 text-[#3db86b]'
              : 'border-[#263544] bg-[#141b24] text-slate-400'
          }`}
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>

      {/* Bottom Interactive Elevation Scrubber */}
      <div className="border-t border-[#1a232e] bg-[#0f151d]/90 p-3.5 backdrop-blur-md">
        <div className="mb-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-slate-300">
            <Mountain className="h-4 w-4 text-[#ff5416]" />
            <span className="font-display font-medium text-slate-400">Scrubber Position:</span>
            <span className="font-display font-bold text-white">{currentScrubDistance} km</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">Elevation:</span>
            <span className="rounded bg-[#1a2634] px-2 py-0.5 font-display text-xs font-bold text-[#00e5a3]">
              {currentScrubElevation}m
            </span>
          </div>
        </div>

        {/* Range Slider */}
        <input
          type="range"
          min="0"
          max="100"
          value={scrubPercent}
          onChange={(e) => setScrubPercent(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-[#1e293b] accent-[#3db86b]"
        />

        {/* Landmark Quick Chips */}
        <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
          <span className="flex-shrink-0 text-slate-500">Waypoints:</span>
          {waypoints.map((wp) => (
            <button
              key={wp.id}
              onClick={() => setSelectedWaypoint(wp.name)}
              className={`flex-shrink-0 rounded-full border px-2.5 py-1 font-medium transition-colors ${
                selectedWaypoint === wp.name
                  ? 'border-[#ff5416] bg-[#ff5416]/20 text-orange-300'
                  : 'border-[#243342] bg-[#131b24] text-slate-300 hover:border-slate-500'
              }`}
            >
              📍 {wp.name.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
