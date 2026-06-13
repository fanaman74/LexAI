import OpenAI from "openai";

let _client: OpenAI | null = null;

export function getAnthropic(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
    _client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": process.env.APP_BASE_URL ?? "http://localhost:3000",
        "X-Title": "LexAI",
      },
    });
  }
  return _client;
}

export const AI_MODEL = "deepseek/deepseek-v4-flash";
