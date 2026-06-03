import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { relaySocket, RelayStatus, Session } from '../lib/relaySocket';
import type { RootStackParamList } from '../types/navigation';
import { useTokens } from '../hooks/useTokens';
import { StatusIndicator } from '../components/StatusIndicator';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'SessionList'>;
};

const RELAY_STATUS_MAP: Record<RelayStatus, 'running' | 'idle' | 'danger'> = {
  connecting: 'idle',
  connected: 'running',
  disconnected: 'danger',
};

const RELAY_STATUS_LABEL: Record<RelayStatus, string> = {
  connecting: '연결 중...',
  connected: '연결됨',
  disconnected: '연결 안됨',
};

export function SessionListScreen({ navigation }: Props) {
  const { colors, spacing, radius } = useTokens();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [relayStatus, setRelayStatus] = useState<RelayStatus>('disconnected');
  const statusInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let removeHandler: (() => void) | null = null;

    const init = async () => {
      const { data } = await supabase.auth.getSession();
      const jwt = data.session?.access_token;
      if (!jwt) return;

      const relayUrl: string =
        Constants.expoConfig?.extra?.relayServerUrl ?? 'ws://localhost:3001';

      relaySocket.connect(jwt, relayUrl);

      removeHandler = relaySocket.addMessageHandler((msg) => {
        if (msg.type === 'session:list' && msg.data) {
          try {
            const parsed: Session[] = JSON.parse(msg.data);
            setSessions(parsed);
          } catch {
            // ignore parse failure
          }
        }
      });
    };

    init();

    statusInterval.current = setInterval(() => {
      setRelayStatus(relaySocket.status);
    }, 500);

    return () => {
      removeHandler?.();
      if (statusInterval.current) clearInterval(statusInterval.current);
      relaySocket.disconnect();
    };
  }, []);

  const handleLogout = useCallback(async () => {
    relaySocket.disconnect();
    await supabase.auth.signOut();
    navigation.replace('Login');
  }, [navigation]);

  const handleSessionPress = useCallback(
    (session: Session) => {
      navigation.navigate('Chat', { sessionId: session.id, sessionName: session.name });
    },
    [navigation],
  );

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xl,
      paddingTop: 60,
      paddingBottom: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 22,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: spacing.xxs,
    },
    logoutBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors['status-danger'],
    },
    logoutText: {
      color: colors['status-danger'],
      fontSize: 13,
      fontWeight: '500',
    },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyText: { fontSize: 15, color: colors.textMuted },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    itemIcon: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.md,
    },
    itemIconText: { fontSize: 18 },
    itemInfo: { flex: 1 },
    itemName: {
      fontSize: 15,
      fontWeight: '500',
      color: colors.textPrimary,
      marginBottom: 2,
    },
    itemDate: { fontSize: 12, color: colors.textMuted },
    itemArrow: { fontSize: 20, color: colors.textMuted },
  });

  const renderSession = ({ item }: { item: Session }) => (
    <TouchableOpacity style={s.item} onPress={() => handleSessionPress(item)} activeOpacity={0.7}>
      <View style={s.itemIcon}>
        <Text style={s.itemIconText}>⚡</Text>
      </View>
      <View style={s.itemInfo}>
        <Text style={s.itemName}>{item.name}</Text>
        <Text style={s.itemDate}>{new Date(item.createdAt).toLocaleString('ko-KR')}</Text>
      </View>
      <Text style={s.itemArrow}>›</Text>
    </TouchableOpacity>
  );

  return (
    <View style={s.container}>
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>세션 목록</Text>
          <StatusIndicator
            status={RELAY_STATUS_MAP[relayStatus]}
            size={7}
            showLabel
          />
        </View>
        <TouchableOpacity onPress={handleLogout} style={s.logoutBtn}>
          <Text style={s.logoutText}>로그아웃</Text>
        </TouchableOpacity>
      </View>

      {sessions.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>
            {relayStatus === 'connected' ? '실행 중인 세션이 없습니다.' : '데스크탑과 연결 중...'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderSession}
          contentContainerStyle={{ paddingVertical: spacing.sm }}
        />
      )}
    </View>
  );
}
