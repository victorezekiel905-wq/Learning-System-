/** Tiny accessible SVG charts (no chart library, keeps the bundle small for low bandwidth). */
export function Bars({ data, height = 140 }: { data: { label: string; value: number }[]; height?: number }) {
  if (!data.length) return <p className="text-sm text-ink-500">Not enough data yet.</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / data.length;
  // A few bars stay bar-shaped instead of stretching into blocks.
  const bw = Math.min(w * 0.7, 10);
  // Many bars: label every third one (counted back from the latest) so labels never collide on phones.
  const every = data.length > 8 ? 3 : 1;
  const H = height / 3;
  return (
    <figure>
      <svg viewBox={`0 0 100 ${H}`} className="w-full" role="img" aria-label={data.map((d) => `${d.label}: ${d.value}`).join(", ")}>
        <line x1={0} x2={100} y1={H - 6} y2={H - 6} className="stroke-ink-200" strokeWidth={0.3} />
        {data.map((d, i) => {
          const h = (d.value / max) * (H - 12);
          return (
            <g key={i}>
              {d.value > 0 && <rect x={i * w + (w - bw) / 2} y={H - 6 - h} width={bw} height={h} rx={1} className="fill-brand-500" />}
              {(d.value > 0 || every === 1) && <text x={i * w + w / 2} y={H - 8 - h} textAnchor="middle" className="fill-ink-600" fontSize={3}>{d.value}</text>}
            </g>
          );
        })}
      </svg>
      <figcaption aria-hidden className="mt-1 flex text-[11px] text-ink-500">
        {data.map((d, i) => <span key={i} className="min-w-0 flex-1 whitespace-nowrap text-center">{(data.length - 1 - i) % every === 0 ? d.label : ""}</span>)}
      </figcaption>
    </figure>
  );
}

export function Line({ data }: { data: { label: string; value: number }[] }) {
  // One point can't draw a line; nothing but zeros isn't a trend.
  if (data.length < 2 || data.every((d) => d.value === 0)) return <p className="text-sm text-ink-500">Not enough data yet.</p>;
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
