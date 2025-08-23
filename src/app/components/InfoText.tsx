
export default function InfoText({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed"
      role="note"
      aria-live="polite"
    >
      {children}
    </p>
  )
}

