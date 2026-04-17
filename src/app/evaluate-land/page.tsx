'use client';

import { useEffect } from 'react';
import { redirect } from 'next/navigation';

import { EvaluateLandWorkspace } from '@/components/evaluate-land-workspace';
import { SignInPage } from '@/components/sign-in-page';
import { Toaster } from '@/components/ui/toaster';
import { useAuth } from '@/hooks/use-auth-store';

export default function EvaluateLandPage() {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) {
      redirect('/sign-in');
    }
  }, [user, isLoading]);

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center">Loading...</div>;
  }

  if (!user) {
    return <SignInPage />;
  }

  return (
    <>
      <EvaluateLandWorkspace />
      <Toaster />
    </>
  );
}
