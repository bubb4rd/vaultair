/** The Vaultair mark: a dial ring with a center point. Simple geometry, matches the app icon. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <rect width="24" height="24" rx="6" fill="var(--foreground)" />
      <circle cx="12" cy="12" r="6.25" fill="none" stroke="var(--background)" strokeWidth="1.75" />
      <circle cx="12" cy="12" r="1.6" fill="var(--background)" />
    </svg>
  );
}
