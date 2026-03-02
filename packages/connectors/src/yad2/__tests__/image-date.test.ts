import { describe, it, expect } from 'vitest';
import { parseImageDate } from '../image-date';

describe('parseImageDate', () => {
  it('should extract date from valid YAD2 image URL', () => {
    const url = 'https://img.yad2.co.il/Pic/202602/28/2_2/o/y2_1pa_010164_20260228202920.jpeg';
    expect(parseImageDate(url)).toBe('2026-02-28T20:29:20Z');
  });

  it('should handle different image extensions', () => {
    const url = 'https://img.yad2.co.il/Pic/202603/01/1_1/o/y2_abc_123456_20260301150000.jpg';
    expect(parseImageDate(url)).toBe('2026-03-01T15:00:00Z');
  });

  it('should return null for URL without date pattern', () => {
    expect(parseImageDate('https://img.yad2.co.il/Pic/some-image.jpeg')).toBeNull();
  });

  it('should return null for null input', () => {
    expect(parseImageDate(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(parseImageDate(undefined)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseImageDate('')).toBeNull();
  });
});
