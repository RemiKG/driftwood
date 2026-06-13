"use client";
// The volume forecast band: teal corridor (predicted lower..upper) with the live volume line in ink.
// Instantly shows whether traffic held inside the band or fell out the bottom.

interface Point {
  time: string;
  predicted: number;
  lower: number;
  upper: number;
}
interface LivePoint {
  time: string;
  volume: number;
}

export default function ForecastBand({
  points,
  live,
  width = 720,
  height = 160,
}: {
  points: Point[];
  live: LivePoint[];
  width?: number;
  height?: number;
}) {
  if (!points.length && !live.length) {
    return <div className="loading">No volume series in this window.</div>;
  }

  const pad = 8;
  const allVals = [
    ...points.flatMap((p) => [p.lower, p.upper, p.predicted]),
    ...live.map((l) => l.volume),
  ].filter((v) => Number.isFinite(v));
  const maxV = Math.max(1, ...allVals);
  const minV = Math.min(0, ...allVals);
  const span = Math.max(1, maxV - minV);

  const n = Math.max(points.length, live.length, 2);
  const x = (i: number) => pad + (i / (n - 1)) * (width - 2 * pad);
  const y = (v: number) => height - pad - ((v - minV) / span) * (height - 2 * pad);

  // Band polygon (upper across, lower back).
  const upper = points.map((p, i) => `${x(i)},${y(p.upper)}`);
  const lower = points.map((p, i) => `${x(i)},${y(p.lower)}`).reverse();
  const bandPath = points.length ? `M${upper.join(" L")} L${lower.join(" L")} Z` : "";

  const predLine = points.map((p, i) => `${x(i)},${y(p.predicted)}`).join(" ");
  const liveLine = live.map((l, i) => `${x((i / Math.max(1, live.length - 1)) * (n - 1))},${y(l.volume)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="volume forecast band">
      {bandPath && <path d={bandPath} fill="#3E7C77" fillOpacity={0.14} />}
      {points.length > 0 && (
        <>
          <polyline points={upper.join(" ")} fill="none" stroke="#3E7C77" strokeWidth={1} strokeDasharray="4 4" />
          <polyline points={lower.slice().reverse().join(" ")} fill="none" stroke="#3E7C77" strokeWidth={1} strokeDasharray="4 4" />
          <polyline points={predLine} fill="none" stroke="#3E7C77" strokeWidth={1.5} strokeOpacity={0.6} />
        </>
      )}
      {live.length > 0 && <polyline points={liveLine} fill="none" stroke="#1E2A32" strokeWidth={2.5} />}
    </svg>
  );
}
