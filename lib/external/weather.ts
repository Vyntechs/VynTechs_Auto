// Open-Meteo current-weather lookup. No API key required, no attribution
// requirement. https://open-meteo.com/en/docs
//
// We deliberately do not log or persist precise lat/lon — the route stores a
// rounded ~11km centroid so a curator can audit "the lookup wasn't wildly off"
// without retaining anything that pinpoints the tech.

export type WeatherLookup = {
  temperatureC: number
  temperatureF: number
  humidityPct?: number
  windKph?: number
  conditions?: string
}

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'

// WMO weather code → short label. Keep it terse; the AI doesn't need prose.
// Source: https://open-meteo.com/en/docs (weather_code section)
const WMO_LABEL: Record<number, string> = {
  0: 'clear',
  1: 'mostly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'rime fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'heavy drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'light rain showers',
  81: 'rain showers',
  82: 'heavy rain showers',
  85: 'light snow showers',
  86: 'snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm w/ hail',
  99: 'severe thunderstorm w/ hail',
}

export type FetchFn = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

export async function fetchAmbientConditions(opts: {
  latitude: number
  longitude: number
  /** Injected for tests. Defaults to global fetch. */
  fetchFn?: FetchFn
  /** Per-request timeout in ms. Defaults to 8s. */
  timeoutMs?: number
}): Promise<WeatherLookup> {
  if (
    !Number.isFinite(opts.latitude) ||
    !Number.isFinite(opts.longitude) ||
    Math.abs(opts.latitude) > 90 ||
    Math.abs(opts.longitude) > 180
  ) {
    throw new Error('invalid coordinates')
  }

  const url = new URL(OPEN_METEO_URL)
  url.searchParams.set('latitude', opts.latitude.toFixed(4))
  url.searchParams.set('longitude', opts.longitude.toFixed(4))
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code',
  )
  url.searchParams.set('temperature_unit', 'celsius')
  url.searchParams.set('wind_speed_unit', 'kmh')

  const fetchFn = opts.fetchFn ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8_000)

  let res: Response
  try {
    res = await fetchFn(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    throw new Error(`open-meteo ${res.status}`)
  }

  const body = (await res.json()) as {
    current?: {
      temperature_2m?: number
      relative_humidity_2m?: number
      wind_speed_10m?: number
      weather_code?: number
    }
  }
  const c = body.current
  if (!c || typeof c.temperature_2m !== 'number') {
    throw new Error('open-meteo: missing temperature_2m')
  }

  const temperatureC = c.temperature_2m
  return {
    temperatureC,
    temperatureF: temperatureC * 1.8 + 32,
    humidityPct:
      typeof c.relative_humidity_2m === 'number' ? c.relative_humidity_2m : undefined,
    windKph: typeof c.wind_speed_10m === 'number' ? c.wind_speed_10m : undefined,
    conditions:
      typeof c.weather_code === 'number' ? WMO_LABEL[c.weather_code] : undefined,
  }
}
