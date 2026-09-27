/** The Vaultair mark: a chevron aimed toward the lower right. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 128" aria-hidden="true" className={className}>
      <path fill="currentColor" d="M43 0H68L125 111L117 122L0 68V38L80 73Z" />
    </svg>
  );
}
