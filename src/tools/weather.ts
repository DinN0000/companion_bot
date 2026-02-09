/**
 * Weather tool
 */

import { getSecret } from "../config/secrets.js";

// get_weather
export async function executeGetWeather(input: Record<string, unknown>): Promise<string> {
  const city = input.city as string;
  const country = input.country as string | undefined;

  const apiKey = await getSecret("openweathermap-api-key");
  if (!apiKey) {
    return "Error: OpenWeatherMap API key not configured. Ask user to set it up with /weather_setup command.";
  }

  const query = country ? `${city},${country}` : city;
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(query)}&appid=${apiKey}&units=metric&lang=kr`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.cod !== 200) {
      return `Error: ${data.message || "City not found"}`;
    }

    const weather = {
      city: data.name,
      country: data.sys.country,
      temp: Math.round(data.main.temp),
      feels_like: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      description: data.weather[0].description,
      wind: data.wind.speed,
    };

    return `Weather in ${weather.city}, ${weather.country}:
- Condition: ${weather.description}
- Temperature: ${weather.temp}°C (feels like ${weather.feels_like}°C)
- Humidity: ${weather.humidity}%
- Wind: ${weather.wind} m/s`;
  } catch (error) {
    return `Error fetching weather: ${error instanceof Error ? error.message : String(error)}`;
  }
}
