import Dexie, { type Table } from "dexie";
import dexieCloud from "dexie-cloud-addon";

export interface StrengthArea {
  id?: string;
  name: string; // Muskelbereich, z. B. "Rücken"
  sortOrder: number; // Position in der Liste (Drag & Drop)
  createdAt: number;
}

export interface StrengthExercise {
  id?: string;
  areaId: string; // gehört zu einem StrengthArea
  name: string;
  sortOrder: number; // Position in der Liste (Drag & Drop)
  createdAt: number;
}

export interface StrengthSet {
  id?: string;
  exerciseId: string; // gehört zu einer StrengthExercise
  date: string; // ISO date (YYYY-MM-DD)
  reps: number;
  weightKg: number | "bodyweight";
  isPr?: boolean;
  notes?: string;
  createdAt: number;
}

export interface HangboardSet {
  id?: string;
  date: string; // ISO date (YYYY-MM-DD)
  grip: string; // e.g. "Half Crimp", "Open Hand", "Slopers"
  edgeMm: number; // Kantengröße in mm
  hangSec: number; // Haltezeit in Sekunden
  addedWeightKg: number; // Zusatzgewicht (kann negativ sein bei Entlastung)
  reps: number;
  notes?: string;
  createdAt: number;
}

export const DEFAULT_STRENGTH_AREAS = [
  "Schultern",
  "Rücken",
  "Bizeps",
  "Trizeps",
  "Unterarme",
  "Brust",
  "Beine",
  "Bauch"
];

export class TrainingDB extends Dexie {
  strengthAreas!: Table<StrengthArea, string>;
  strengthExercises!: Table<StrengthExercise, string>;
  strengthSets!: Table<StrengthSet, string>;
  hangboardSets!: Table<HangboardSet, string>;

  constructor() {
    super("training-tracker-cloud", { addons: [dexieCloud] });

    // @id = global eindeutige String-IDs (Voraussetzung für die Synchronisierung).
    this.version(1).stores({
      strengthAreas: "@id, sortOrder",
      strengthExercises: "@id, areaId, sortOrder",
      strengthSets: "@id, exerciseId, date",
      hangboardSets: "@id, date, createdAt"
    });

    const cloudUrl = import.meta.env.VITE_DEXIE_CLOUD_URL;
    if (cloudUrl) {
      this.cloud.configure({
        databaseUrl: cloudUrl,
        requireAuth: true,
        customLoginGui: true
      });
    }
  }
}

export const db = new TrainingDB();
