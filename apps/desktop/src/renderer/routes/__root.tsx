import React, { useEffect } from 'react';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { TRPCProvider } from '../providers/TRPCProvider';
import { ThemeProvider } from '../components/ThemeProvider';
import { LoginScreen } from '../components/auth/LoginScreen';
import { useAuthStore } from '../store/authStore';
import { useAnthropicAuthStore } from '../store/anthropicAuthStore';
import { isSupabaseConfigured } from '../lib/supabase';

function AuthGate() {
  const { user, isLoading, initialize } = useAuthStore();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    useAnthropicAuthStore.getState().initialize();
    return () => {
      useAnthropicAuthStore.getState().cleanup();
    };
  }, []);

  if (!isSupabaseConfigured) {
    return <Outlet />;
  }

  if (isLoading) {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ backgroundColor: 'var(--bg-primary)' }}
      >
        <div
          className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  if (user === null) {
    return <LoginScreen />;
  }

  return <Outlet />;
}

function RootComponent() {
  return (
    <TRPCProvider>
      <ThemeProvider>
        <AuthGate />
      </ThemeProvider>
    </TRPCProvider>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});
