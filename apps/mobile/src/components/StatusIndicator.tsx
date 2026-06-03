import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, Text } from 'react-native';
import { colors } from '@maestro/tokens';

export type StatusType = 'running' | 'idle' | 'success' | 'warning' | 'danger' | 'completed';

const STATUS_COLOR: Record<StatusType, string> = {
  running: colors['status-running'],
  idle: colors['status-idle'],
  success: colors['status-success'],
  warning: colors['status-warning'],
  danger: colors['status-danger'],
  completed: colors['status-completed'],
};

const STATUS_LABEL: Record<StatusType, string> = {
  running: 'running',
  idle: 'idle',
  success: 'success',
  warning: 'warning',
  danger: 'error',
  completed: 'completed',
};

interface Props {
  status: StatusType;
  size?: number;
  showLabel?: boolean;
}

export function StatusIndicator({ status, size = 8, showLabel = false }: Props) {
  const color = STATUS_COLOR[status];
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (status !== 'running') {
      opacity.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 750, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [status, opacity]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.dot,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity },
        ]}
        accessibilityLabel={STATUS_LABEL[status]}
      />
      {showLabel && (
        <Text style={[styles.label, { color }]}>{STATUS_LABEL[status]}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    flexShrink: 0,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
  },
});
