import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface MetricTileProps {
  label: string;
  value: string | number;
  unit?: string;
  highlightColor?: string;
  size?: 'normal' | 'hero';
}

export const MetricTile: React.FC<MetricTileProps> = ({
  label,
  value,
  unit,
  highlightColor = '#FFFFFF',
  size = 'normal',
}) => {
  const isHero = size === 'hero';

  return (
    <View style={[styles.container, isHero && styles.heroContainer]}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <View style={styles.valueRow}>
        <Text style={[styles.value, { color: highlightColor }, isHero && styles.heroValue]}>
          {value}
        </Text>
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0D1217',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#19222C',
    flex: 1,
  },
  heroContainer: {
    backgroundColor: '#0A0F14',
    paddingVertical: 20,
    alignItems: 'center',
    borderColor: '#202C38',
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6E7D8C',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  value: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  heroValue: {
    fontSize: 64,
    fontWeight: '900',
    letterSpacing: -1.5,
  },
  unit: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A99A8',
    marginLeft: 6,
  },
});
