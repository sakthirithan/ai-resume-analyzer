interface ScoreBadgeProps {
  score: number;
}

const ScoreBadge = ({ score }: ScoreBadgeProps) => {
  const badgeStyle = score > 70
    ? 'bg-badge-green text-badge-green-text'
    : score > 49
      ? 'bg-badge-yellow text-badge-yellow-text'
      : 'bg-badge-red text-badge-red-text';

  const label = score > 70
    ? 'Strong'
    : score > 49
      ? 'Good Start'
      : 'Needs Work';

  return (
    <div className={`score-badge ${badgeStyle}`}>
      <p>{label}</p>
    </div>
  );
};

export default ScoreBadge;