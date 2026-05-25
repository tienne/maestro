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

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'SessionList'>;
};

const STATUS_LABEL: Record<RelayStatus, string> = {
  connecting: '연결 중...',
  connected: '연결됨',
  disconnected: '연결 안됨',
};

const STATUS_COLOR: Record<RelayStatus, string> = {
  connecting: '#f0c040',
  connected: '#4caf50',
  disconnected: '#ff6b6b',
};

export function SessionListScreen({ navigation }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [status, setStatus] = useState<RelayStatus>('disconnected');
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
            // 파싱 실패 무시
          }
        }
      });
    };

    init();

    // relay 연결 상태 폴링 (500ms 간격)
    statusInterval.current = setInterval(() => {
      setStatus(relaySocket.status);
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
      navigation.navigate('Chat', {
        sessionId: session.id,
        sessionName: session.name,
      });
    },
    [navigation]
  );

  const renderSession = ({ item }: { item: Session }) => (
    <TouchableOpacity
      style={styles.sessionItem}
      onPress={() => handleSessionPress(item)}
      activeOpacity={0.7}
    >
      <View style={styles.sessionIcon}>
        <Text style={styles.sessionIconText}>⚡</Text>
      </View>
      <View style={styles.sessionInfo}>
        <Text style={styles.sessionName}>{item.name}</Text>
        <Text style={styles.sessionDate}>
          {new Date(item.createdAt).toLocaleString('ko-KR')}
        </Text>
      </View>
      <Text style={styles.sessionArrow}>›</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>세션 목록</Text>
          <View style={styles.statusBadge}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: STATUS_COLOR[status] },
              ]}
            />
            <Text style={[styles.statusText, { color: STATUS_COLOR[status] }]}>
              {STATUS_LABEL[status]}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </TouchableOpacity>
      </View>

      {sessions.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {status === 'connected'
              ? '실행 중인 세션이 없습니다.'
              : '데스크탑과 연결 중...'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderSession}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d1a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a3e',
  },
  headerLeft: {
    gap: 4,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#e0e0ff',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  logoutBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ff6b6b',
  },
  logoutText: {
    color: '#ff6b6b',
    fontSize: 13,
    fontWeight: '500',
  },
  list: {
    paddingVertical: 8,
  },
  sessionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  sessionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1a1a3e',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  sessionIconText: {
    fontSize: 20,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#e0e0ff',
    marginBottom: 2,
  },
  sessionDate: {
    fontSize: 12,
    color: '#6666aa',
  },
  sessionArrow: {
    fontSize: 24,
    color: '#6666aa',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: '#6666aa',
  },
});
