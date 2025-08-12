'use client'

import { Suspense } from 'react'
import FamilyJoinPageContent from './FamilyJoinPageContent'

export const dynamic = 'force-dynamic'

// Inline error boundary so we avoid import/module issues
class PageErrorBoundary extends (require('react') as typeof import('react')).Component<
  { children: React.ReactNode },
  { err?: Error; info?: any }
> {
  state = { err: undefined as Error | undefined, info: undefined as any }

  static getDerivedStateFromError(err: Error) {
    return { err }
  }

  componentDidCatch(err: Error, info: any) {
    // Also dump to console
    // eslint-disable-next-line no-console
    console.error('[Join ErrorBoundary]', err, info)
    this.setState({ err, info })
  }

  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 16, maxWidth: 900, margin: '40px auto', fontFamily: 'ui-sans-serif, system-ui' }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Join page crashed</h1>
          <p style={{ marginBottom: 8 }}>
            <strong>Message:</strong> <code>{String(this.state.err.message)}</code>
          </p>
          <details style={{ whiteSpace: 'pre-wrap' }}>
            <summary style={{ cursor: 'pointer' }}>Stack</summary>
            <pre>{String(this.state.err.stack ?? '')}</pre>
          </details>
          <button
            onClick={() => location.reload()}
            style={{ marginTop: 12, padding: '6px 10px', border: '1px solid #ccc', borderRadius: 6 }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function FamilyJoinPage() {
  return (
    <PageErrorBoundary>
      <Suspense fallback={<div className="max-w-xl mx-auto p-6 text-center">Loading…</div>}>
        <FamilyJoinPageContent />
      </Suspense>
    </PageErrorBoundary>
  )
}
