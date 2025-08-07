'use client';

import { Button } from '@/components/ui/button';
import { auth, provider } from '@/lib/firebase';
import { signInWithPopup } from 'firebase/auth';
import { useRouter } from 'next/navigation';

export default function LoginButton() {
  const router = useRouter();

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, provider);
      router.push('/'); // go to dashboard after login
    } catch (err) {
      console.error('Login failed:', err);
    }
  };

  return <Button onClick={handleLogin}>Continue with Google</Button>;
}
