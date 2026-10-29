import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import {percent, Rate} from '../src/portal/report-ui';

/** Build prompt test 7: every percentage on screen shows its "of N" count. */
describe('rates', () => {
  const text = (html: string) => html.replace(/<[^>]+>/g, '');

  it('always says what a percentage is out of', () => {
    expect(text(renderToStaticMarkup(createElement(Rate, {n: 31, of: 50})))).toBe('62% (31 of 50 cases)');
    expect(text(renderToStaticMarkup(createElement(Rate, {n: 1, of: 1, noun: 'closed case'})))).toBe('100% (1 of 1 closed case)');
  });

  it('never shows a bare or made-up percentage when there is nothing to count', () => {
    expect(text(renderToStaticMarkup(createElement(Rate, {n: 0, of: 0})))).toBe('— (0 of 0 cases)');
    expect(percent(0, 0)).toBe('—');
  });
});
