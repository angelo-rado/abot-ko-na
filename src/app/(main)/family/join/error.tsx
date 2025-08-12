'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="max-w-xl mx-auto p-6 space-y-3">
      <h1 className="text-lg font-semibold">Join page error</h1>
      <p className="text-sm text-muted-foreground">
        {error?.message || 'Something went wrong while loading this invite.'}
      </p>
      {!!error?.digest && (
        <p className="text-xs text-muted-foreground">Digest: {error.digest}</p>
      )}
      <button
        className="border rounded px-3 py-1 text-sm"
        onClick={() => reset()}
      >
        Try again
      </button>
    </div>
  )
}
