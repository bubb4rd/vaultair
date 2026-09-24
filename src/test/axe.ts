import axe from "axe-core";

/** Runs axe on a container and returns readable violation summaries (empty = pass). */
export async function axeViolations(container: Element): Promise<string[]> {
  const results = await axe.run(container, {
    // jsdom can't compute colors reliably; contrast is measured in docs/design-system.md.
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)} nodes)`);
}
