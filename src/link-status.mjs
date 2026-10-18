// A link's status for dc-qa: null when it resolves, otherwise what went wrong ("404", or the
// error's message). Each URL is fetched once per run, however many pages carry it, and only a
// failure that may be the moment rather than the link is tried again: a dropped connection
// ("fetch failed"), a 429 or a 5xx. A 404 is final. demo-fanlight's first live check, on
// 2026-10-18, failed /projects/ twice with "fetch failed" while it answered 200, and the whole
// run had to go again.

/**
 * @param {{ tries?: number, wait?: (attempt: number) => number, fetch?: typeof fetch }} [options]
 * @returns {(url: string) => Promise<string | null>}
 */
export function linkChecker({ tries = 3, wait = (attempt) => 1000 * attempt, fetch: get = fetch } = {}) {
  const seen = new Map();

  async function status(url) {
    for (let attempt = 1; ; attempt++) {
      let problem;
      try {
        let res = await get(url, { method: 'HEAD', redirect: 'follow' });
        if (res.status === 405 || res.status === 501) res = await get(url, { method: 'GET', redirect: 'follow' });
        if (res.ok) return null;
        problem = String(res.status);
        if (res.status !== 429 && res.status < 500) return problem;
      } catch (error) {
        problem = error.message;
      }
      if (attempt >= tries) return problem;
      await new Promise((resolve) => setTimeout(resolve, wait(attempt)));
    }
  }

  return (url) => {
    if (!seen.has(url)) seen.set(url, status(url));
    return seen.get(url);
  };
}
