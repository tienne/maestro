import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { LoginScreen } from './screens/LoginScreen';
import { SessionListScreen } from './screens/SessionListScreen';
import { ChatScreen } from './screens/ChatScreen';
import type { RootStackParamList } from './types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 초기 세션 확인
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    // 인증 상태 변경 구독 (토큰 갱신, 로그아웃 등)
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return null; // 스플래시 스크린 대기
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={session ? 'SessionList' : 'Login'}
        screenOptions={{
          headerStyle: { backgroundColor: '#0d0d1a' },
          headerTintColor: '#e0e0ff',
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: '#0d0d1a' },
        }}
      >
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="SessionList"
          component={SessionListScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Chat"
          component={ChatScreen}
          options={{ title: '세션' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
