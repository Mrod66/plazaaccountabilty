import {describe, expect, it} from 'vitest';

import {csvField, parseCsv, readPeopleCsv, toCsv} from '../src/lib/csv';

describe('CSV', () => {
  it('reads quotes, commas and line breaks inside fields, CRLF, and Excel’s byte-order mark', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nthere'],
    ]);
  });

  it('never exports a formula a spreadsheet would run', () => {
    expect(csvField('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvField('+1 718')).toBe("'+1 718");
    expect(csvField('-12')).toBe('-12');
    expect(csvField('62% (31 of 50 cases)')).toBe('62% (31 of 50 cases)');
    expect(toCsv(['A'], [[null]])).toBe('﻿A\r\n\r\n');
  });

  it('reads the people file by its header names, in any order', () => {
    const rows = readPeopleCsv('Email,First Name,ROLE(S),Store(s),Department,Last name\nSAADM@plazacars.com,Saad,Sales Manager,Plaza Honda,Sales,Miraz\n');
    expect(rows).toEqual([
      {line: 2, firstName: 'Saad', lastName: 'Miraz', email: 'saadm@plazacars.com', roles: 'Sales Manager', stores: 'Plaza Honda', department: 'Sales', managerEmail: '', active: ''},
    ]);
    expect(() => readPeopleCsv('Name,Phone\nx,y\n')).toThrow(/First name/);
  });
});
