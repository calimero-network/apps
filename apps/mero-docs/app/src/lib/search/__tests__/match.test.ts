import { describe, expect, it } from 'vitest';
import {
  foldForSearch,
  matchRanges,
  matchScore,
  normalizeQuery,
  queryWords,
  QUERY_MAX,
} from '../match';

const score = (label: string, query: string, typos = true) =>
  matchScore(foldForSearch(label), queryWords(query), typos);

function marked(text: string, ranges: [number, number][]): string[] {
  return ranges.map(([a, b]) => text.slice(a, b));
}

describe('foldForSearch', () => {
  it('folds case, accents and width (S-05)', () => {
    expect(foldForSearch('Résumé')).toBe('resume');
    expect(foldForSearch('ROAD')).toBe('road');
    expect(foldForSearch('ＲＯＡＤ')).toBe('road');
    expect(foldForSearch('İstanbul')).toBe('istanbul');
  });

  it('leaves non-latin text and emoji intact (S-06)', () => {
    expect(foldForSearch('日本')).toBe('日本');
    expect(foldForSearch('🚀 Launch')).toBe('🚀 launch');
  });
});

describe('normalizeQuery', () => {
  it('trims', () => {
    expect(normalizeQuery('  road  ')).toEqual({
      text: 'road',
      tagsOnly: false,
    });
  });

  it('treats spaces or punctuation alone as empty (S-07)', () => {
    expect(normalizeQuery('   ')).toEqual({ text: '', tagsOnly: false });
    expect(normalizeQuery(' .,;!? ')).toEqual({ text: '', tagsOnly: false });
    expect(normalizeQuery('🚀')).toEqual({ text: '🚀', tagsOnly: false });
  });

  it('cuts to QUERY_MAX without splitting a surrogate pair (S-08)', () => {
    expect(normalizeQuery('a'.repeat(500)).text).toHaveLength(QUERY_MAX);
    const cut = normalizeQuery('a'.repeat(QUERY_MAX - 1) + '🚀').text;
    expect(cut).toBe('a'.repeat(QUERY_MAX - 1));
  });

  it('switches to tags only on a leading # (S-09)', () => {
    expect(normalizeQuery('#launch')).toEqual({
      text: 'launch',
      tagsOnly: true,
    });
    expect(normalizeQuery(' # ')).toEqual({ text: '', tagsOnly: true });
    expect(normalizeQuery('road #1')).toEqual({
      text: 'road #1',
      tagsOnly: false,
    });
  });
});

describe('matchRanges', () => {
  it('marks every match on the original text', () => {
    expect(matchRanges('Road to the road', 'road')).toEqual([
      [0, 4],
      [12, 16],
    ]);
  });

  it('returns nothing for an empty or missing query', () => {
    expect(matchRanges('Road', '')).toEqual([]);
    expect(matchRanges('Road', 'x')).toEqual([]);
  });

  it('maps through accents that fold to fewer code units (S-05)', () => {
    const text = 'Mon Résumé';
    expect(marked(text, matchRanges(text, 'resume'))).toEqual(['Résumé']);
    const decomposed = 'Résumé draft';
    expect(matchRanges(decomposed, 'resume')).toEqual([[0, 8]]);
    expect(matchRanges(decomposed, 'draft')).toEqual([[9, 14]]);
  });

  it('maps through characters that fold to more code units', () => {
    const text = 'x ﬁle';
    expect(marked(text, matchRanges(text, 'file'))).toEqual(['ﬁle']);
  });

  it('never splits a surrogate pair (S-06)', () => {
    const text = 'Go 🚀 launch 日本';
    expect(marked(text, matchRanges(text, '🚀'))).toEqual(['🚀']);
    expect(marked(text, matchRanges(text, '日本'))).toEqual(['日本']);
    expect(matchRanges(text, 'launch')).toEqual([[6, 12]]);
    expect(matchRanges('🚀', '\ud83d')).toEqual([[0, 2]]);
  });

  it('agrees with foldForSearch on a word-final sigma', () => {
    expect(foldForSearch('ΟΔΟΣ ΜΑΣ')).toBe(foldForSearch('οδοσ μασ'));
    expect(matchRanges('ΟΔΟΣ ΜΑΣ', 'οδος')).toEqual([[0, 4]]);
    expect(matchRanges('οδός', 'ΟΔΟΣ')).toEqual([[0, 4]]);
  });

  it('folds astral characters as whole code points', () => {
    expect(matchRanges('𝐀𝐁 x', 'ab')).toEqual([[0, 4]]);
  });

  it('folds the query the same way as the text', () => {
    expect(matchRanges('road map', 'ROAD')).toEqual([[0, 4]]);
  });
});

describe('queryWords', () => {
  it('splits the folded query on any whitespace', () => {
    expect(queryWords(' Roadmap\u00a0 Q3 ')).toEqual(['roadmap', 'q3']);
    expect(queryWords('')).toEqual([]);
  });
});

