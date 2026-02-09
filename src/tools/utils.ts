/**
 * Common utilities for tools
 */

// SSRF 방지: 사설 IP 체크
export function isPrivateIP(hostname: string): boolean {
  // IPv4 사설 IP 패턴
  const privateIPv4Patterns = [
    /^127\./,                           // 127.0.0.0/8 loopback
    /^10\./,                            // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // 172.16.0.0/12
    /^192\.168\./,                      // 192.168.0.0/16
    /^0\./,                             // 0.0.0.0/8
    /^169\.254\./,                      // link-local
  ];
  
  // IPv6 사설/특수 주소
  const privateIPv6Patterns = [
    /^::1$/,                            // loopback
    /^fe80:/i,                          // link-local
    /^fd[0-9a-f]{2}:/i,                // unique local (fd00::/8)
    /^fc[0-9a-f]{2}:/i,                // unique local (fc00::/7)
    /^::ffff:(127\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)/i,  // IPv4-mapped
  ];
  
  // localhost 체크
  if (hostname === 'localhost' || hostname === 'localhost.localdomain') {
    return true;
  }
  
  // IPv4 체크
  if (privateIPv4Patterns.some(p => p.test(hostname))) {
    return true;
  }
  
  // IPv6 체크 (브라켓 제거)
  const ipv6 = hostname.replace(/^\[|\]$/g, '');
  if (privateIPv6Patterns.some(p => p.test(ipv6))) {
    return true;
  }
  
  return false;
}

// 홈 디렉토리
export const home = process.env.HOME || "";
