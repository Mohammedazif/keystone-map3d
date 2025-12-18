'use client';

import { useAuth } from '@/hooks/use-auth-store';
import { DashboardClient } from '@/components/dashboard-client';
import { redirect } from 'next/navigation';
import { SignInPage } from '@/components/sign-in-page';
import { useEffect } from 'react';

export default function DashboardPage() {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) {
      redirect('/sign-in');
    }
  }, [user, isLoading]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }
  
  if (!user) {
    return <SignInPage />;
  }

  return <DashboardClient />;
}
