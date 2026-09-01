import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery, useObservable } from "dexie-react-hooks";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import DatePicker from "./DatePicker";
import {
  db,
  DEFAULT_STRENGTH_AREAS,
  type HangboardSet,
  type StrengthArea,
  type StrengthExercise,
  type StrengthSet
} from "./db";

type Screen =
  | { name: "home" }
  | { name: "hangboard" }
  | { name: "areas" }
  | { name: "exercises"; areaId: string; areaName: string }
  | {
      name: "exercise";
      areaId: string;
      areaName: string;
      exerciseId: string;
      exerciseName: string;
    };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function groupByDate<T extends { date: string }>(items: T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const arr = map.get(item.date) ?? [];
    arr.push(item);
    map.set(item.date, arr);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

function useUndoDelete<T>(
  deleteItem: (item: T) => Promise<void>,
  restoreItem: (item: T) => Promise<void>
) {
  const [deletedItem, setDeletedItem] = useState<T | null>(null);
  const timeoutRef = useRef<number>();

  useEffect(() => {
    return () => {
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  async function remove(item: T) {
    await deleteItem(item);
    if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    setDeletedItem(item);
    timeoutRef.current = window.setTimeout(() => setDeletedItem(null), 5000);
  }

  async function undo() {
    if (deletedItem == null) return;
    const item = deletedItem;
    if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    setDeletedItem(null);
    await restoreItem(item);
  }

  return { deletedItem, remove, undo };
}

function UndoToast({ onUndo }: { onUndo: () => void }) {
  return (
    <div className="undo-toast" role="status">
      <span>Eintrag gelöscht</span>
      <button type="button" onClick={onUndo}>
        Rückgängig
      </button>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "home" });

  useEffect(() => {
    const historyState = window.history.state as {
      trainingTrackerScreen?: Screen;
    } | null;

    if (!historyState?.trainingTrackerScreen) {
      window.history.replaceState(
        { trainingTrackerScreen: { name: "home" } },
        "",
        window.location.href
      );
    } else {
      setScreen(historyState.trainingTrackerScreen);
    }

    function handlePopState(event: PopStateEvent) {
      const state = event.state as {
        trainingTrackerScreen?: Screen;
      } | null;
      setScreen(state?.trainingTrackerScreen ?? { name: "home" });
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(nextScreen: Screen) {
    window.history.pushState(
      { trainingTrackerScreen: nextScreen },
      "",
      window.location.href
    );
    setScreen(nextScreen);
  }

  const subtitle =
    screen.name === "hangboard"
      ? "Hangboard"
      : screen.name === "areas"
        ? ""
        : screen.name === "exercises"
          ? ""
          : screen.name === "exercise"
            ? ""
            : "";
  const title =
    screen.name === "areas"
      ? "Kraftsport"
      : screen.name === "exercises"
        ? screen.areaName
        : screen.name === "exercise"
          ? screen.exerciseName
          : "Training Tracker";

  return (
      <div className="app">
      <header className="header">
        <div className="header-top">
          <h1>{title}</h1>
          <AccountButton />
        </div>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </header>

      <main className="content">
        {screen.name === "home" && <HomeView onSelect={navigate} />}
        {screen.name === "hangboard" && <HangboardView />}
        {screen.name === "areas" && (
          <StrengthAreasView
            onOpen={(areaId, areaName) =>
              navigate({ name: "exercises", areaId, areaName })
            }
          />
        )}
        {screen.name === "exercises" && (
          <StrengthExercisesView
            areaId={screen.areaId}
            onOpen={(exerciseId, exerciseName) =>
              navigate({
                name: "exercise",
                areaId: screen.areaId,
                areaName: screen.areaName,
                exerciseId,
                exerciseName
              })
            }
          />
        )}
        {screen.name === "exercise" && (
          <StrengthExerciseView
            exerciseId={screen.exerciseId}
          />
        )}
      </main>

      <LoginDialog />
    </div>
  );
}

function translateAlert(a: {
  type: string;
  message: string;
  messageCode?: string;
}): string {
  switch (a.messageCode) {
    case "INVALID_OTP":
      return "Der Code ist ungültig. Bitte versuche es erneut.";
    case "OTP_SENT":
      return "Ein Anmelde-Code wurde an deine E-Mail-Adresse gesendet.";
    default:
      return a.message;
  }
}

function LoginDialog() {
  const ui = useObservable(db.cloud.userInteraction);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setValues({});
  }, [ui]);

  if (!ui) return null;

  const titles: Record<string, string> = {
    email: "Anmelden",
    otp: "Code bestätigen"
  };
  const submitLabels: Record<string, string> = {
    email: "Weiter",
    otp: "Anmelden"
  };
  const fieldLabels: Record<string, string> = {
    email: "E-Mail-Adresse",
    otp: "Anmelde-Code"
  };
  const fieldPlaceholders: Record<string, string> = {
    email: "name@beispiel.de",
    otp: "Code aus der E-Mail"
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    ui!.onSubmit(values);
  }

  return (
    <div className="modal-backdrop">
      <form className="modal card" onSubmit={submit}>
        <h2 className="modal-title">{titles[ui.type] ?? ui.title}</h2>

        {ui.type === "otp" && (
          <p className="modal-text">
            Wir haben dir einen Anmelde-Code per E-Mail geschickt. Bitte gib ihn
            hier ein.
          </p>
        )}

        {ui.alerts?.map((a, i) => (
          <p key={i} className={"modal-alert " + a.type}>
            {translateAlert(a)}
          </p>
        ))}

        {Object.entries(ui.fields).map(([name, rawField]) => {
          const field = rawField as {
            type?: string;
            label?: string;
            placeholder?: string;
          };
          const numeric = name === "otp" || field.type === "number";
          return (
            <label key={name} className="modal-field">
              {fieldLabels[name] ?? field.label ?? name}
              <input
                type={field.type === "email" ? "email" : "text"}
                inputMode={numeric ? "numeric" : undefined}
                autoFocus
                value={values[name] ?? ""}
                placeholder={fieldPlaceholders[name] ?? field.placeholder}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [name]: e.target.value }))
                }
              />
            </label>
          );
        })}

        <div className="modal-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => ui.onCancel()}
          >
            Abbrechen
          </button>
          <button type="submit" className="primary">
            {submitLabels[ui.type] ?? "Bestätigen"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AccountButton() {
  const user = useObservable(db.cloud.currentUser);
  // Ohne konfigurierte Cloud-URL läuft die App nur lokal – kein Konto nötig.
  if (!db.cloud?.options?.databaseUrl) return null;

  if (user?.isLoggedIn) {
    return (
      <button
        className="account"
        onClick={() => db.cloud.logout()}
        title={user.email ?? undefined}
      >
        Abmelden
      </button>
    );
  }
  return (
    <button className="account" onClick={() => db.cloud.login()}>
      Anmelden
    </button>
  );
}

function HomeView({ onSelect }: { onSelect: (s: Screen) => void }) {
  return (
    <div className="home">
      <button className="tile" onClick={() => onSelect({ name: "areas" })}>
        <span className="tile-icon">🏋️</span>
        <span className="tile-label">Kraftsport</span>
      </button>
      <button className="tile" onClick={() => onSelect({ name: "hangboard" })}>
        <span className="tile-icon">🧗</span>
        <span className="tile-label">Hangboard</span>
      </button>
    </div>
  );
}

function SortableList<T extends { id?: string }>({
  items,
  onReorder,
  renderItem
}: {
  items: T[];
  onReorder: (ordered: T[]) => void;
  renderItem: (item: T) => React.ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(items, oldIndex, newIndex));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((i) => i.id as string)}
        strategy={verticalListSortingStrategy}
      >
        <div className="list">
          {items.map((item) => (
            <SortableRow key={item.id} id={item.id as string}>
              {renderItem(item)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  children
}: {
  id: string;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 1 : undefined
  };

  return (
    <div ref={setNodeRef} style={style} className="list-item">
      <button
        className="drag-handle"
        aria-label="Zum Verschieben ziehen"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      {children}
    </div>
  );
}

function StrengthAreasView({
  onOpen
}: {
  onOpen: (areaId: string, areaName: string) => void;
}) {
  const [name, setName] = useState("");
  const [formOpen, setFormOpen] = useState(true);

  const areas = useLiveQuery(
    () => db.strengthAreas.orderBy("sortOrder").toArray(),
    []
  );

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const maxOrder = (areas ?? []).reduce(
      (m, a) => Math.max(m, a.sortOrder),
      -1
    );
    await db.strengthAreas.add({
      name: n,
      sortOrder: maxOrder + 1,
      createdAt: Date.now()
    });
    setName("");
  }

  async function remove(id?: string) {
    if (id == null) return;
    if (
      !window.confirm(
        "Bereich inklusive aller Übungen und Einträge wirklich löschen?"
      )
    )
      return;
    const exercises = await db.strengthExercises
      .where("areaId")
      .equals(id)
      .toArray();
    for (const ex of exercises) {
      if (ex.id != null) {
        await db.strengthSets.where("exerciseId").equals(ex.id).delete();
      }
    }
    await db.strengthExercises.where("areaId").equals(id).delete();
    await db.strengthAreas.delete(id);
  }

  async function reorder(ordered: StrengthArea[]) {
    await Promise.all(
      ordered.map((a, i) =>
        a.id != null ? db.strengthAreas.update(a.id, { sortOrder: i }) : null
      )
    );
  }

  async function seedDefaults() {
    const now = Date.now();
    await db.strengthAreas.bulkAdd(
      DEFAULT_STRENGTH_AREAS.map((n, i) => ({
        name: n,
        sortOrder: i,
        createdAt: now + i
      }))
    );
  }

  return (
    <div>
      <section className="card collapsible-form">
        <button
          type="button"
          className="form-toggle"
          aria-expanded={formOpen}
          onClick={() => setFormOpen((open) => !open)}
        >
          <span>Neuen Bereich anlegen</span>
          <span aria-hidden="true">{formOpen ? "−" : "+"}</span>
        </button>
        {formOpen && (
          <form className="form" onSubmit={add}>
            <label>
              Neuer Bereich
              <input
                type="text"
                value={name}
                placeholder="z. B. Nacken"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button type="submit" className="primary">
              Bereich anlegen
            </button>
          </form>
        )}
      </section>

      {areas && areas.length === 0 && (
        <div className="card empty-actions">
          <p className="empty">Noch keine Bereiche angelegt.</p>
          <button type="button" className="primary" onClick={seedDefaults}>
            Standard-Bereiche hinzufügen
          </button>
        </div>
      )}

      <SortableList
        items={areas ?? []}
        onReorder={reorder}
        renderItem={(a) => (
          <>
            <button
              className="list-main"
              onClick={() => a.id != null && onOpen(a.id, a.name)}
            >
              <span>{a.name}</span>
              <span className="chevron">›</span>
            </button>
            <button className="del" onClick={() => remove(a.id)}>
              ✕
            </button>
          </>
        )}
      />
    </div>
  );
}

function StrengthExercisesView({
  areaId,
  onOpen
}: {
  areaId: string;
  onOpen: (exerciseId: string, exerciseName: string) => void;
}) {
  const [name, setName] = useState("");
  const [formOpen, setFormOpen] = useState(true);

  const exercises = useLiveQuery(
    () =>
      db.strengthExercises
        .where("areaId")
        .equals(areaId)
        .sortBy("sortOrder"),
    [areaId]
  );

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const maxOrder = (exercises ?? []).reduce(
      (m, ex) => Math.max(m, ex.sortOrder),
      -1
    );
    await db.strengthExercises.add({
      areaId,
      name: n,
      sortOrder: maxOrder + 1,
      createdAt: Date.now()
    });
    setName("");
  }

  async function remove(id?: string) {
    if (id == null) return;
    if (!window.confirm("Übung inklusive aller Einträge wirklich löschen?"))
      return;
    await db.strengthSets.where("exerciseId").equals(id).delete();
    await db.strengthExercises.delete(id);
  }

  async function reorder(ordered: StrengthExercise[]) {
    await Promise.all(
      ordered.map((ex, i) =>
        ex.id != null
          ? db.strengthExercises.update(ex.id, { sortOrder: i })
          : null
      )
    );
  }

  return (
    <div>
      <section className="card collapsible-form">
        <button
          type="button"
          className="form-toggle"
          aria-expanded={formOpen}
          onClick={() => setFormOpen((open) => !open)}
        >
          <span>Neue Übung anlegen</span>
          <span aria-hidden="true">{formOpen ? "−" : "+"}</span>
        </button>
        {formOpen && (
          <form className="form" onSubmit={add}>
            <label>
              Neue Übung
              <input
                type="text"
                value={name}
                placeholder="z. B. Latzug"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button type="submit" className="primary">
              Übung anlegen
            </button>
          </form>
        )}
      </section>

      {exercises && exercises.length === 0 && (
        <p className="empty">Noch keine Übungen in diesem Bereich.</p>
      )}

      <SortableList
        items={exercises ?? []}
        onReorder={reorder}
        renderItem={(ex) => (
          <>
            <button
              className="list-main"
              onClick={() => ex.id != null && onOpen(ex.id, ex.name)}
            >
              <span>{ex.name}</span>
              <span className="chevron">›</span>
            </button>
            <button className="del" onClick={() => remove(ex.id)}>
              ✕
            </button>
          </>
        )}
      />
    </div>
  );
}

function StrengthExerciseView({
  exerciseId
}: {
  exerciseId: string;
}) {
  const [reps, setReps] = useState("");
  const [weightType, setWeightType] = useState<"bodyweight" | "added">(
    "added"
  );
  const [weightKg, setWeightKg] = useState("");
  const [date, setDate] = useState(today());
  const [isPr, setIsPr] = useState(false);
  const [notes, setNotes] = useState("");
  const [editingSet, setEditingSet] = useState<StrengthSet | null>(null);

  const sets = useLiveQuery(
    () => db.strengthSets.where("exerciseId").equals(exerciseId).toArray(),
    [exerciseId]
  );

  const {
    deletedItem,
    remove: removeSet,
    undo
  } = useUndoDelete<StrengthSet>(
    async (set) => {
      if (set.id != null) await db.strengthSets.delete(set.id);
    },
    async (set) => {
      await db.strengthSets.add(set);
    }
  );

  const sorted = useMemo(
    () => [...(sets ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [sets]
  );

  const lastSet = sorted[0];

  // Eingaben mit den Werten des letzten Trainings vorbelegen.
  useEffect(() => {
    if (lastSet) {
      setReps(String(lastSet.reps));
      setIsPr(lastSet.isPr ?? false);
      if (lastSet.weightKg === "bodyweight") {
        setWeightType("bodyweight");
        setWeightKg("");
      } else {
        setWeightType("added");
        setWeightKg(String(lastSet.weightKg));
      }
    }
  }, [lastSet?.id]);

  const grouped = useMemo(() => groupByDate(sorted), [sorted]);

  function edit(set: StrengthSet) {
    setEditingSet(set);
    setReps(String(set.reps));
    setDate(set.date);
    setIsPr(set.isPr ?? false);
    setNotes(set.notes ?? "");
    if (set.weightKg === "bodyweight") {
      setWeightType("bodyweight");
      setWeightKg("");
    } else {
      setWeightType("added");
      setWeightKg(String(set.weightKg));
    }
  }

  function cancelEdit() {
    setEditingSet(null);
    setIsPr(false);
    setNotes("");
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (reps === "" || (weightType === "added" && weightKg === "")) return;
    const values = {
      exerciseId,
      date,
      reps: Number(reps),
      weightKg: weightType === "bodyweight" ? "bodyweight" : Number(weightKg),
      isPr,
      notes: notes.trim() || undefined,
      createdAt: Date.now()
    } satisfies Omit<StrengthSet, "id">;
    if (editingSet?.id != null) {
      await db.strengthSets.update(editingSet.id, values);
      setEditingSet(null);
    } else {
      await db.strengthSets.add(values);
    }
    setIsPr(false);
    setNotes("");
  }

  return (
    <div>
      <form className="card form" onSubmit={add}>
        {editingSet && <h3 className="form-title">Satz bearbeiten</h3>}
        <div className="row">
          <label>
            Wdh.
            <input
              type="number"
              inputMode="numeric"
              value={reps}
              onChange={(e) => setReps(e.target.value)}
            />
          </label>
          <label>
            Gewicht
            <span className="select-wrap">
              <select
                value={weightType}
                onChange={(e) =>
                  setWeightType(e.target.value as "bodyweight" | "added")
                }
              >
                <option value="bodyweight">Körpergewicht</option>
                <option value="added">Zusatzgewicht</option>
              </select>
            </span>
            {weightType === "added" && (
              <input
                type="number"
                inputMode="decimal"
                step="0.5"
                value={weightKg}
                placeholder="z. B. 20"
                onChange={(e) => setWeightKg(e.target.value)}
              />
            )}
          </label>
        </div>
        <label>
          Datum
          <DatePicker value={date} onChange={setDate} />
        </label>
        <label>
          <span className="checkbox-label">
            <input
              type="checkbox"
              checked={isPr}
              onChange={(e) => setIsPr(e.target.checked)}
            />
            Als PR markieren
          </span>
        </label>
        <label>
          Zusatz
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="primary">
            {editingSet ? "Änderungen speichern" : "Satz speichern"}
          </button>
          {editingSet && (
            <button type="button" className="ghost" onClick={cancelEdit}>
              Abbrechen
            </button>
          )}
        </div>
      </form>

      {sorted.some((set) => set.isPr) && (
        <section className="card pr-summary">
          <h3>Aktueller PR</h3>
          {(() => {
            const pr = sorted.find((set) => set.isPr);
            if (!pr) return null;
            return (
              <>
                <strong>
                  {pr.reps} × {pr.weightKg === "bodyweight" ? "Körpergewicht" : `${pr.weightKg} kg`}
                </strong>
                <span>{formatDate(pr.date)}</span>
                {pr.notes && <span>{pr.notes}</span>}
              </>
            );
          })()}
        </section>
      )}

      <History empty="Noch keine Einträge für diese Übung.">
        {grouped.map(([d, items]) => (
          <section key={d} className="card day">
            <h3>{formatDate(d)}</h3>
            <ul>
              {(items as StrengthSet[]).map((s) => (
                <li key={s.id}>
                  <div className="entry-row">
                    <span className="entry-main">
                      {s.reps} × {s.weightKg === "bodyweight" ? "Körpergewicht" : `${s.weightKg} kg`}
                      {s.isPr && <span className="pr-badge">PR</span>}
                    </span>
                    <button className="del" onClick={() => removeSet(s)}>
                      ✕
                    </button>
                    <button
                      type="button"
                      className="edit"
                      aria-label="Satz bearbeiten"
                      title="Satz bearbeiten"
                      onClick={() => edit(s)}
                    >
                      ✎
                    </button>
                  </div>
                  {s.notes && <span className="entry-note">{s.notes}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </History>
      {deletedItem && <UndoToast onUndo={undo} />}
    </div>
  );
}

function HangboardView() {
  const [grip, setGrip] = useState("Half Crimp");
  const [edgeMm, setEdgeMm] = useState("20");
  const [hangSec, setHangSec] = useState("10");
  const [addedWeightKg, setAddedWeightKg] = useState("0");
  const [reps, setReps] = useState("1");
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [editingSet, setEditingSet] = useState<HangboardSet | null>(null);

  const sets = useLiveQuery(
    () => db.hangboardSets.orderBy("createdAt").reverse().toArray(),
    []
  );

  const {
    deletedItem,
    remove: removeSet,
    undo
  } = useUndoDelete<HangboardSet>(
    async (set) => {
      if (set.id != null) await db.hangboardSets.delete(set.id);
    },
    async (set) => {
      await db.hangboardSets.add(set);
    }
  );

  const grouped = useMemo(() => groupByDate(sets ?? []), [sets]);

  function edit(set: HangboardSet) {
    setEditingSet(set);
    setGrip(set.grip);
    setEdgeMm(String(set.edgeMm));
    setHangSec(String(set.hangSec));
    setAddedWeightKg(String(set.addedWeightKg));
    setReps(String(set.reps));
    setDate(set.date);
    setNotes(set.notes ?? "");
  }

  function cancelEdit() {
    setEditingSet(null);
    setNotes("");
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (edgeMm === "" || hangSec === "") return;
    const values = {
      date,
      grip: grip.trim() || "—",
      edgeMm: Number(edgeMm),
      hangSec: Number(hangSec),
      addedWeightKg: Number(addedWeightKg),
      reps: Number(reps) || 1,
      notes: notes.trim() || undefined,
      createdAt: Date.now()
    } satisfies Omit<HangboardSet, "id">;
    if (editingSet?.id != null) {
      await db.hangboardSets.update(editingSet.id, values);
      setEditingSet(null);
    } else {
      await db.hangboardSets.add(values);
    }
    setNotes("");
  }

  return (
    <div>
      <form className="card form" onSubmit={add}>
        {editingSet && <h3 className="form-title">Eintrag bearbeiten</h3>}
        <label>
          Griff
          <input
            type="text"
            value={grip}
            onChange={(e) => setGrip(e.target.value)}
            list="grips"
          />
          <datalist id="grips">
            <option value="Half Crimp" />
            <option value="Open Hand" />
            <option value="Full Crimp" />
            <option value="Slopers" />
            <option value="Pinch" />
            <option value="Zangengriff" />
          </datalist>
        </label>
        <div className="row">
          <label>
            Kante (mm)
            <input
              type="number"
              inputMode="numeric"
              value={edgeMm}
              onChange={(e) => setEdgeMm(e.target.value)}
            />
          </label>
          <label>
            Haltezeit (s)
            <input
              type="number"
              inputMode="numeric"
              value={hangSec}
              onChange={(e) => setHangSec(e.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <label>
            Zusatzgew. (kg)
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              value={addedWeightKg}
              onChange={(e) => setAddedWeightKg(e.target.value)}
            />
          </label>
          <label>
            Wdh.
            <input
              type="number"
              inputMode="numeric"
              value={reps}
              onChange={(e) => setReps(e.target.value)}
            />
          </label>
        </div>
        <label>
          Datum
          <DatePicker value={date} onChange={setDate} />
        </label>
        <label>
          Zusatz
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="primary">
            {editingSet ? "Änderungen speichern" : "Hang speichern"}
          </button>
          {editingSet && (
            <button type="button" className="ghost" onClick={cancelEdit}>
              Abbrechen
            </button>
          )}
        </div>
      </form>

      <History empty="Noch keine Hangboard-Einträge.">
        {grouped.map(([d, items]) => (
          <section key={d} className="card day">
            <h3>{formatDate(d)}</h3>
            <ul>
              {(items as HangboardSet[]).map((h) => (
                <li key={h.id}>
                  <div className="entry-row">
                    <span className="entry-main">
                      <strong>{h.grip}</strong> — {h.edgeMm} mm, {h.hangSec} s
                      {h.addedWeightKg !== 0 &&
                        ` @ ${h.addedWeightKg > 0 ? "+" : ""}${h.addedWeightKg} kg`}
                      {h.reps > 1 && ` × ${h.reps}`}
                    </span>
                    <button className="del" onClick={() => removeSet(h)}>
                      ✕
                    </button>
                    <button
                      type="button"
                      className="edit"
                      aria-label="Eintrag bearbeiten"
                      title="Eintrag bearbeiten"
                      onClick={() => edit(h)}
                    >
                      ✎
                    </button>
                  </div>
                  {h.notes && <span className="entry-note">{h.notes}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </History>
      {deletedItem && <UndoToast onUndo={undo} />}
    </div>
  );
}

function History({
  children,
  empty
}: {
  children: React.ReactNode;
  empty: string;
}) {
  const hasContent = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="history">
      <h2>Verlauf</h2>
      {hasContent ? children : <p className="empty">{empty}</p>}
    </div>
  );
}
