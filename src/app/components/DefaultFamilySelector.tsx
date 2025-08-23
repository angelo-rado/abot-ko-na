'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { firestore } from '@/lib/firebase';
import { useSelectedFamily } from '@/lib/selected-family';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

/**
 * DefaultFamilySelector
 * - Shows the user's default family by NAME (never the raw UID).
 * - If the provider hasn't loaded family names yet, we best-effort fetch the selected family's name.
 * - Lets the user change or clear their default; persists via useSelectedFamily().setFamilyId.
 */
export default function DefaultFamilySelector() {
  const { families, loadingFamilies, familyId, setFamilyId } = useSelectedFamily();

  // Resolved display name for the currently selected family
  const providerName = !familyId ? null : (families.find((x) => x.id === familyId)?.name ?? null)

  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [loadingName, setLoadingName] = useState(false);
  const NONE = '__none__'

  // If provider didn't give us a name for the selected id yet, fetch it once.
  useEffect(() => {
    let cancelled = false;
    async function ensureName() {
      setResolvedName(null);
      if (!familyId) return;
      if (providerName) {
        setResolvedName(providerName);
        return;
      }
      try {
        setLoadingName(true);
        const snap = await getDoc(doc(firestore, 'families', familyId));
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data() as any;
          const name = typeof data?.name === 'string' ? data.name : null;
          setResolvedName(name);
        } else {
          setResolvedName(null);
        }
      } catch {
        setResolvedName(null);
      } finally {
        if (!cancelled) setLoadingName(false);
      }
    }
    ensureName();
    return () => { cancelled = true };
  }, [familyId, providerName]);

  const display = resolvedName ?? providerName ?? (familyId ? 'Untitled family' : null);

  const handleChange = async (id: string) => {
    try {
      const resolved = id === NONE ? null : id
      await setFamilyId(resolved)
      toast.success('Default family updated')
    } catch {
      toast.error('Failed to update default family')
    }
  }

  // Loading skeleton if we haven't determined anything yet and no selection
  if (loadingFamilies && !familyId) {
    return (
      <div className="space-y-2">
        <Label className="text-sm">Default family</Label>
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  // Build items list sorted by name (fallback to id for stable order)
  const items = [...families].sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  return (
    <div className="space-y-2">
      <Label className="text-sm">Default family</Label>
      <Select
        value={familyId ?? ''}                  // unchanged
        onValueChange={(val) => handleChange(val)}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={loadingName ? 'Loading…' : (display ?? 'Select a family')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem key="__none" value={NONE}>
            <span className="text-muted-foreground">— None —</span>
          </SelectItem>

          {items.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.name || 'Untitled family'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        This sets your default family used across Home and Deliveries. You can still browse others from their pages.
      </p>
    </div>
  );
}
