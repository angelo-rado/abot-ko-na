// app/not-found.tsx
export default function NotFound() {
  return (
    <div style={{ maxWidth: 480, margin: '3rem auto', textAlign: 'center' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Page not found</h1>
      <p style={{ opacity: 0.7, marginBottom: 16 }}>
        The page you’re looking for doesn’t exist.
      </p>
      <a
        href="/"
        style={{
          display: 'inline-block',
          padding: '8px 12px',
          border: '1px solid #ccc',
          borderRadius: 8,
          textDecoration: 'none',
        }}
      >
        Go home
      </a>
    </div>
  )
}
