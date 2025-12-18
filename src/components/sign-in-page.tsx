
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '@/lib/firebase';

function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="24px" height="24px" {...props}>
            <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z" />
            <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z" />
            <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.222,0-9.619-3.317-11.28-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z" />
        </svg>
    );
}

export function SignInPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
        toast({ title: 'Success!', description: 'Successfully signed in with Google.' });
        router.push('/');
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Google Sign-In Error', description: error.message });
    } finally {
        setIsLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <Card className="w-[400px]">
            <CardHeader className="text-center">
                <div className="flex justify-center mb-4">
                    <div className='flex items-center gap-2'>
                        <Building2 className="text-primary h-8 w-8" />
                        <h1 className="text-3xl font-headline font-bold">Key Stone AI</h1>
                    </div>
                </div>
                <CardTitle>Welcome</CardTitle>
                <CardDescription>Sign in to access your projects.</CardDescription>
            </CardHeader>
            <CardContent>
                <Button variant="outline" className="w-full" onClick={handleGoogleSignIn} disabled={isLoading}>
                    {isLoading ? 'Signing in...' : <><GoogleIcon className="mr-2"/> Sign in with Google</>}
                </Button>
            </CardContent>
        </Card>
    </div>
  );
}
