/**
 * 메시지에 타임스탬프를 추가하는 유틸리티
 * LLM이 시간 순서와 오늘/어제를 구분할 수 있도록 함
 */

/**
 * 현재 시간을 간결한 형식으로 반환
 * 예: "[10:35]" 또는 "[어제 23:15]"
 */
export function formatMessageTimestamp(date: Date = new Date()): string {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });

  if (isToday) {
    return `[${time}]`;
  } else if (isYesterday) {
    return `[어제 ${time}]`;
  } else {
    // 더 오래된 경우 날짜도 포함
    const dateStr = date.toLocaleDateString("ko-KR", {
      month: "short",
      day: "numeric",
      timeZone: "Asia/Seoul",
    });
    return `[${dateStr} ${time}]`;
  }
}

/**
 * 메시지 내용에 타임스탬프 prefix 추가
 */
export function addTimestampToMessage(content: string, date: Date = new Date()): string {
  const timestamp = formatMessageTimestamp(date);
  return `${timestamp} ${content}`;
}
