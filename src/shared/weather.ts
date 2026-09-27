import type { WeatherPayload } from './types.js';

/** Open-Meteo forecast for central Riga. No key; CC BY 4.0. */

export const WEATHER_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=56.9496&longitude=24.1052' +
  '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day,precipitation' +
  '&hourly=temperature_2m,weather_code,precipitation_probability,is_day' +
  '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset' +
  '&timezone=Europe%2FRiga&forecast_days=7&wind_speed_unit=ms';

export type Sky = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';

/** WMO weather interpretation codes, as used by Open-Meteo. */
export function describeCode(code: number): { label: string; sky: Sky } {
  switch (code) {
    case 0: return { label: 'Clear', sky: 'clear' };
    case 1: return { label: 'Mostly clear', sky: 'partly' };
    case 2: return { label: 'Partly cloudy', sky: 'partly' };
    case 3: return { label: 'Overcast', sky: 'cloudy' };
    case 45: return { label: 'Fog', sky: 'fog' };
    case 48: return { label: 'Freezing fog', sky: 'fog' };
    case 51: return { label: 'Light drizzle', sky: 'drizzle' };
    case 53: return { label: 'Drizzle', sky: 'drizzle' };
    case 55: return { label: 'Heavy drizzle', sky: 'drizzle' };
    case 56: case 57: return { label: 'Freezing drizzle', sky: 'drizzle' };
    case 61: return { label: 'Light rain', sky: 'rain' };
    case 63: return { label: 'Rain', sky: 'rain' };
    case 65: return { label: 'Heavy rain', sky: 'rain' };
    case 66: case 67: return { label: 'Freezing rain', sky: 'rain' };
    case 71: return { label: 'Light snow', sky: 'snow' };
    case 73: return { label: 'Snow', sky: 'snow' };
    case 75: return { label: 'Heavy snow', sky: 'snow' };
    case 77: return { label: 'Snow grains', sky: 'snow' };
    case 80: return { label: 'Light showers', sky: 'rain' };
    case 81: return { label: 'Showers', sky: 'rain' };
    case 82: return { label: 'Violent showers', sky: 'rain' };
    case 85: case 86: return { label: 'Snow showers', sky: 'snow' };
    case 95: return { label: 'Thunderstorm', sky: 'storm' };
    case 96: case 99: return { label: 'Thunderstorm, hail', sky: 'storm' };
    default: return { label: 'Unknown', sky: 'cloudy' };
  }
}

export function compass(deg: number): string {
  const pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return pts[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

type Arr = (number | null)[];

interface OpenMeteo {
  current?: Record<string, number | string>;
  hourly?: { time?: string[] } & Record<string, Arr | string[] | undefined>;
  daily?: { time?: string[]; sunrise?: string[]; sunset?: string[] } & Record<string, Arr | string[] | undefined>;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Keeps the next 24 hourly points starting at the current hour. Open-Meteo times are Riga
 * local ("2026-09-28T14:00") because the request asks for timezone=Europe/Riga, so they
 * compare as strings against the current time truncated to the hour.
 */
export function normaliseWeather(body: unknown): WeatherPayload {
  const b = body as OpenMeteo;
  const c = b?.current;
  const h = b?.hourly;
  const d = b?.daily;
  if (!c || !h?.time || !d?.time) throw new Error('weather feed: missing sections');

  const currentHour = String(c.time ?? '').slice(0, 13) + ':00';
  const temps = (h.temperature_2m ?? []) as Arr;
  const codes = (h.weather_code ?? []) as Arr;
  const pops = (h.precipitation_probability ?? []) as Arr;
  const days = (h.is_day ?? []) as Arr;
  let start = h.time.findIndex((t) => t >= currentHour);
  if (start < 0) start = 0;
  const hourly = h.time.slice(start, start + 24).map((time, k) => {
    const i = start + k;
    const pop = pops[i];
    return {
      time,
      temp: num(temps[i]),
      code: num(codes[i]),
      pop: typeof pop === 'number' ? pop : null,
      isDay: num(days[i], 1) === 1,
    };
  });

  const dmax = (d.temperature_2m_max ?? []) as Arr;
  const dmin = (d.temperature_2m_min ?? []) as Arr;
  const dcode = (d.weather_code ?? []) as Arr;
  const dprec = (d.precipitation_sum ?? []) as Arr;
  const daily = d.time.map((date, i) => ({
    date,
    code: num(dcode[i]),
    max: num(dmax[i]),
    min: num(dmin[i]),
    precip: num(dprec[i]),
    sunrise: d.sunrise?.[i] ?? '',
    sunset: d.sunset?.[i] ?? '',
  }));

  return {
    current: {
      time: String(c.time ?? ''),
      temp: num(c.temperature_2m),
      feels: num(c.apparent_temperature),
      humidity: num(c.relative_humidity_2m),
      wind: num(c.wind_speed_10m),
      windDir: num(c.wind_direction_10m),
      code: num(c.weather_code),
      isDay: num(c.is_day, 1) === 1,
      precip: num(c.precipitation),
    },
    hourly,
    daily,
  };
}
