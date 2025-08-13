'use client'
import * as React from 'react'

type State = { err?: Error; info?: any }

export default class PageErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = {}

  static getDerivedStateFromError(err: Error): State {
    return { err }
  }

  componentDidCatch(err: Error, info: any) {
    this.setState({ err, info })
    // Make sure it also lands in the console/logs
    // eslint-disable-next-line no-console
    console.error('[Join ErrorBoundary]', err, info)
  }

  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 16, maxWidth: 900, margin: '40px auto', fontFamily: 'ui-sans-serif, system-ui' }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Join page crashed</h1>
          <p style={{ marginBottom: 8 }}>
            <strong>Message:</strong>{' '}
            <code>{String(this.state.err.message)}</code>
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
