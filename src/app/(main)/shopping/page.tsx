'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Plus, Trash2, ShoppingCart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/lib/useAuth'
import { useSelectedFamily } from '@/lib/selected-family'
import {
  subscribeToShoppingList,
  addShoppingItem,
  setShoppingItemDone,
  deleteShoppingItem,
  clearCompletedItems,
} from '@/lib/shopping'
import type { ShoppingItem } from '@/lib/models/shopping'

export default function ShoppingListPage() {
  const { user, loading: authLoading } = useAuth()
  const { familyId, families, loadingFamilies } = useSelectedFamily()

  const [items, setItems] = useState<ShoppingItem[]>([])
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [adding, setAdding] = useState(false)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    if (!familyId) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = subscribeToShoppingList(
      familyId,
      (rows) => {
        setItems(rows)
        setLoading(false)
      },
      () => setLoading(false)
    )
    return () => unsub()
  }, [familyId])

  const active = items.filter((i) => !i.done)
  const completed = items.filter((i) => i.done)

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || !familyId) return
    setAdding(true)
    try {
      await addShoppingItem(familyId, {
        name: trimmed,
        quantity: quantity.trim() || null,
        createdByName: user?.name ?? null,
      })
      setName('')
      setQuantity('')
    } catch {
      toast.error('Could not add item')
    } finally {
      setAdding(false)
    }
  }

  const handleToggle = async (item: ShoppingItem) => {
    if (!familyId) return
    try {
      await setShoppingItemDone(familyId, item.id, !item.done, user?.name ?? null)
    } catch {
      toast.error('Could not update item')
    }
  }

  const handleDelete = async (item: ShoppingItem) => {
    if (!familyId) return
    try {
      await deleteShoppingItem(familyId, item.id)
    } catch {
      toast.error('Could not delete item')
    }
  }

  const handleClearCompleted = async () => {
    if (!familyId || completed.length === 0) return
    setClearing(true)
    try {
      const n = await clearCompletedItems(familyId)
      if (n > 0) toast.success(`Cleared ${n} completed item${n > 1 ? 's' : ''}`)
    } catch {
      toast.error('Could not clear completed items')
    } finally {
      setClearing(false)
    }
  }

  const renderItem = (item: ShoppingItem) => (
    <motion.li
      key={item.id}
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.18 }}
      className="flex items-start gap-3 py-2"
    >
      <Checkbox
        checked={item.done}
        onCheckedChange={() => handleToggle(item)}
        className="mt-1"
        aria-label={item.done ? 'Mark as not done' : 'Mark as done'}
      />
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-medium truncate ${item.done ? 'line-through text-muted-foreground' : ''}`}>
          {item.name}
          {item.quantity && <span className="ml-2 text-xs font-normal text-muted-foreground">× {item.quantity}</span>}
        </div>
        <div className="text-[11px] text-muted-foreground truncate">
          {item.done
            ? `Done${item.completedByName ? ` by ${item.completedByName}` : ''}${item.completedAt ? ` · ${formatDistanceToNow(item.completedAt, { addSuffix: true })}` : ''}`
            : `Added${item.createdByName ? ` by ${item.createdByName}` : ''}${item.createdAt ? ` · ${formatDistanceToNow(item.createdAt, { addSuffix: true })}` : ''}`}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => handleDelete(item)}
        title="Remove"
        className="shrink-0 h-8 w-8"
      >
        <Trash2 className="h-4 w-4" />
        <span className="sr-only">Remove</span>
      </Button>
    </motion.li>
  )

  if (authLoading || loadingFamilies) {
    return (
      <main className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  return (
    <main className="max-w-2xl mx-auto px-5 py-8 space-y-7">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-muted-foreground hover:text-foreground" aria-label="Back to home">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <ShoppingCart className="h-5 w-5" />
          Shopping List
        </h1>
      </div>

      {!familyId ? (
        <Card>
          <CardContent className="py-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              {families.length === 0
                ? 'Create or join a family to start a shared shopping list.'
                : 'Set a default family in Settings to use the shopping list.'}
            </p>
            <Link href={families.length === 0 ? '/family' : '/settings#default-family'}>
              <Button variant="outline" size="sm">
                {families.length === 0 ? 'Go to Family' : 'Open Settings'}
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Add an item (e.g. Rice)"
              className="flex-1"
              autoFocus
            />
            <Input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Qty (optional)"
              className="sm:w-32"
            />
            <Button type="submit" disabled={adding || !name.trim()}>
              <Plus className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Add</span>
            </Button>
          </form>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Your shopping list is empty. Add the first item above.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    To buy {active.length > 0 && <span className="text-muted-foreground font-normal">({active.length})</span>}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {active.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing left to buy. 🎉</p>
                  ) : (
                    <ul className="divide-y divide-border/60">
                      <AnimatePresence initial={false}>{active.map(renderItem)}</AnimatePresence>
                    </ul>
                  )}
                </CardContent>
              </Card>

              {completed.length > 0 && (
                <Card>
                  <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-base">
                      Completed <span className="text-muted-foreground font-normal">({completed.length})</span>
                    </CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleClearCompleted}
                      disabled={clearing}
                    >
                      {clearing ? 'Clearing…' : 'Clear'}
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <ul className="divide-y divide-border/60">
                      <AnimatePresence initial={false}>{completed.map(renderItem)}</AnimatePresence>
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </main>
  )
}
