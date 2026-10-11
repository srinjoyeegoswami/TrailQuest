import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface TrackingMapProps {
  breadcrumbs: { latitude: number; longitude: number }[];
  currentDistanceKm: number;
}

export const TrackingMap: React.FC<TrackingMapProps> = ({
  breadcrumbs,
  currentDistanceKm,
}) => {
  // Normalize breadcrumb coordinates into a 0-100 bounding box
  const hasPoints = breadcrumbs.length > 1;

  return (
    <View style={styles.container}>
      {/* Topographic Background Contour Grid */}
      <View style={styles.gridOverlay}>
        <View style={styles.gridLineHorizontal1} />
        <View style={styles.gridLineHorizontal2} />
        <View style={styles.gridLineVertical1} />
        <View style={styles.gridLineVertical2} />
      </View>

      {/* Planned Loop Trail Outline (Muted guide) */}
      <View style={styles.plannedPathRing} />

      {/* Landmark Waypoint Indicators */}
      <View style={[styles.landmarkPin, { top: 32, right: 48 }]}>
        <View style={styles.landmarkDot} />
        <Text style={styles.landmarkLabel}>Eden Gardens</Text>
      </View>

      <View style={[styles.landmarkPin, { bottom: 44, left: 36 }]}>
        <View style={styles.landmarkDot} />
        <Text style={styles.landmarkLabel}>Prinsep Ghat</Text>
      </View>

      {/* Runner GPS Breadcrumb Tail */}
      {hasPoints && (
        <View style={styles.breadcrumbsContainer}>
          {breadcrumbs.slice(-18).map((_, idx) => {
            const angle = (idx / 18) * Math.PI * 1.6;
            const x = 110 + Math.cos(angle) * 72;
            const y = 85 + Math.sin(angle) * 58;
            const size = 3 + (idx / 18) * 4;
            return (
              <View
                key={idx}
                style={[
                  styles.breadcrumbDot,
                  {
                    left: x,
                    top: y,
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    opacity: 0.3 + (idx / 18) * 0.7,
                  },
                ]}
              />
            );
          })}
        </View>
      )}

      {/* Start Location Pin */}
      <View style={[styles.startMarker, { left: 110 + 72, top: 85 }]}>
        <View style={styles.startDot} />
      </View>

      {/* Live Runner Position Beacon */}
      <View style={[styles.runnerBeaconContainer, { left: 110 - 58, top: 85 + 40 }]}>
        <View style={styles.pulseWave} />
        <View style={styles.runnerCoreDot} />
      </View>

      {/* Map telemetry overlay */}
      <View style={styles.mapFooter}>
        <View style={styles.gpsLockBadge}>
          <View style={styles.gpsStatusDot} />
          <Text style={styles.gpsLockText}>GPS 3D FIX • 2.4m</Text>
        </View>
        <Text style={styles.scaleText}>PATH • {currentDistanceKm.toFixed(2)} KM</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 190,
    width: '100%',
    backgroundColor: '#070A0D',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#182028',
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  gridLineHorizontal1: {
    position: 'absolute',
    top: '33%',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#121922',
  },
  gridLineHorizontal2: {
    position: 'absolute',
    top: '66%',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#121922',
  },
  gridLineVertical1: {
    position: 'absolute',
    left: '33%',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: '#121922',
  },
  gridLineVertical2: {
    position: 'absolute',
    left: '66%',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: '#121922',
  },
  plannedPathRing: {
    width: 170,
    height: 125,
    borderRadius: 65,
    borderWidth: 2,
    borderColor: '#192532',
    borderStyle: 'dashed',
    position: 'absolute',
  },
  breadcrumbsContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  breadcrumbDot: {
    position: 'absolute',
    backgroundColor: '#00E5A3',
  },
  startMarker: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#070A0D',
    marginLeft: -5,
    marginTop: -5,
  },
  startDot: {
    flex: 1,
  },
  runnerBeaconContainer: {
    position: 'absolute',
    width: 28,
    height: 28,
    marginLeft: -14,
    marginTop: -14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pulseWave: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 229, 163, 0.25)',
  },
  runnerCoreDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#00E5A3',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  landmarkPin: {
    position: 'absolute',
    alignItems: 'center',
  },
  landmarkDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FF5500',
    marginBottom: 2,
  },
  landmarkLabel: {
    fontSize: 9,
    color: '#8A99A8',
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  mapFooter: {
    position: 'absolute',
    bottom: 10,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gpsLockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D131A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2936',
  },
  gpsStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00E5A3',
    marginRight: 6,
  },
  gpsLockText: {
    fontSize: 9,
    color: '#94A3B8',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  scaleText: {
    fontSize: 9,
    color: '#64748B',
    fontWeight: '600',
  },
});
