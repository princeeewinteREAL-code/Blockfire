import { describe, expect, it } from 'vitest';
import { filterChat } from '../src/index.js';

describe('chat filter', () => {
  it('leaves normal chat alone', () => {
    expect(filterChat('gg nice shot! 2v2 later?')).toBe('gg nice shot! 2v2 later?');
    expect(filterChat('I passed the class, assessment done')).toBe('I passed the class, assessment done');
    expect(filterChat('Scunthorpe and Essex')).toBe('Scunthorpe and Essex');
  });
  it('stars out rude words, including common tricks', () => {
    expect(filterChat('you are a bitch')).toBe('you are a *****');
    expect(filterChat('FUUUUCK')).toBe('*******');
    expect(filterChat('sh1t')).toBe('****');
    expect(filterChat('f.u.c.k off')).toBe('******* off');
    expect(filterChat('kau ni bodoh')).toBe('kau ni *****');
  });
  it('trims, squashes spaces, removes invisible characters and caps length', () => {
    expect(filterChat('  hi ​  there  ')).toBe('hi there');
    expect(filterChat('a'.repeat(500))).toHaveLength(120);
    expect(filterChat('   ')).toBe('');
  });
});
