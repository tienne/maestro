import React, { useEffect } from 'react';
import { TRPCProvider } from './providers/TRPCProvider';
import { ThemeProvider } from './components/ThemeProvider';
import { AppShell } from './components/layout/AppShell';
import { LoginScreen } from './components/auth/LoginScreen';
import { useAuthStore } from './store/authStore';

function AuthGate() {
  const { user, isLoading, initialize } = useAuthStore();

  useEffect(() => {
    void initialize();
  }, [initialize]);

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

  return <AppShell />;
}

export default function App(): React.ReactElement {
  return (
    <TRPCProvider>
      <ThemeProvider>
        <AuthGate />
      </ThemeProvider>
    </TRPCProvider>
  );
}
