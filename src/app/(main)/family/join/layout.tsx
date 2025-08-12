export default function JoinRouteLayout({ children }: { children: React.ReactNode }) {
  // Minimal wrapper — no global ThemeProvider/Nav/etc so we can isolate crashes
  return <>{children}</>
}
