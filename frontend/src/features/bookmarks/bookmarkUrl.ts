export function bookmarkUrl(raw: string): string {
  const value = raw.trim();
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:\/\//i.test(value) && !/^[^/]+:\d+(?:\/|$)/.test(value)) {
    throw new Error('Liên kết chỉ hỗ trợ http hoặc https.');
  }
  let parsed: URL;
  try { parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); }
  catch { throw new Error('Địa chỉ liên kết không hợp lệ.'); }
  if (!parsed.hostname || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Dùng liên kết http/https không chứa tên đăng nhập hoặc mật khẩu.');
  }
  if (parsed.href.length > 500) throw new Error('Liên kết tối đa 500 ký tự.');
  return parsed.href;
}
