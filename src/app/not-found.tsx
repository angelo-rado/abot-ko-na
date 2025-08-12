// app/not-found.tsx
import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="max-w-md mx-auto p-8 text-center">
      <h1 className="text-2xl font-semibold mb-2">Page not found</h1>
      <p className="text-muted-foreground mb-6">
        The page you’re looking for doesn’t exist.
      </p>
      <Link
        href="/"
        className="inline-flex items-center rounded-lg px-4 py-2 border hover:bg-accent transition"
      >
        Go home
      </Link>
    </div>
  )
}
