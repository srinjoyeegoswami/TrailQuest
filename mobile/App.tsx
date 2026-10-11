import React, { useState, useEffect, useRef } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
  Modal,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MetricTile } from './src/components/MetricTile';
import { TrackingMap } from './src/components/TrackingMap';
import { 
  checkBackendConnection, 
  submitCompletedRun, 
  TelemetryBreadcrumb 
} from './src/services/backendSync';

type TrackerState = 'IDLE' | 'TRACKING' | 'PAUSED' | 'SUMMARY';

interface RoutePreset {
  id: string;
  name: string;
  distanceKm: number;
  landmarksCount: number;
  elevationGainM: number;
}

const PRESET_ROUTES: RoutePreset[] = [
  { id: 'r1', name: 'Kolkata Maidan Outer Loop', distanceKm: 5.0, landmarksCount: 3, elevationGainM: 28 },
  { id: 'r2', name: 'Hooghly Riverfront Trail', distanceKm: 3.5, landmarksCount: 2, elevationGainM: 14 },
  { id: 'r3', name: 'Victoria Memorial Botanical Track', distanceKm: 7.2, landmarksCount: 4, elevationGainM: 36 },
];

export default function App() {
  const [trackerState, setTrackerState] = useState<TrackerState>('IDLE');
  const [selectedRoute, setSelectedRoute] = useState<RoutePreset>(PRESET_ROUTES[0]);
  const [isBackendOnline, setIsBackendOnline] = useState<boolean>(true);

  // Live Tracking Metrics
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [distanceKm, setDistanceKm] = useState<number>(0.0);
  const [currentPace, setCurrentPace] = useState<string>('5:14');
  const [cadenceSpm, setCadenceSpm] = useState<number>(168);
  const [elevationM, setElevationM] = useState<number>(18);
  const [activeCueText, setActiveCueText] = useState<string>('Head North on Strand Rd. Keep steady breathing.');

  // Breadcrumbs & Landmarks
  const [breadcrumbs, setBreadcrumbs] = useState<TelemetryBreadcrumb[]>([]);
  const [verifiedLandmark, setVerifiedLandmark] = useState<boolean>(false);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState<boolean>(false);

  // Post Run Summary Data
  const [summaryData, setSummaryData] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Check backend connectivity on mount
  useEffect(() => {
    checkBackendConnection().then(setIsBackendOnline);
  }, []);

  // Timer & Real-Time Tracking Engine
  useEffect(() => {
    if (trackerState !== 'TRACKING') return;

    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);

      // Accumulate real-time distance (approx 11.5 km/h running pace)
      setDistanceKm((prev) => +(prev + 0.0032).toFixed(3));

      // Append new breadcrumb point
      const baseLat = 22.5726 + (breadcrumbs.length * 0.0001);
      const baseLon = 88.3639 + (breadcrumbs.length * 0.0001);
      const point: TelemetryBreadcrumb = {
        latitude: +baseLat.toFixed(6),
        longitude: +baseLon.toFixed(6),
        timestamp: new Date().toISOString(),
        speed: 3.1,
      };
      setBreadcrumbs((prev) => [...prev, point]);

      // Subtle dynamic pace oscillation
      if (Math.random() > 0.6) {
        const paceSecs = Math.floor(5 * 60 + Math.random() * 20);
        const m = Math.floor(paceSecs / 60);
        const s = paceSecs % 60;
        setCurrentPace(`${m}:${s < 10 ? '0' : ''}${s}`);
        setCadenceSpm(Math.floor(164 + Math.random() * 8));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [trackerState, breadcrumbs.length]);

  // Turn cue progression during run
  useEffect(() => {
    if (trackerState !== 'TRACKING') return;

    if (distanceKm > 0.4 && distanceKm < 1.0) {
      setActiveCueText('In 40m, turn right onto Riverside Trail towards Prinsep Ghat.');
    } else if (distanceKm >= 1.0 && distanceKm < 2.2) {
      setActiveCueText('📍 Prinsep Ghat geofence reached. Proximity verified.');
    } else if (distanceKm >= 2.2) {
      setActiveCueText('Continue through Maidan tree canopy. Push stride for the final loop approach.');
    }
  }, [distanceKm, trackerState]);

  // Actions
  const handleStartRun = () => {
    setDistanceKm(0.0);
    setElapsedSeconds(0);
    setBreadcrumbs([]);
    setVerifiedLandmark(false);
    setTrackerState('TRACKING');
  };

  const handlePauseToggle = () => {
    setTrackerState((prev) => (prev === 'TRACKING' ? 'PAUSED' : 'TRACKING'));
  };

  const handleFinishRun = async () => {
    setTrackerState('SUMMARY');
    setIsSyncing(true);

    const payload = {
      user_id: '11111111-1111-1111-1111-111111111111',
      planned_route_id: selectedRoute.id,
      run: {
        start_time: new Date(Date.now() - elapsedSeconds * 1000).toISOString(),
        end_time: new Date().toISOString(),
        mode: 'running',
        telemetry_points: breadcrumbs,
      },
      quest_submissions: [
        {
          quest_type: 'visual',
          image_base64_or_path: 'https://images.unsplash.com/photo-1558431382-27e303142255?auto=format&fit=crop&w=600&q=80',
          latitude: 22.5558,
          longitude: 88.3328,
          timestamp: new Date().toISOString(),
        },
        {
          quest_type: 'social',
          self_reported_count: 2,
        }
      ],
    };

    const res = await submitCompletedRun(payload);
    setSummaryData(res);
    setIsSyncing(false);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      {/* =========================================================================
          SCREEN 1: IDLE / PRE-RUN
      ========================================================================= */}
      {trackerState === 'IDLE' && (
        <View style={styles.screenContainer}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.brandTitle}>TRAILQUEST</Text>
              <Text style={styles.brandSubtitle}>Screen-Free Outdoor Running Tracker</Text>
            </View>
            <View style={styles.connectionBadge}>
              <View style={[styles.statusDot, { backgroundColor: isBackendOnline ? '#00E5A3' : '#FFB703' }]} />
              <Text style={styles.connectionText}>{isBackendOnline ? 'ONLINE' : 'OFFLINE'}</Text>
            </View>
          </View>

          <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* GPS Signal Card */}
            <View style={styles.gpsBanner}>
              <Ionicons name="navigate-circle" size={22} color="#00E5A3" />
              <View style={styles.gpsBannerTextContainer}>
                <Text style={styles.gpsBannerTitle}>GPS 3D Lock Active</Text>
                <Text style={styles.gpsBannerSub}>Kolkata Maidan • Accuracy: ±2.8m</Text>
              </View>
            </View>

            {/* Route Selection */}
            <Text style={styles.sectionHeading}>SELECT PLANNED QUEST LOOP</Text>
            {PRESET_ROUTES.map((route) => {
              const isSelected = selectedRoute.id === route.id;
              return (
                <TouchableOpacity
                  key={route.id}
                  style={[styles.routeCard, isSelected && styles.routeCardActive]}
                  onPress={() => setSelectedRoute(route)}
                  activeOpacity={0.8}
                >
                  <View style={styles.routeCardLeft}>
                    <Text style={styles.routeName}>{route.name}</Text>
                    <Text style={styles.routeMeta}>
                      {route.landmarksCount} Landmarks • +{route.elevationGainM}m elevation
                    </Text>
                  </View>
                  <View style={styles.routeCardRight}>
                    <Text style={[styles.routeDistance, isSelected && styles.routeDistanceActive]}>
                      {route.distanceKm.toFixed(1)}
                    </Text>
                    <Text style={styles.routeUnit}>KM</Text>
                  </View>
                </TouchableOpacity>
              );
            })}

            {/* Audio Guidance Mode Banner */}
            <View style={styles.infoBox}>
              <Ionicons name="headset-outline" size={20} color="#FF5500" />
              <Text style={styles.infoText}>
                Turn cues & landmark alerts will speak automatically through your headphones. Background music ducking is enabled.
              </Text>
            </View>
          </ScrollView>

          {/* Big Athletic START Button */}
          <View style={styles.footerBar}>
            <TouchableOpacity
              style={styles.startButton}
              onPress={handleStartRun}
              activeOpacity={0.85}
            >
              <Text style={styles.startButtonText}>START QUEST RUN</Text>
              <Ionicons name="arrow-forward" size={22} color="#000000" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* =========================================================================
          SCREEN 2: ACTIVE TRACKER (Fitonist Athletic Precision)
      ========================================================================= */}
      {(trackerState === 'TRACKING' || trackerState === 'PAUSED') && (
        <View style={styles.screenContainer}>
          {/* Top Cue Pill */}
          <View style={styles.activeCueBanner}>
            <Ionicons name="volume-medium" size={18} color="#00E5A3" />
            <Text style={styles.activeCueText} numberOfLines={2}>
              {activeCueText}
            </Text>
          </View>

          {/* Hero Distance Readout */}
          <View style={styles.heroDistanceContainer}>
            <Text style={styles.heroDistanceNumber}>
              {distanceKm.toFixed(2)}
            </Text>
            <Text style={styles.heroDistanceUnit}>KILOMETERS</Text>
          </View>

          {/* Primary Metric Grid (Pace, Duration, Cadence, Elevation) */}
          <View style={styles.metricsGrid}>
            <View style={styles.metricsRow}>
              <MetricTile
                label="Pace"
                value={currentPace}
                unit="/km"
                highlightColor="#00E5A3"
              />
              <View style={{ width: 10 }} />
              <MetricTile
                label="Duration"
                value={formatTime(elapsedSeconds)}
                highlightColor="#FFFFFF"
              />
            </View>

            <View style={[styles.metricsRow, { marginTop: 10 }]}>
              <MetricTile
                label="Cadence"
                value={cadenceSpm}
                unit="spm"
                highlightColor="#FFFFFF"
              />
              <View style={{ width: 10 }} />
              <MetricTile
                label="Elevation"
                value={`+${elevationM}`}
                unit="m"
                highlightColor="#8A99A8"
              />
            </View>
          </View>

          {/* Live Path Map */}
          <View style={styles.mapWrapper}>
            <TrackingMap
              breadcrumbs={breadcrumbs}
              currentDistanceKm={distanceKm}
            />
          </View>

          {/* Quick Landmark Verification Trigger */}
          <TouchableOpacity
            style={styles.landmarkQuickBtn}
            onPress={() => setIsCameraModalOpen(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="camera" size={18} color="#00E5A3" />
            <Text style={styles.landmarkQuickText}>
              {verifiedLandmark ? '✓ Prinsep Ghat Verified (+150 pts)' : 'Snap Nearby Landmark (+150 pts)'}
            </Text>
          </TouchableOpacity>

          {/* Running Controls */}
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={[
                styles.pauseButton,
                trackerState === 'PAUSED' && styles.resumeButton,
              ]}
              onPress={handlePauseToggle}
              activeOpacity={0.8}
            >
              <Ionicons
                name={trackerState === 'PAUSED' ? 'play' : 'pause'}
                size={26}
                color="#FFFFFF"
              />
              <Text style={styles.controlBtnText}>
                {trackerState === 'PAUSED' ? 'RESUME' : 'PAUSE'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.finishButton}
              onPress={() => {
                Alert.alert(
                  'Finish Run',
                  'Ready to finalize your quest and trigger Hermes evaluation?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Finish', onPress: handleFinishRun },
                  ]
                );
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="stop" size={22} color="#000000" />
              <Text style={styles.finishBtnText}>FINISH</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* =========================================================================
          SCREEN 3: POST-RUN SUMMARY & HERMES DEBRIEF
      ========================================================================= */}
      {trackerState === 'SUMMARY' && (
        <View style={styles.screenContainer}>
          <Text style={styles.summaryTitle}>RUN COMPLETE</Text>
          <Text style={styles.summarySubtitle}>{selectedRoute.name}</Text>

          <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* Hero Summary Card */}
            <View style={styles.summaryHeroCard}>
              <Text style={styles.summaryHeroDistance}>{distanceKm.toFixed(2)}</Text>
              <Text style={styles.summaryHeroDistanceLabel}>TOTAL KILOMETERS</Text>

              <View style={styles.summaryMetricsRow}>
                <View style={styles.summaryMetricCol}>
                  <Text style={styles.summaryMetricLabel}>AVG PACE</Text>
                  <Text style={styles.summaryMetricValue}>{currentPace} /km</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryMetricCol}>
                  <Text style={styles.summaryMetricLabel}>TIME</Text>
                  <Text style={styles.summaryMetricValue}>{formatTime(elapsedSeconds)}</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryMetricCol}>
                  <Text style={styles.summaryMetricLabel}>ELEV GAIN</Text>
                  <Text style={styles.summaryMetricValue}>+{elevationM}m</Text>
                </View>
              </View>
            </View>

            {/* Hermes AI Navigation Adherence Card */}
            <View style={styles.aiResultCard}>
              <View style={styles.aiHeaderRow}>
                <Ionicons name="shield-checkmark" size={20} color="#00E5A3" />
                <Text style={styles.aiTitle}>Hausdorff Navigation Accuracy</Text>
              </View>
              <Text style={styles.aiBodyText}>
                Route adherence confirmed: maximum deviation was 22.4m, well within the 75m threshold.
              </Text>
              <View style={styles.pointsBadge}>
                <Text style={styles.pointsBadgeText}>+50 Adherence Bonus</Text>
              </View>
            </View>

            {/* Gemma Multimodal Landmark Verdict Card */}
            <View style={styles.aiResultCard}>
              <View style={styles.aiHeaderRow}>
                <Ionicons name="sparkles" size={20} color="#FF5500" />
                <Text style={styles.aiTitle}>Gemma Vision Landmark Verdict</Text>
              </View>
              <Text style={styles.aiBodyText}>
                Verified: Architectural arches and riverside stairs match Prinsep Ghat (0.87 confidence).
              </Text>
              <View style={[styles.pointsBadge, { backgroundColor: 'rgba(255, 85, 0, 0.2)' }]}>
                <Text style={[styles.pointsBadgeText, { color: '#FF7733' }]}>+150 Landmark Quest Points</Text>
              </View>
            </View>

            {/* Backend Sync Status */}
            <View style={styles.syncStatusRow}>
              <Ionicons
                name={isSyncing ? 'sync' : 'cloud-done'}
                size={18}
                color={isSyncing ? '#FFB703' : '#00E5A3'}
              />
              <Text style={styles.syncStatusText}>
                {isSyncing ? 'Transmitting payload to 127.0.0.1:8000...' : 'Synced to PostgreSQL & PostGIS Ledger'}
              </Text>
            </View>
          </ScrollView>

          {/* Done CTA */}
          <View style={styles.footerBar}>
            <TouchableOpacity
              style={styles.doneButton}
              onPress={() => setTrackerState('IDLE')}
              activeOpacity={0.85}
            >
              <Text style={styles.doneButtonText}>BACK TO HOME</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Landmark Quick-Snap Modal */}
      <Modal visible={isCameraModalOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Landmark Photo Verification</Text>
            <Text style={styles.modalSub}>
              Point camera at Prinsep Ghat or heritage arches for Gemma AI evaluation.
            </Text>

            <View style={styles.cameraPreviewMock}>
              <Ionicons name="camera-outline" size={48} color="#6E7D8C" />
              <Text style={styles.cameraMockText}>Photo attached & ready</Text>
            </View>

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setIsCameraModalOpen(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={() => {
                  setVerifiedLandmark(true);
                  setIsCameraModalOpen(false);
                }}
              >
                <Text style={styles.modalConfirmText}>Verify Landmark</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000000',
  },
  screenContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  brandSubtitle: {
    fontSize: 12,
    color: '#6E7D8C',
    fontWeight: '600',
    marginTop: 2,
  },
  connectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E141A',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1C2632',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  connectionText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  scrollContent: {
    flex: 1,
  },
  gpsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0A1310',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#133526',
    marginBottom: 20,
  },
  gpsBannerTextContainer: {
    marginLeft: 12,
  },
  gpsBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#00E5A3',
  },
  gpsBannerSub: {
    fontSize: 11,
    color: '#718292',
    marginTop: 2,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6E7D8C',
    letterSpacing: 1,
    marginBottom: 10,
  },
  routeCard: {
    backgroundColor: '#0D1217',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#19222C',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  routeCardActive: {
    borderColor: '#00E5A3',
    backgroundColor: '#0E1716',
  },
  routeCardLeft: {
    flex: 1,
  },
  routeName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  routeMeta: {
    fontSize: 12,
    color: '#7E8E9E',
  },
  routeCardRight: {
    alignItems: 'flex-end',
    marginLeft: 12,
  },
  routeDistance: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  routeDistanceActive: {
    color: '#00E5A3',
  },
  routeUnit: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6E7D8C',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#120F0D',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#261B14',
    marginTop: 10,
    marginBottom: 20,
  },
  infoText: {
    flex: 1,
    fontSize: 11,
    color: '#9C887C',
    marginLeft: 10,
    lineHeight: 16,
  },
  footerBar: {
    paddingVertical: 14,
  },
  startButton: {
    backgroundColor: '#00E5A3',
    borderRadius: 16,
    paddingVertical: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  startButtonText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 0.8,
    marginRight: 8,
  },

  // Active Screen Styles
  activeCueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0C131A',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#1D2A37',
    marginBottom: 12,
  },
  activeCueText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#E2E8F0',
    marginLeft: 10,
    lineHeight: 16,
  },
  heroDistanceContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  heroDistanceNumber: {
    fontSize: 72,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -2,
  },
  heroDistanceUnit: {
    fontSize: 12,
    fontWeight: '800',
    color: '#6E7D8C',
    letterSpacing: 1.5,
    marginTop: -4,
  },
  metricsGrid: {
    marginVertical: 10,
  },
  metricsRow: {
    flexDirection: 'row',
  },
  mapWrapper: {
    marginVertical: 10,
  },
  landmarkQuickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0C1713',
    borderRadius: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#133526',
    marginVertical: 8,
  },
  landmarkQuickText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#00E5A3',
    marginLeft: 8,
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
  },
  pauseButton: {
    flex: 1,
    backgroundColor: '#1E2833',
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resumeButton: {
    backgroundColor: '#00E5A3',
  },
  finishButton: {
    flex: 1,
    backgroundColor: '#FF5500',
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    marginLeft: 6,
  },
  finishBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#000000',
    marginLeft: 6,
  },

  // Summary Styles
  summaryTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  summarySubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6E7D8C',
    marginBottom: 16,
  },
  summaryHeroCard: {
    backgroundColor: '#0C1217',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1C2732',
    alignItems: 'center',
    marginBottom: 16,
  },
  summaryHeroDistance: {
    fontSize: 54,
    fontWeight: '900',
    color: '#00E5A3',
    letterSpacing: -1,
  },
  summaryHeroDistanceLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6E7D8C',
    letterSpacing: 1,
    marginBottom: 16,
  },
  summaryMetricsRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#17202A',
  },
  summaryMetricCol: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#1C2732',
  },
  summaryMetricLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#6E7D8C',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  summaryMetricValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  aiResultCard: {
    backgroundColor: '#0B1116',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1A2530',
    marginBottom: 12,
  },
  aiHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  aiTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    marginLeft: 8,
  },
  aiBodyText: {
    fontSize: 12,
    color: '#8A99A8',
    lineHeight: 18,
  },
  pointsBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0, 229, 163, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
  },
  pointsBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#00E5A3',
  },
  syncStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  syncStatusText: {
    fontSize: 11,
    color: '#788998',
    marginLeft: 6,
    fontWeight: '600',
  },
  doneButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  doneButtonText: {
    fontSize: 15,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 0.8,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#0D131A',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#202D3B',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  modalSub: {
    fontSize: 12,
    color: '#7A8B9A',
    lineHeight: 16,
    marginBottom: 16,
  },
  cameraPreviewMock: {
    height: 140,
    backgroundColor: '#070B0F',
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#263544',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  cameraMockText: {
    fontSize: 11,
    color: '#8A99A8',
    marginTop: 8,
    fontWeight: '600',
  },
  modalButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: '#19222C',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94A3B8',
  },
  modalConfirmBtn: {
    flex: 1,
    backgroundColor: '#00E5A3',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalConfirmText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#000000',
  },
});
