export const dynamic = 'force-dynamic';

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  // Minimal wrapper so nothing else touches this page
  return <>{children}</>;
}
