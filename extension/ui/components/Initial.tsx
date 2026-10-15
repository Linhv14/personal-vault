export function Initial({ text, className = "initial" }: { text: string; className?: string }) {
  return <span className={className}>{[...text.trim()][0]?.toUpperCase() ?? "?"}</span>;
}
