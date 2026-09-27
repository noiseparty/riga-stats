/** Wire types shared by the server (producer) and the browser (consumer). */

export interface Envelope<T> {
  data: T;
  /** Epoch ms when the server last got a good answer from upstream. */
  fetchedAt: number;
  /** True when upstream failed and this is the last good copy. */
  stale: boolean;
  /** Server clock at response time, so the browser can correct for a wrong local clock. */
  now: number;
  source: string;
}

export interface ApiError {
  error: string;
  message: string;
}

// ---------------------------------------------------------------- transit ----

export type Mode = 'bus' | 'trol' | 'tram' | 'nightbus' | 'express' | 'other';

export interface Station {
  key: string;
  name: string;
  /** English gloss for the featured stations; absent for search results. */
  en?: string;
  street: string;
  lat: number;
  lng: number;
  stopIds: string[];
}

export interface Departure {
  stopId: string;
  mode: Mode;
  route: string;
  destination: string;
  /** Epoch ms of the predicted departure. */
  at: number;
  /** "to centre" / "from centre" when the platform says so. */
  platform: string;
  vehicle: string;
}

export interface DeparturesPayload {
  stopIds: string[];
  departures: Departure[];
}

// ---------------------------------------------------------------- weather ----

export interface WeatherPayload {
  current: {
    time: string;
    temp: number;
    feels: number;
    humidity: number;
    wind: number;
    windDir: number;
    code: number;
    isDay: boolean;
    precip: number;
  };
  hourly: { time: string; temp: number; code: number; pop: number | null; isDay: boolean }[];
  daily: {
    date: string;
    code: number;
    max: number;
    min: number;
    precip: number;
    sunrise: string;
    sunset: string;
  }[];
}

// ----------------------------------------------------------------- prices ----

export interface PriceSlot {
  /** Epoch ms at which the slot starts. */
  t: number;
  /** Slot length in minutes (15 since the Nordic market moved to 15-minute products). */
  mins: number;
  /** EUR/MWh. */
  p: number;
}

export interface PriceHour {
  t: number;
  avg: number;
  min: number;
  max: number;
}

export interface PriceDay {
  date: string;
  complete: boolean;
  slots: PriceSlot[];
  hours: PriceHour[];
  min: number;
  max: number;
  avg: number;
}

export interface CheapWindow {
  start: number;
  end: number;
  avg: number;
}

export interface PricesPayload {
  area: 'lv';
  days: PriceDay[];
  /** Cheapest contiguous 3-hour block from the current slot onward, if one fits. */
  cheapest: CheapWindow | null;
}
