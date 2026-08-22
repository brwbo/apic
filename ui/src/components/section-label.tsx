/**
 * A label set in the mono face against display headings and Inter body copy -
 * the contrast does the work. Deliberately sentence case at normal tracking:
 * UPPERCASE + wide tracking on a mono micro-label is the template tell.
 */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[13px] text-primary/85">{children}</p>
  );
}

export default SectionLabel;
