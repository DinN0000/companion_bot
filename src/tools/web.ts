/**
 * Web search and fetch tools
 */

import * as cheerio from "cheerio";
import { getSecret } from "../config/secrets.js";
import { isPrivateIP } from "./utils.js";

// web_search
export async function executeWebSearch(input: Record<string, unknown>): Promise<string> {
  const query = input.query as string;
  const count = Math.min(Math.max((input.count as number) || 5, 1), 20);

  const apiKey = await getSecret("brave-api-key");
  if (!apiKey) {
    return "Error: Brave API key not configured. Ask user to set it up with: npm run setup brave <API_KEY>";
  }

  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": apiKey,
      },
    });

    if (!response.ok) {
      return `Error: Brave Search API returned ${response.status}: ${response.statusText}`;
    }

    const data = await response.json();
    const results = data.web?.results || [];

    if (results.length === 0) {
      return `No results found for "${query}"`;
    }

    const formatted = results.map((r: { title: string; url: string; description: string }, i: number) => {
      return `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.description || ""}`;
    });

    return `Search results for "${query}":\n\n${formatted.join("\n\n")}`;
  } catch (error) {
    return `Error searching: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// web_fetch
export async function executeWebFetch(input: Record<string, unknown>): Promise<string> {
  const url = input.url as string;
  const maxChars = (input.maxChars as number) || 5000;

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return "Error: URL must start with http:// or https://";
  }

  // SSRF 방지: 사설 IP 차단
  try {
    const parsedUrl = new URL(url);
    if (isPrivateIP(parsedUrl.hostname)) {
      return "Error: Access to private/internal addresses is not allowed.";
    }
  } catch {
    return "Error: Invalid URL format.";
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CompanionBot/1.0)",
      },
    });

    if (!response.ok) {
      return `Error: Failed to fetch URL (${response.status}: ${response.statusText})`;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // 불필요한 요소 제거
    $("script, style, nav, header, footer, aside, iframe, noscript").remove();

    // 본문 텍스트 추출
    let text = "";
    
    // article 태그 우선
    const article = $("article");
    if (article.length > 0) {
      text = article.text();
    } else {
      // main 태그 시도
      const main = $("main");
      if (main.length > 0) {
        text = main.text();
      } else {
        // body 전체
        text = $("body").text();
      }
    }

    // 공백 정리
    text = text
      .replace(/\s+/g, " ")
      .replace(/\n\s*\n/g, "\n")
      .trim();

    // 길이 제한
    if (text.length > maxChars) {
      text = text.slice(0, maxChars) + "... (truncated)";
    }

    const title = $("title").text().trim() || "No title";
    return `Title: ${title}\n\nContent:\n${text}`;
  } catch (error) {
    return `Error fetching URL: ${error instanceof Error ? error.message : String(error)}`;
  }
}
