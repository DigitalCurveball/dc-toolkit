#!/usr/bin/env node
// Checks that every fragment of a client's approved copy appears in each page, word for word.
// Run on the concept before the port, and on the build after it:
//
//   pnpm exec dc-check-copy --copy brief/design-brief.md --from "### Approved copy" --to "### The facts" dist/client/index.html
//   --from, --to       the lines that start and end the copy in the file (default: all of it)
//   --ignore <regex>   removed from each line before it is read, such as a label the copy sits
//                      under: --ignore '^(Button|Under it): '; repeat it for more
//
// Headings, blank lines and lines that are only a bold label are not copy. Each line is split at
// the end of each sentence and at each colon, so layout may set the pieces apart; each piece must
// appear in the page's text, ignoring case, curly quotes and spacing. A missing piece is listed,
// and the exit code is 1. The check is for the port, never CI: the copy is the client's to change.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { copyFragments, missingCopy } from '../src/copy.mjs';

const { values: v, positionals: pages } = parseArgs({
  allowPositionals: true,
  options: {
    copy: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    ignore: { type: 'string', multiple: true, default: [] },
  },
});
if (!v.copy || pages.length === 0) {
  console.error('Usage: dc-check-copy --copy <file> [--from <line>] [--to <line>] [--ignore <regex>]... <page.html>...');
  process.exit(2);
}

const fragments = copyFragments(readFileSync(v.copy, 'utf8'), v);
let missingAny = false;
for (const page of pages) {
  const missing = missingCopy(fragments, readFileSync(page, 'utf8'));
  console.log(`${page}: ${fragments.length - missing.length}/${fragments.length} fragments present`);
  for (const fragment of missing) console.log(`   MISSING: ${fragment}`);
  missingAny ||= missing.length > 0;
}
process.exit(missingAny ? 1 : 0);
