interface Props {
  buckets: { label: string; count: number }[];
}

/** Launch activity per hour: makes the wave pattern in the data visible. */
export function ActivityStrip({ buckets }: Props) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="strip">
      {buckets.map((b, i) => (
        <div className="strip-col" key={i} title={`${b.count} launches`}>
          <div className="strip-bar" style={{ height: `${Math.max(2, (b.count / max) * 100)}%` }} />
        </div>
      ))}
      <div className="strip-legend">
        <span>{buckets.length}h ago</span>
        <span>now</span>
      </div>
    </div>
  );
}
