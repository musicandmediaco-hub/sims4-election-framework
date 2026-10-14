// Saves and loads the Sims 4 Politics data in a PRIVATE Vercel Blob store.
// Every request must send the password in the "x-edit-password" header.
import { put, get } from '@vercel/blob';
import { timingSafeEqual } from 'node:crypto';

const PATH = 'sims4-politics/state.json';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

function guard(request) {
  const want = process.env.EDIT_PASSWORD || '';
  if (!want) return json({ error: 'EDIT_PASSWORD is not set on the server yet.' }, 500);
  const got = request.headers.get('x-edit-password') || '';
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return json({ error: 'Wrong password.' }, 401);
  return null;
}

export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const r = await get(PATH, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200) return json({ state: null, etag: null });
    const text = await new Response(r.stream).text();
    return json({ state: JSON.parse(text), etag: r.blob.etag });
  } catch (e) {
    return json({ error: 'Could not read the saved data: ' + (e && e.message ? e.message : e) }, 500);
  }
}

export async function PUT(request) {
  const denied = guard(request);
  if (denied) return denied;
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Bad request.' }, 400);
  }
  const state = body && body.state;
  if (!state || !Array.isArray(state.parties) || !Array.isArray(state.cands)) {
    return json({ error: 'That does not look like Sims 4 Politics data.' }, 400);
  }
  const text = JSON.stringify(state);
  if (text.length > 4000000) return json({ error: 'The data is too large to save (over about 4 MB).' }, 413);
  try {
    const opts = { access: 'private', addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 60 };
    if (body.baseEtag) {
      opts.allowOverwrite = true;
      opts.ifMatch = body.baseEtag; // only save if nobody else saved since we loaded
    } else {
      opts.allowOverwrite = false; // first save: do not overwrite anything that already exists
    }
    const r = await put(PATH, text, opts);
    return json({ ok: true, etag: r.etag });
  } catch (e) {
    const msg = String((e && e.message) || e);
    const name = String((e && e.name) || '');
    if (/precondition/i.test(name + msg) || /already exists/i.test(msg)) return json({ conflict: true }, 409);
    return json({ error: 'Could not save: ' + msg }, 500);
  }
}
