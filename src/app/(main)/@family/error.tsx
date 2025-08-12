'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function FamilySlotError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    // Surface in logs
    console.error('[Family slot error]', error);
  }, [error]);

  return (
    <div className="max-w-md mx-auto p-6 space-y-3">
      <h2 className="text-lg font-semibold">Couldn’t load this page</h2>
      <p className="text-sm text-muted-foreground">Something went wrong while loading the family view.</p>
      <Button type="button" onClick={() => reset()}>Try again</Button>
    </div>
  );
}
