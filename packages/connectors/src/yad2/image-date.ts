/**
 * Extract upload date from a YAD2 image URL.
 *
 * URL pattern: https://img.yad2.co.il/Pic/YYYYMM/DD/.../y2_*_YYYYMMDDHHMMSS.ext
 * Example: y2_1pa_010164_20260228202920.jpeg → 2026-02-28T20:29:20Z
 */
const IMAGE_DATE_RE = /_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.\w+$/;

export function parseImageDate(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;

  const match = imageUrl.match(IMAGE_DATE_RE);
  if (!match) return null;

  const [, year, month, day, hour, min, sec] = match;
  return `${year}-${month}-${day}T${hour}:${min}:${sec}Z`;
}
