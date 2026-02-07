import { google, calendar_v3 } from "googleapis";
import * as fs from "fs/promises";
import * as path from "path";
import * as http from "http";
import { URL } from "url";
import { getWorkspacePath } from "../workspace/index.js";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];
const REDIRECT_PORT = 3847;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

type Credentials = {
  client_id: string;
  client_secret: string;
};

type TokenData = {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
};

function getCredentialsPath(): string {
  return path.join(getWorkspacePath(), "google-credentials.json");
}

function getTokenPath(): string {
  return path.join(getWorkspacePath(), "google-token.json");
}

async function loadCredentials(): Promise<Credentials | null> {
  try {
    const data = await fs.readFile(getCredentialsPath(), "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveCredentials(creds: Credentials): Promise<void> {
  await fs.writeFile(getCredentialsPath(), JSON.stringify(creds, null, 2));
}

async function loadToken(): Promise<TokenData | null> {
  try {
    const data = await fs.readFile(getTokenPath(), "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveToken(token: TokenData): Promise<void> {
  await fs.writeFile(getTokenPath(), JSON.stringify(token, null, 2));
}

export async function isCalendarConfigured(): Promise<boolean> {
  const creds = await loadCredentials();
  const token = await loadToken();
  return !!(creds && token);
}

export async function hasCredentials(): Promise<boolean> {
  const creds = await loadCredentials();
  return !!creds;
}

export async function setCredentials(clientId: string, clientSecret: string): Promise<void> {
  await saveCredentials({ client_id: clientId, client_secret: clientSecret });
}

// OAuth 인증 URL 생성
export async function getAuthUrl(): Promise<string | null> {
  const creds = await loadCredentials();
  if (!creds) return null;

  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    REDIRECT_URI
  );

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

// OAuth 콜백 서버 시작 (일회성)
export function startAuthServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "", `http://localhost:${REDIRECT_PORT}`);

        if (url.pathname === "/oauth2callback") {
          const code = url.searchParams.get("code");

          if (code) {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end("<h1>인증 완료!</h1><p>이 창을 닫아도 됩니다.</p>");
            server.close();
            resolve(code);
          } else {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end("<h1>오류</h1><p>인증 코드가 없습니다.</p>");
            server.close();
            reject(new Error("No code received"));
          }
        }
      } catch (error) {
        res.writeHead(500);
        res.end("Error");
        server.close();
        reject(error);
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`[Calendar] Auth server listening on port ${REDIRECT_PORT}`);
    });

    // 5분 타임아웃
    setTimeout(() => {
      server.close();
      reject(new Error("Auth timeout"));
    }, 5 * 60 * 1000);
  });
}

// 인증 코드로 토큰 교환
export async function exchangeCodeForToken(code: string): Promise<boolean> {
  const creds = await loadCredentials();
  if (!creds) return false;

  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    REDIRECT_URI
  );

  try {
    const { tokens } = await oauth2Client.getToken(code);

    if (tokens.access_token && tokens.refresh_token) {
      await saveToken({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date || 0,
      });
      return true;
    }
    return false;
  } catch (error) {
    console.error("Token exchange error:", error);
    return false;
  }
}

// 인증된 클라이언트 가져오기
async function getAuthClient() {
  const creds = await loadCredentials();
  const token = await loadToken();

  if (!creds || !token) {
    throw new Error("Calendar not configured. Use /calendar_setup");
  }

  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expiry_date: token.expiry_date,
  });

  // 토큰 자동 갱신
  oauth2Client.on("tokens", async (newTokens) => {
    if (newTokens.access_token) {
      const currentToken = await loadToken();
      if (currentToken) {
        await saveToken({
          ...currentToken,
          access_token: newTokens.access_token,
          expiry_date: newTokens.expiry_date || currentToken.expiry_date,
        });
      }
    }
  });

  return oauth2Client;
}

// 캘린더 API 인스턴스
async function getCalendar(): Promise<calendar_v3.Calendar> {
  const auth = await getAuthClient();
  return google.calendar({ version: "v3", auth });
}

// 오늘 일정 조회
export async function getTodayEvents(): Promise<calendar_v3.Schema$Event[]> {
  const calendar = await getCalendar();

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
  });

  return response.data.items || [];
}

// 특정 기간 일정 조회
export async function getEvents(
  startDate: Date,
  endDate: Date
): Promise<calendar_v3.Schema$Event[]> {
  const calendar = await getCalendar();

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: startDate.toISOString(),
    timeMax: endDate.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 20,
  });

  return response.data.items || [];
}

// 일정 추가
export async function addEvent(
  summary: string,
  startTime: Date,
  endTime?: Date,
  description?: string
): Promise<calendar_v3.Schema$Event> {
  const calendar = await getCalendar();

  // 종료 시간이 없으면 1시간 후
  const end = endTime || new Date(startTime.getTime() + 60 * 60 * 1000);

  const event: calendar_v3.Schema$Event = {
    summary,
    description,
    start: {
      dateTime: startTime.toISOString(),
      timeZone: "Asia/Seoul",
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: "Asia/Seoul",
    },
  };

  const response = await calendar.events.insert({
    calendarId: "primary",
    requestBody: event,
  });

  return response.data;
}

// 일정 삭제
export async function deleteEvent(eventId: string): Promise<boolean> {
  try {
    const calendar = await getCalendar();
    await calendar.events.delete({
      calendarId: "primary",
      eventId,
    });
    return true;
  } catch {
    return false;
  }
}

// 이벤트 포맷팅
export function formatEvent(event: calendar_v3.Schema$Event): string {
  const start = event.start?.dateTime || event.start?.date;
  const timeStr = start
    ? new Date(start).toLocaleTimeString("ko-KR", {
        hour: "numeric",
        minute: "numeric",
      })
    : "종일";

  return `${timeStr} - ${event.summary || "(제목 없음)"}`;
}

// 날짜 파싱 (리마인더와 비슷)
export function parseDateExpression(expr: string): { start: Date; end?: Date } | null {
  const now = new Date();
  const lower = expr.toLowerCase();

  // "오늘", "내일", "모레"
  let targetDate = new Date(now);

  if (lower.includes("내일")) {
    targetDate.setDate(targetDate.getDate() + 1);
  } else if (lower.includes("모레")) {
    targetDate.setDate(targetDate.getDate() + 2);
  }

  // 시간 파싱
  const timeMatch = lower.match(/(오전|오후)?\s*(\d{1,2})\s*시\s*(\d{1,2})?분?/);
  if (timeMatch) {
    const isPM = timeMatch[1] === "오후";
    let hour = parseInt(timeMatch[2]);
    const minute = timeMatch[3] ? parseInt(timeMatch[3]) : 0;

    if (isPM && hour < 12) hour += 12;
    if (!isPM && timeMatch[1] === "오전" && hour === 12) hour = 0;

    targetDate.setHours(hour, minute, 0, 0);

    return { start: targetDate };
  }

  // 시간 없이 날짜만
  if (lower.includes("오늘") || lower.includes("내일") || lower.includes("모레")) {
    targetDate.setHours(9, 0, 0, 0); // 기본 9시
    return { start: targetDate };
  }

  return null;
}
