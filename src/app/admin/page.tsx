
'use client';

import { useAuth } from '@/hooks/use-auth-store';
import { redirect } from 'next/navigation';
import { useEffect } from 'react';
import { AdminPanel } from '@/components/admin-panel';
import { Building2, ShieldAlert } from 'lucide-react';

const ADMIN_EMAILS = [
    'screentechnicals@gmail.com',
    'anon.skulll@gmail.com',
    'keystone.office02@gmail.com'
];

export default function AdminPage() {
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
        return <div className="flex items-center justify-center h-screen">Redirecting...</div>;
    }

    if (!ADMIN_EMAILS.includes(user.email || '')) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-background text-foreground">
                <div className='flex items-center gap-2'>
                    <Building2 className="text-primary h-8 w-8" />
                    <h1 className="text-3xl font-headline font-bold">Key Stone AI</h1>
                </div>
                <div className="mt-8 text-center p-8 border border-destructive/50 bg-destructive/10 rounded-lg max-w-md">
                    <ShieldAlert className="h-12 w-12 text-destructive mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-destructive-foreground">Access Denied</h2>
                    <p className="text-muted-foreground mt-2">
                        You do not have permission to access this page. Please contact the administrator if you believe this is an error.
                    </p>
                </div>
            </div>
        );
    }


    return <AdminPanel />;
}
