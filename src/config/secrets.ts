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

export async function setSecret(key: SecretKey, value: string): Promise<void> {
  await keytar.setPassword(SERVICE_NAME, key, value);
}

export async function deleteSecret(key: SecretKey): Promise<boolean> {
  return keytar.deletePassword(SERVICE_NAME, key);
}

export async function listSecrets(): Promise<SecretKey[]> {
  const credentials = await keytar.findCredentials(SERVICE_NAME);
  return credentials.map((c) => c.account as SecretKey);
}
