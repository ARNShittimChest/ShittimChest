---
description: Get current weather, forecasts, and historical weather data using GPS locations (no API key required).
---

# Weather Integration

Two free services, no API keys needed. They rely on coordinates which are provided directly in your System Prompt. No need to geocode city names.

## wttr.in (primary)

Quick one-liner:

```bash
curl -s "wttr.in/42.84,-71.74?format=3"
# Output: City: ⛅️ +8°C
```

Compact format:

```bash
curl -s "wttr.in/42.84,-71.74?format=%l:+%c+%t+%h+%w"
# Output: City: ⛅️ +8°C 71% ↙5km/h
```

Full forecast:

```bash
curl -s "wttr.in/42.84,-71.74?T"
```

Format codes: `%c` condition · `%t` temp · `%h` humidity · `%w` wind · `%l` location · `%m` moon

Tips:

- Units: `?m` (metric) `?u` (USCS)
- Today only: `?1` · Current only: `?0`

---

## Open-Meteo (fallback, JSON)

Free, no key, good for programmatic use.

**Step 1 — Query current weather:**
Substitute `latitude` and `longitude` with the values from your System Prompt!

```bash
curl -s "https://api.open-meteo.com/v1/forecast?latitude=42.84&longitude=-71.74&current_weather=true"
```

Returns JSON with temp, windspeed, weathercode.

**Step 2 — Query historical data:**

```bash
curl -s "https://archive-api.open-meteo.com/v1/archive?latitude=42.84&longitude=-71.74&start_date=2026-02-17&end_date=2026-02-17&hourly=temperature_2m,windspeed_10m,windgusts_10m,winddirection_10m,precipitation,relative_humidity_2m&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto"
```

Available hourly variables:

- `temperature_2m` — Air temperature
- `windspeed_10m` — Wind speed
- `windgusts_10m` — Wind gusts
- `winddirection_10m` — Wind direction (degrees)
- `precipitation` — Rain/snow (mm)
- `relative_humidity_2m` — Humidity (%)
- `snowfall` — Snowfall (cm)
- `cloudcover` — Cloud cover (%)
- `pressure_msl` — Sea-level pressure (hPa)

Daily aggregates are also available — replace hourly with daily:

```bash
curl -s "https://archive-api.open-meteo.com/v1/archive?latitude=42.84&longitude=-71.74&start_date=2026-02-10&end_date=2026-02-17&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto"
```

Tips:

- Date range: `start_date` and `end_date` in YYYY-MM-DD format
- Max range per request: 1 year
- Data availability: 1940–yesterday (updates daily)
- Use `timezone=auto` to get local times based on coordinates

Docs:

- https://open-meteo.com/en/docs
- https://open-meteo.com/en/docs/historical-weather-api
