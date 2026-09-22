/** Tiny accessible SVG charts (no chart library, keeps the bundle small for low bandwidth). */
export function Bars({ data, height = 140 }: { data: { label: string; value: number }[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / data.length;
  return (
    <figure>
      <svg viewBox={`0 0 100 ${height / 3}`} className="w-full" role="img" aria-label={data.map((d) => `${d.label}: ${d.value}`).join(", ")}>
        {data.map((d, i) => {
          const h = (d.value / max) * (height / 3 - 8);
          return (
            <g key={d.label}>
              <rect x={i * w + w * 0.15} y={height / 3 - 6 - h} width={w * 0.7} height={h} rx={1} className="fill-brand-500" />
              <text x={i * w + w / 2} y={height / 3 - 7 - h - 1} textAnchor="middle" className="fill-ink-600" fontSize={3}>{d.value}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex text-[11px] text-ink-500">{data.map((d) => <span key={d.label} className="flex-1 text-center">{d.label}</span>)}</figcaption>
    </figure>
  );
}

export function Line({ data }: { data: { label: string; value: number }[] }) {
  if (!data.length) return <p className="text-sm text-ink-500">No data yet.</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const pts = data.map((d, i) => `${(i / Math.max(data.length - 1, 1)) * 100},${40 - (d.value / max) * 36}`).join(" ");
  return (
    <figure>
      <svg viewBox="0 0 100 42" className="w-full" role="img" aria-label={data.map((d) => `${d.label}: ${d.value}`).join(", ")} preserveAspectRatio="none">
        <polyline points={pts} fill="none" className="stroke-brand-600" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-ink-500"><span>{data[0]!.label}</span><span>{data[data.length - 1]!.label}</span></figcaption>
    </figure>
  );
}