describe('matchScore', () => {
  it('ranks prefix, then word start, then substring', () => {
    expect(score('roadmap', 'road')).toBe(0);
    expect(score('the road', 'road')).toBe(1);
    expect(score('old-road', 'road')).toBe(1);
    expect(score('railroad', 'road')).toBe(2);
    expect(score('rail', 'road')).toBeNull();
  });

  it('prefers a later word start over an earlier substring', () => {
    expect(score('railroad road', 'road')).toBe(1);
  });

  it('matches words in any order', () => {
    expect(score('Q3 Roadmap', 'roadmap q3')).not.toBeNull();
    expect(score('Q3 Roadmap', 'q3 roadmap')).not.toBeNull();
  });

  it('needs every word to match', () => {
    expect(score('Q3 Roadmap', 'roadmap q4')).toBeNull();
    expect(score('Q3 Roadmap', 'roadmap budget')).toBeNull();
  });

  it('matches everything for no words', () => {
    expect(matchScore('roadmap', [])).toBe(0);
  });

  it('ranks by the worst word first, then by the sum of the words', () => {
    const bothPrefix = score('road map', 'road map'); // 0 and 1
    const wordStarts = score('the road map', 'road map'); // 1 and 1
    const substring = score('roadmap', 'road map'); // 0 and 2
    expect(bothPrefix!).toBeLessThan(wordStarts!);
    expect(wordStarts!).toBeLessThan(substring!);
  });

  it('forgives one typo in a word of four or more characters', () => {
    expect(score('Roadmap', 'roadmpa')).not.toBeNull(); // transposition
    expect(score('Roadmap', 'raodmap')).not.toBeNull();
    expect(score('Roadmap', 'roadnap')).not.toBeNull(); // substitution
    expect(score('Roadmap', 'rodmap')).not.toBeNull(); // missing letter
    expect(score('Roadmap', 'roaddmap')).not.toBeNull(); // extra letter
    expect(score('Alice', 'alce')).not.toBeNull();
    expect(score('Q3 Roadmap', 'q3 roadmpa')).not.toBeNull();
    expect(score('The quarterly plan', 'quartrely')).not.toBeNull();
  });

  it('matches a typo against the start of a label word only', () => {
    expect(score('Roadmaps for 2026', 'roadmpa')).not.toBeNull();
    expect(score('Railroad', 'raod')).toBeNull();
    expect(score('Roadmap', 'rdmp')).toBeNull(); // two edits
  });

  it('forgives no typo in a word shorter than four characters', () => {
    expect(score('Plan', 'pln')).toBeNull();
    expect(score('Q3 Roadmap', 'q4')).toBeNull();
    expect(score('Road', 'raod')).not.toBeNull();
  });

  it('ranks a typo below every exact match', () => {
    expect(score('xroadmpa', 'roadmpa')!).toBeLessThan(
      score('Roadmap', 'roadmpa')!,
    );
    const words = 'alpha beta gamma delta epsilon';
    const substrings = score('xalpha xbeta xgamma xdelta xepsilon', words)!;
    const oneTypo = score('alpha beta gamma delta epsilno', words)!;
    expect(substrings).toBeLessThan(oneTypo);
  });

  it('can skip typos, for long text', () => {
    expect(score('Roadmap', 'roadmpa', false)).toBeNull();
    expect(score('Q3 Roadmap', 'roadmap q3', false)).not.toBeNull();
  });

  it('matches non-latin words and emoji in any order', () => {
    expect(score('日本 資料', '資料 日本')).not.toBeNull();
    expect(score('🚀 Launch plan', 'plan 🚀')).not.toBeNull();
    expect(score('Mon Résumé', 'reusme')).not.toBeNull();
    expect(score('Спецификация', 'спецификацая')).not.toBeNull();
  });
});

describe('matchRanges for several words', () => {
  it('marks each matched word on its own', () => {
    const text = 'Q3 Roadmap';
    expect(matchRanges(text, 'roadmap q3')).toEqual([
      [0, 2],
      [3, 10],
    ]);
  });

  it('marks the whole label word a typo matched', () => {
    const text = 'Q3 Roadmap draft';
    expect(marked(text, matchRanges(text, 'roadmpa'))).toEqual(['Roadmap']);
    expect(marked(text, matchRanges(text, 'draft roadmpa'))).toEqual([
      'Roadmap',
      'draft',
    ]);
    expect(marked('Mon Résumé', matchRanges('Mon Résumé', 'reusme'))).toEqual([
      'Résumé',
    ]);
  });

  it('marks no typo when typos are off', () => {
    expect(matchRanges('Roadmap', 'roadmpa', false)).toEqual([]);
  });

  it('keeps whole code points with emoji and non-latin words', () => {
    const text = 'Go 🚀 launch 日本';
    expect(marked(text, matchRanges(text, '日本 🚀 launhc'))).toEqual([
      '🚀',
      'launch',
      '日本',
    ]);
  });
});
