/** Decorative crops from the supplied design reference, never player records. */
export function PlaybookArt({ variant, className = "" }: { variant: "header" | "hero"; className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" className={className} viewBox={variant === "header" ? "972 0 310 137" : "800 141 271 215"} preserveAspectRatio="xMidYMid slice">
      <image href="/images/yellow-playbook-reference.png" width="1586" height="992" />
    </svg>
  );
}
