import { describe, it, expect } from 'vitest';
import {
  parseTestCount,
  buildBadgeText,
  replaceBadge,
} from '../src/scripts/update-test-badge.js';

// --- parseTestCount ---

describe('parseTestCount', () => {
  it('extracts numTotalTests from valid vitest JSON output', () => {
    const json = JSON.stringify({
      numTotalTests: 42,
      numPassedTests: 42,
      numFailedTests: 0,
      success: true,
    });
    expect(parseTestCount(json)).toBe(42);
  });

  it('extracts numPassedTests from vitest JSON output', () => {
    const json = JSON.stringify({
      numTotalTests: 50,
      numPassedTests: 45,
      numFailedTests: 5,
      success: false,
    });
    expect(parseTestCount(json)).toBe(45);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseTestCount('not json')).toThrow();
  });

  it('throws when numPassedTests is missing', () => {
    const json = JSON.stringify({ success: true });
    expect(() => parseTestCount(json)).toThrow();
  });

  it('throws when numPassedTests is zero', () => {
    const json = JSON.stringify({
      numTotalTests: 0,
      numPassedTests: 0,
      numFailedTests: 0,
      success: true,
    });
    expect(() => parseTestCount(json)).toThrow();
  });

  it('handles JSON with extra output lines before/after', () => {
    const output = `
some vitest preamble output
{"numTotalTests":100,"numPassedTests":99,"numFailedTests":1,"success":false}
some trailing output
`;
    expect(parseTestCount(output)).toBe(99);
  });
});

// --- buildBadgeText ---

describe('buildBadgeText', () => {
  it('builds correct badge URL fragment for a given count', () => {
    expect(buildBadgeText(42)).toBe('tests-42%20passed');
  });

  it('builds badge for large numbers', () => {
    expect(buildBadgeText(1234)).toBe('tests-1234%20passed');
  });

  it('throws for non-positive numbers', () => {
    expect(() => buildBadgeText(0)).toThrow();
    expect(() => buildBadgeText(-1)).toThrow();
  });
});

// --- replaceBadge ---

describe('replaceBadge', () => {
  const singleBadgeReadme = `# My Project

[![Tests](https://img.shields.io/badge/tests-100%20passed-brightgreen)]()

Some content here.
`;

  it('replaces the badge count in README content', () => {
    const result = replaceBadge(singleBadgeReadme, 200);
    expect(result).toContain('tests-200%20passed');
    expect(result).not.toContain('tests-100%20passed');
  });

  it('replaces multiple badge occurrences (JP + EN sections)', () => {
    const multiReadme = `# Project

[![Tests](https://img.shields.io/badge/tests-50%20passed-brightgreen)]()

## English

[![Tests](https://img.shields.io/badge/tests-50%20passed-brightgreen)]()
`;
    const result = replaceBadge(multiReadme, 75);
    const matches = result.match(/tests-75%20passed/g);
    expect(matches).toHaveLength(2);
    expect(result).not.toContain('tests-50%20passed');
  });

  it('returns the same content when count is unchanged', () => {
    const result = replaceBadge(singleBadgeReadme, 100);
    expect(result).toBe(singleBadgeReadme);
  });

  it('throws when no badge pattern is found', () => {
    const noBadge = '# README\n\nNo badge here.\n';
    expect(() => replaceBadge(noBadge, 42)).toThrow();
  });

  it('preserves surrounding content', () => {
    const result = replaceBadge(singleBadgeReadme, 999);
    expect(result).toContain('# My Project');
    expect(result).toContain('Some content here.');
  });

  it('works correctly when called multiple times consecutively (no global regex state leak)', () => {
    const readme = `# Project\n[![Tests](https://img.shields.io/badge/tests-10%20passed-brightgreen)]()\n`;

    const result1 = replaceBadge(readme, 20);
    expect(result1).toContain('tests-20%20passed');

    const result2 = replaceBadge(readme, 30);
    expect(result2).toContain('tests-30%20passed');

    const result3 = replaceBadge(readme, 40);
    expect(result3).toContain('tests-40%20passed');

    // Each call should independently produce the correct result
    expect(replaceBadge(result1, 50)).toContain('tests-50%20passed');
    expect(replaceBadge(result2, 60)).toContain('tests-60%20passed');
  });
});
