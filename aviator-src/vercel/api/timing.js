/* /api/timing — owner diagnostics for cash-out timing complaints.
 * Signs in anonymously, reads the last 40 aviatorTiming rows, and returns
 * {seen, srvMult, paid, crashPoint, flightMs} per press so a "the number
 * jumped" report can be checked against real data instead of guesses.
 * Deployed as a Vercel serverless function alongside the static output. */
const KEY = "AIzaSyC1MuCmX0bUAW6XakFzkqS8LHVxkDRTrfo";
const fv = (f) => f == null ? null :
  ("doubleValue" in f ? Number(f.doubleValue) :
   "integerValue" in f ? Number(f.integerValue) :
   "stringValue" in f ? f.stringValue : null);
module.exports = async (req, res) => {
  const out = {};
  try {
    const su = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: '{"returnSecureToken":true}' });
    const suj = await su.json();
    if (!suj.idToken) { out.err = "no token"; return res.status(200).json(out); }
    const q = await fetch(
      "https://firestore.googleapis.com/v1/projects/pokerten/databases/(default)/documents:runQuery",
      { method: "POST",
        headers: { Authorization: "Bearer " + suj.idToken,
          "Content-Type": "application/json" },
        body: JSON.stringify({ structuredQuery: {
          from: [{ collectionId: "aviatorTiming" }],
          orderBy: [{ field: { fieldPath: "ts" }, direction: "DESCENDING" }],
          limit: 40 } }) });
    const rows = await q.json();
    out.status = q.status;
    out.rows = (Array.isArray(rows) ? rows : [])
      .filter(r => r.document)
      .map(r => {
        const f = r.document.fields || {};
        return { type: fv(f.type), seen: fv(f.seen), srvMult: fv(f.srvMult),
          paid: fv(f.paid), crashPoint: fv(f.crashPoint),
          flightMs: fv(f.flightMs), ts: fv(f.ts) };
      });
  } catch (e) { out.err = String(e); }
  res.status(200).json(out);
};
