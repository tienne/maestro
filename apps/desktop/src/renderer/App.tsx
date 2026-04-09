import React from 'react';
import { TRPCProvider } from './providers/TRPCProvider';
import { ThemeProvider } from './components/ThemeProvider';
import { AppShell } from './components/layout/AppShell';

export default function App(): React.ReactElement {
  return (
    <TRPCProvider>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </TRPCProvider>
  );
}
