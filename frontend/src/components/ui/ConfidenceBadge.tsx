interface Props {
  score: number;
  showLabel?: boolean;
}

export default function ConfidenceBadge({ score, showLabel = true }: Props) {
  const pct = Math.round(score * 100);
  const cls =
    pct >= 80
      ? "badge-green"
      : pct >= 60
      ? "badge-amber"
      : "badge-red";

  return (
    <span className={cls}>
      {showLabel && "Confidence "}
      {pct}%
    </span>
  );
}
