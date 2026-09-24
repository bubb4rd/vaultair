import { Kbd, KbdGroup } from "@/components/ui/kbd";

/** Renders a shortcut like ["Ctrl", "K"] as keycaps, with a readable label for screen readers. */
export function KeyboardHint({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <KbdGroup className={className} aria-label={keys.join("+")}>
      {keys.map((k) => (
        <Kbd key={k} aria-hidden="true">
          {k}
        </Kbd>
      ))}
    </KbdGroup>
  );
}
