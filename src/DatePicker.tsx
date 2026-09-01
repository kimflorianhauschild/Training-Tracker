import { useEffect, useMemo, useRef, useState } from "react";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toISO(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

const fmtLong = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

const fmtMonth = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric"
});

export default function DatePicker({
  value,
  onChange
}: {
  value: string;
  onChange: (iso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { y, m } = parseISO(value);
  const [view, setView] = useState({ year: y, month: m }); // month 1–12
  const ref = useRef<HTMLDivElement>(null);

  // Bei Wertänderung von außen die Monatsansicht angleichen.
  useEffect(() => {
    const p = parseISO(value);
    setView({ year: p.y, month: p.m });
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cells = useMemo(() => {
    const first = new Date(view.year, view.month - 1, 1);
    const lead = (first.getDay() + 6) % 7; // Montag = 0
    const daysInMonth = new Date(view.year, view.month, 0).getDate();
    const arr: (number | null)[] = [];
    for (let i = 0; i < lead; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [view]);

  const label = fmtLong.format(new Date(`${value}T00:00:00`));
  const sel = parseISO(value);
  const now = new Date();
  const todayIso = toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());

  function prevMonth() {
    setView((v) =>
      v.month <= 1
        ? { year: v.year - 1, month: 12 }
        : { year: v.year, month: v.month - 1 }
    );
  }

  function nextMonth() {
    setView((v) =>
      v.month >= 12
        ? { year: v.year + 1, month: 1 }
        : { year: v.year, month: v.month + 1 }
    );
  }

  function pick(d: number) {
    onChange(toISO(view.year, view.month, d));
    setOpen(false);
  }

  return (
    <div className="datepicker" ref={ref}>
      <button
        type="button"
        className="datepicker-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>

      {open && (
        <div className="datepicker-pop">
          <div className="dp-head">
            <button
              type="button"
              className="dp-nav"
              onClick={prevMonth}
              aria-label="Voriger Monat"
            >
              ‹
            </button>
            <span className="dp-title">
              {fmtMonth.format(new Date(view.year, view.month - 1, 1))}
            </span>
            <button
              type="button"
              className="dp-nav"
              onClick={nextMonth}
              aria-label="Nächster Monat"
            >
              ›
            </button>
          </div>

          <div className="dp-grid dp-weekdays">
            {WEEKDAYS.map((w) => (
              <span key={w} className="dp-weekday">
                {w}
              </span>
            ))}
          </div>

          <div className="dp-grid">
            {cells.map((d, i) => {
              if (d == null) return <span key={i} className="dp-empty" />;
              const iso = toISO(view.year, view.month, d);
              const isSel =
                sel.y === view.year && sel.m === view.month && sel.d === d;
              const isToday = iso === todayIso;
              return (
                <button
                  type="button"
                  key={i}
                  className={
                    "dp-day" +
                    (isSel ? " selected" : "") +
                    (isToday ? " today" : "")
                  }
                  onClick={() => pick(d)}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
