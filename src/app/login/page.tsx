'use client';

import { auth, provider } from '@/lib/firebase';
import { signInWithPopup } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
  const router = useRouter();

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, provider);
      router.push('/');
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <main className="h-screen flex items-center justify-center">
      <Button onClick={handleLogin}>Sign in with Google</Button>
    </main>
  );
}
