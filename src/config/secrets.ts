import keytar from "keytar";

const SERVICE_NAME = "companionbot";

export type SecretKey = "telegram-token" | "anthropic-api-key" | "openweathermap-api-key" | "brave-api-key";

export async function getSecret(key: SecretKey): Promise<string | null> {
  try {
    return await keytar.getPassword(SERVICE_NAME, key);
  } catch {
    // keytar 실패 시 (libsecret 미설치, 키체인 접근 거부 등) null 반환
    // → setup wizard로 자동 유도
    return null;
  }
}

export class KeychainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeychainError";
  }
}

export async function setSecret(key: SecretKey, value: string): Promise<void> {
  try {
    await keytar.setPassword(SERVICE_NAME, key, value);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new KeychainError(
      `키체인 저장 실패: ${msg}\n\n` +
      `해결 방법:\n` +
      `  • macOS: 시스템 설정 > 개인정보 보호 > 키체인 접근 허용\n` +
      `  • Linux: libsecret 설치 (sudo apt install libsecret-1-0)\n` +
      `  • Docker/서버: 환경변수 사용\n` +
      `    TELEGRAM_TOKEN=xxx ANTHROPIC_API_KEY=xxx companionbot`
    );
  }
}

export async function deleteSecret(key: SecretKey): Promise<boolean> {
  return keytar.deletePassword(SERVICE_NAME, key);
}

export async function listSecrets(): Promise<SecretKey[]> {
  const credentials = await keytar.findCredentials(SERVICE_NAME);
  return credentials.map((c) => c.account as SecretKey);
}
