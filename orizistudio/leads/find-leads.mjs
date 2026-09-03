#!/usr/bin/env node
/**
 * מנוע הלידים של ORIZISTUDIO
 * מריץ את השאילתות מ-queries.csv מול Google Places API (New),
 * ומשאיר רק עסקים שאין להם אתר אינטרנט — בדיוק הקהל שלנו.
 *
 *   export GOOGLE_MAPS_API_KEY=...
 *   node find-leads.mjs                 # כל השאילתות
 *   node find-leads.mjs --priority א    # רק עדיפות עליונה
 *   node find-leads.mjs --limit 40      # 40 השאילתות הראשונות
 *
 * הפלט: leads.csv — מוכן לייבוא לטבלת הלידים.
 * דורש הפעלת Places API (New) בקונסולת Google Cloud. החיוב לפי בקשה,
 * ויש מכסה חינמית חודשית — בדקו את התמחור העדכני בקונסולה לפני הרצה רחבה.
 */
import fs from 'node:fs';

const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!KEY) {
  console.error('חסר GOOGLE_MAPS_API_KEY. הגדירו אותו והריצו שוב.');
  process.exit(1);
}

const args = process.argv.slice(2);
const argOf = n => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const wantPriority = argOf('--priority');
const limit = Number(argOf('--limit') || 0);
const OUT = argOf('--out') || 'leads.csv';

/* ---------- קריאת שאילתות ---------- */
function parseCsv(text){
  const rows = [];
  let field = '', row = [], quoted = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (quoted){
      if (c === '"' && text[i+1] === '"'){ field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ','){ row.push(field); field = ''; }
    else if (c === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length){ row.push(field); rows.push(row); }
  const head = rows.shift().map(h => h.replace(/^﻿/, '').trim());
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

let queries = parseCsv(fs.readFileSync('queries.csv', 'utf8'));
if (wantPriority) queries = queries.filter(q => q['עדיפות'] === wantPriority);
if (limit) queries = queries.slice(0, limit);
console.log(`מריץ ${queries.length} שאילתות...`);

/* ---------- Places API ---------- */
const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.nationalPhoneNumber',
  'places.websiteUri', 'places.rating', 'places.userRatingCount',
  'places.primaryTypeDisplayName', 'places.googleMapsUri', 'places.businessStatus',
].join(',');

async function search(textQuery, pageToken){
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': FIELDS + ',nextPageToken',
    },
    body: JSON.stringify({
      textQuery,
      languageCode: 'he',
      regionCode: 'IL',
      pageSize: 20,
      ...(pageToken ? { pageToken } : {}),
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/* ---------- הרצה ---------- */
const seen = new Set();
const leads = [];
let scanned = 0;

for (const q of queries){
  const textQuery = q['שאילתת חיפוש'];
  try {
    let token = null;
    for (let page = 0; page < 3; page++){          // עד 60 תוצאות לשאילתה
      const data = await search(textQuery, token);
      for (const p of data.places || []){
        scanned++;
        if (p.websiteUri) continue;                 // יש אתר — לא רלוונטי
        if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
        if (!p.nationalPhoneNumber) continue;       // בלי טלפון אין מה לעשות
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        leads.push({
          name: p.displayName?.text || '',
          niche: q['נישה'],
          city: q['עיר'],
          phone: p.nationalPhoneNumber,
          address: p.formattedAddress || '',
          rating: p.rating ?? '',
          reviews: p.userRatingCount ?? '',
          type: p.primaryTypeDisplayName?.text || '',
          maps: p.googleMapsUri || '',
        });
      }
      token = data.nextPageToken;
      if (!token) break;
      await new Promise(r => setTimeout(r, 2000));  // הטוקן צריך רגע להתייצב
    }
    const got = leads.filter(l => l.niche === q['נישה'] && l.city === q['עיר']).length;
    console.log(`  ${textQuery} → ${got} ללא אתר`);
  } catch (e){
    console.error(`  שגיאה ב"${textQuery}": ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 200));
}

/* ---------- כתיבה ---------- */
const esc = v => `"${String(v).replace(/"/g, '""')}"`;
const header = ['שם העסק','נישה','עיר','טלפון','כתובת','דירוג','מספר ביקורות','סוג','פרופיל גוגל',
  'יש אתר','מקור','שלב','תאריך שיחה','הסכמה לוואטסאפ','דמו נשלח','הצעה נשלחה','חבילה','סכום','סטטוס','הערות'];
const lines = [header.map(esc).join(',')];
for (const l of leads){
  lines.push([l.name, l.niche, l.city, l.phone, l.address, l.rating, l.reviews, l.type, l.maps,
    'לא', 'Google Places', 'חדש', '', '', '', '', '', '', '', ''].map(esc).join(','));
}
fs.writeFileSync(OUT, '﻿' + lines.join('\n'), 'utf8');

console.log(`\nנסרקו ${scanned} עסקים.`);
console.log(`נמצאו ${leads.length} עסקים ללא אתר עם טלפון.`);
console.log(`נכתב אל ${OUT}`);
