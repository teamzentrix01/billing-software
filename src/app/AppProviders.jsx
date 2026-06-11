'use client';

import { UserProvider } from '@/hooks/useUser';
import { OfflineSyncProvider } from '@/contexts/OfflineSyncContext';
import OfflineIndicator from '@/components/OfflineIndicator';
import PWARegister from '@/components/PWARegister';
import PasswordChangeWatcher from '@/components/PasswordChangeWatcher';
import AppAlertDialog from '@/components/AppAlertDialog';

export default function AppProviders({ children }) {
  return (
    <UserProvider>
      <OfflineSyncProvider>
        {children}
        <OfflineIndicator />
        <PasswordChangeWatcher />
        <AppAlertDialog />
        <PWARegister />
      </OfflineSyncProvider>
    </UserProvider>
  );
}
