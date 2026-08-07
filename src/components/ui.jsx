import { cls, tierLabel } from '../lib/util.js';

export function Toggle({ on, onChange }) {
  return (
    <button
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={cls(
        'relative h-5 w-9 transition-colors border',
        on ? 'bg-ink border-ink' : 'bg-white border-line'
      )}
    >
      <span
        className={cls(
          'absolute top-1/2 -translate-y-1/2 h-3 w-3 transition-all',
          on ? 'left-[18px] bg-gold' : 'left-[2px] bg-steel'
        )}
      />
    </button>
  );
}

export function Stars({ value, onChange, size = 22 }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange && onChange(n)}
          className={cls('transition-transform', onChange && 'hover:scale-110 cursor-pointer')}
          style={{ fontSize: size }}
        >
          <span className={n <= (value || 0) ? 'text-gold' : 'text-line'}>{'★'}</span>
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 sm:p-8" onClick={onClose}>
      <div
        className={cls('card bg-white w-full my-6 animate-fadeUp', wide ? 'max-w-4xl' : 'max-w-lg')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h3 className="luxe-title text-lg">{title}</h3>
          <button onClick={onClose} className="text-steel hover:text-ink text-xl leading-none cursor-pointer">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export function Tag({ children }) {
  return (
    <span className="inline-block border border-gold/60 text-gold px-2 py-0.5 text-[10px] tracking-wide2 uppercase bg-gold-soft/30">
      {children}
    </span>
  );
}

export function TierBadge({ tier }) {
  if (!tier) return null;
  const map = { gold: 'text-gold border-gold/70', platinum: 'text-ink border-ink', silver: 'text-steel border-line' };
  return (
    <span className={cls('inline-block border px-2 py-0.5 text-[10px] tracking-wide2 uppercase', map[tier] || 'text-steel border-line')}>
      {tierLabel(tier)}
    </span>
  );
}

export function Stat({ label, value, sub }) {
  return (
    <div className="card px-5 py-4">
      <div className="eyebrow">{label}</div>
      <div className="luxe-title text-2xl mt-1.5">{value}</div>
      {sub && <div className="text-xs text-steel mt-0.5">{sub}</div>}
    </div>
  );
}

export function SectionTitle({ eyebrow, title, right }) {
  return (
    <div className="flex items-end justify-between mb-5">
      <div>
        <div className="eyebrow mb-1">{eyebrow}</div>
        <h2 className="luxe-title text-2xl">{title}</h2>
      </div>
      {right}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="text-sm text-steel py-10 text-center border border-dashed border-line">{children}</div>;
}
