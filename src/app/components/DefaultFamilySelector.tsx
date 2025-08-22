'use client';

import { useEffect, useMemo, useState } from 'react';
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
  const { families, familyId, setFamilyId, loadingFamilies } = useSelectedFamily();

  // Local resolved name for the currently selected family, used when provider hasn't hydrated names yet.
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [loadingName, setLoadingName] = useState(false);

  // Name from provider if available
  const providerName = useMemo(
    () => (familyId ? families.find((f) => f.id === familyId)?.name || null : null),
    [families, familyId]
  );

  // Make sure we have a human label for the current familyId
  useEffect(() => {
    let cancelled = false;

    async function hydrateName(id: string) {
      if (!id) return;
      // If provider already has the name, use it and stop
      if (providerName) {
        setResolvedName(providerName);
        return;
      }
      // Otherwise fetch just this family's name once (best-effort)
      setLoadingName(true);
      try {
        const snap = await getDoc(doc(firestore, 'families', id));
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data() as any;
          const name = typeof data?.name === 'string' ? data.name : null;
          setResolvedName(name);
        } else {
          setResolvedName(null);
        }
      } catch {
        if (!cancelled) setResolvedName(null);
      } finally {
        if (!cancelled) setLoadingName(false);
      }
    }

    if (!familyId) {
      setResolvedName(null);
      setLoadingName(false);
      return;
    }

    hydrateName(familyId);
    return () => {
      cancelled = true;
    };
  }, [familyId, providerName]);

  const currentLabel =
    providerName ??
    resolvedName ??
    (familyId ? 'Family' : 'None'); // never show the UID

  const onChange = async (value: string) => {
    const next = value || null;
    await setFamilyId(next);
    // Provide instant, correct label without flashing the UID
    if (!next) {
      setResolvedName(null);
      toast.success('Default family cleared');
      return;
    }
    // Prefer provider name if already present; otherwise keep existing resolvedName or fetch
    const fromProvider = families.find((f) => f.id === next)?.name || null;
    if (fromProvider) {
      setResolvedName(fromProvider);
      toast.success('Default family updated');
      return;
    }
    try {
      const snap = await getDoc(doc(firestore, 'families', next));
      const name = snap.exists() ? (snap.data() as any)?.name : null;
      setResolvedName(typeof name === 'string' ? name : null);
      toast.success('Default family updated');
    } catch {
      // silently ignore; provider will catch up
      toast.success('Default family updated');
    }
  };

  if (loadingFamilies && !familyId) {
    return (
      <div className="space-y-2">
        <Label className="text-sm">Default family</Label>
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  // Create the list of items, sorted by name (falling back to id order if name is missing)
  const items = useMemo(() => {
    const copy = [...families];
    copy.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return copy;
  }, [families]);

  // If the selected familyId isn't in the provider list yet, inject a temporary item
  const includeEphemeralSelected =
    familyId && !items.some((f) => f.id === familyId) && (providerName || resolvedName);

  return (
    <div className="space-y-2">
      <Label className="text-sm">Default family</Label>

      <Select value={familyId ?? ''} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          {/* We never show the raw ID here */}
          <SelectValue placeholder={loadingName ? 'Loading…' : 'Choose a family'}>
            {loadingName ? 'Loading…' : currentLabel}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">None</SelectItem>
          {includeEphemeralSelected && (
            <SelectItem key={`__current-${familyId}`} value={familyId!}>
              {providerName || resolvedName || 'Family'}
            </SelectItem>
          )}
          {items.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.name || 'Untitled family'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        This is used across Home and Deliveries by default. You can still browse other families from their pages.
      </p>
    </div>
  );
}
