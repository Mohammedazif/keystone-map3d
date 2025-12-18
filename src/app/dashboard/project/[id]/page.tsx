'use client';
import { GeoConstructApp } from '@/components/geoconstruct-app';
import { useAuth } from '@/hooks/use-auth-store';
import { redirect, useParams } from 'next/navigation';
import { useEffect } from 'react';

export default function ProjectPage() {
  const params = useParams();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) {
      redirect("/sign-in");
    }
  }, [user, isLoading]);

  if (isLoading || !user) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  if (!projectId) {
    return <div className="flex items-center justify-center h-screen">Project ID not found.</div>;
  }

  return <GeoConstructApp projectId={projectId} />;
}
