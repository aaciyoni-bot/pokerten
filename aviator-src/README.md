# AVIATORIZIS — מקור, בנייה ופרסום

המשחק AVIATORIZIS (aviatorizis.com) — משחק "קראש"/אווירון באסימונים בלבד (PLAY MONEY).
כל הקוד נכתב ידנית בתוך Claude Code על גבי הרֵפו `aaciyoni-bot/pokerten`. אין כאן
תבנית npm או "חבילה" חיצונית — התיקייה הזו היא המקור המלא כדי שאפשר יהיה להמשיך
לפתח בלי תלות בסשן שיצר אותו.

> ⚠️ **הכול כסף משחק.** אין כסף אמיתי, אין הפקדות ואין משיכות. הבוטים והצ'יפים הם
> להנאה בלבד. אין להפוך את זה למשחק בכסף אמיתי.

---

## מפת הקבצים

### הלקוח החי (מולטיפלייר) — נבנה מהמקור, לא נערך ידנית
הקובץ `aviator-live.html` בשורש הרֵפו **מיוצר אוטומטית** — אין לערוך אותו ישירות.
הוא מורכב מקבצי המקור שבתיקייה `aviator-src/live/`:

| קובץ | תפקיד |
|---|---|
| `live/main1.js` | עוזרים, אחסון מקומי, **סנכרון שעון השרת** (`clockOffset`/`eNow`), מצב `S`, נוסחת המכפיל `multAt` |
| `live/main2.js` | הליבה: זהות/יתרה/הימור, `doPlaceBet`/`doCancelBet`/`doCashout`, רינדור שחקנים, כפתור הפעולה, מנוי לעדכוני שרת, כניסת אורח, מצב בקרה (GOD), צ'אט, לוח מנהל, לולאת הפריימים |
| `live/main3.js` | אתחול (boot) |
| `live/module.html` | ייבוא Firebase v10 + חשיפת `window.avFB` (auth אנונימי, firestore, callable helper) |
| `live/extra.css` | סגנונות של הכניסה, הצ'אט, לוח המנהל, תג ההוגנות, תג "עצרת בזמן", תג הבקרה |
| `live/extra.html` | ה־DOM של מסך הכניסה, הצ'אט ולוח המנהל |
| `live/ux.css` | שיפורי קריאות, פקדים וצ׳אט במחשב ובנייד; משולב בתוך הלקוח בזמן הבנייה |
| `live/ux.js` | שליחת הודעות עם אישור, שמירת טיוטה בכישלון, מיקוד מקלדת ורינדור בטוח |
| `live/audio.js` | מנוע השמע של הלקוח החי, כולל השתקת כל הצלילים וחידוש שמע לאחר חסימה; נערך בנפרד ממנוע השמע בסולו |
| `live/cockpit-layout.js`, `live/cockpit.css`, `live/cockpit.js` | עיצוב תא הטייס: סידור הפקדים והגרף סביב המד העגול; משתמש באותם רכיבי משחק ובאותו מכפיל חי |
| `live/assets/` | תמונות תא הטייס והמד; סקריפט Vercel מוריד אותן מהקומיט הנעוץ ומגיש אותן מאותו אתר |
| `live/icons.json` | אייקוני Bootstrap Icons ‏1.13.1 מקוריים; פרטי הרישיון ב־`live/ASSETS.md` |
| `live/build-live.js` | **המרכיב** — מחבר את הקבצים לעיל לתוך `aviator-live.html` בשורש הרֵפו |
| `live/mock-fb.js` + `live/livetest.js` | בדיקת קצה-לקצה מול Firebase מדומה (Playwright) לפני פרסום |

### הלקוח הסולו (מול בוטים, GOD MODE)
`aviator.html` בשורש הרֵפו — **נערך ידנית**. אותו עיצוב, שחקנים = בוטים, ובו מצב
GOD (5 לחיצות על הלוגו + קוד מנהל). אין GOD MODE במשחק החי — בכוונה.

### השרת (Cloud Functions + חוקי גישה) — בשורש הרֵפו
| קובץ | תפקיד |
|---|---|
| `functions/aviator.js` | כל מנוע הכסף: `avJoin`, `avTick`, `avBet`, `avCancelBet`, `avCashout`, `avCredit`, `avPeek` + בוטים + הגרלה מוכחת-הוגנת + ספר חשבונות |
| `functions/index.js` | טוען את `aviator.js` לצד מנוע הפוקר |
| `firestore.rules` | חוקי הגישה לאוספי `aviator*` |

### הפרסום ל-Vercel — `aviator-src/vercel/`
| קובץ | תפקיד |
|---|---|
| `vercel/build.js` | סקריפט הבנייה של Vercel: מושך את שני הלקוחות מ-commit נעוץ, מבצע rewrites, כותב ל-`public/`, חותם `version.json` |
| `vercel/api/timing.js` | כתובת האבחון הציבורית נסגרה: מחזירה 404 ואינה קוראת נתוני תזמון. פתיחה מחדש מחייבת אימות בעלים בצד השרת |
| `vercel/manifest.json` | מניפסט ה-PWA |
| `vercel/sw.js` | Service worker (navigation-only, network-first) |
| `vercel/vercel.json.template` | תבנית ה-rewrites (פרוקסי `/__/auth`, אייקונים, `/solo`) — החלף `<SHA>` |
| `vercel/build-vercel2.js` | סקריפט בנייה ישן (היסטורי) |

---

## איך בונים מחדש את הלקוח החי

```bash
# משורש הרֵפו:
node aviator-src/live/build-live.js
node --check aviator-src/live/live-script-check.js
node --test aviator-ux.test.cjs
```

עורכים את קובצי המקור ב־`aviator-src/live/`, כולל `ux.css`, `ux.js` ו־`audio.js` —
ואז מריצים `build-live.js` מחדש. **לעולם לא עורכים את `aviator-live.html` ישירות**, כי
הבנייה הבאה תדרוס את השינוי.

קוד הצ׳אט וסגנונות ה־UI נכללים בתוך קובץ ה־HTML שנוצר; אין צורך להעלות קובצי
JavaScript או CSS נוספים ל־Vercel. בדיקות Node מאמתות את התנהגות הצ׳אט והשמע
ושבנייה מקובצי המקור מפיקה בדיוק את הלקוח השמור. הן אינן בדיקת תצוגה בדפדפן.

בדיקת קצה-לקצה לפני פרסום (דורש Playwright + chromium):
```bash
cd aviator-src/live
python3 -m http.server 8765 --directory ../../ &   # מגיש את aviator-live.html
node livetest.js                                   # מריץ את הזרימה מול mock-fb
```

---

## איך מפרסמים

### 1. השרת (פונקציות + חוקים) — אוטומטי דרך GitHub Actions
כל דחיפה שנוגעת ב-`functions/**` או ב-`firestore.rules` לענפים `main`,
`claude/pokerten-v1`, או `claude/gambling-game-graph-08c7yw` מפעילה פרסום אוטומטי
(`.github/workflows/deploy-functions.yml` + `deploy-firestore-rules.yml`, סוד
`FIREBASE_TOKEN`).

> ⚠️ **גוטצ'ה קריטי:** פרסום פונקציות רץ עם `--force`, שמוחק כל פונקציה שלא קיימת
> בענף המפורסם. אם `functions/aviator.js` לא קיים ב-`main`, פרסום פוקר מ-`main`
> **ימחק את כל פונקציות ה-AVIATOR** והמשחק יקרוס. לכן `functions/aviator.js`
> ו-`firestore.rules` **חייבים להישאר משוכפלים גם ב-`main`** בכל שינוי.

### 2. הלקוח — ידני ל-Vercel (פרויקט `orizis-aviator`, צוות `yoni-s-projects3k`)
Vercel לא בנוי מהרֵפו — כל פרסום הוא העלאת קבצים שכל הלוגיקה שלה ב-`build.js`:

1. דחוף את שינויי המקור לרֵפו וקבל את ה-commit SHA.
2. ב-`vercel/build.js` וב-`vercel.json` החלף את ה-SHA ל-commit הזה.
3. פרוס ל-production עם קבצי: `build.js`, `api/timing.js`, `manifest.json`,
   `sw.js`, `vercel.json` — הגדרות בנייה: `buildCommand: "node build.js"`,
   `outputDirectory: "public"`, `installCommand: ""`, `framework: null`.
4. אמת: `https://www.aviatorizis.com/version.json` צריך להחזיר את 7 התווים
   הראשונים של ה-SHA. תג הגרסה מופיע גם בפינה שמאל-למטה במשחק.

הלקוח בודק את `version.json` כל דקה ומתרענן לבד בתחילת סיבוב כשיש גרסה חדשה, כך
שאין צורך לבקש משחקנים "לסגור ולפתוח".

---

## סודות ותצורה (לא בקוד)

- **קוד המנהל** (פותח GOD MODE, לוח המנהל והטענות צ'יפים בזמן שכניסת גוגל מושבתת):
  שמור רק כ-SHA-256 ב-`functions/aviator.js` (`OWNER_CODE_HASH`) וב-`aviator.html`
  (`GOD_HASH`). הקוד עצמו אינו ברֵפו. להחלפה: חשב hash חדש והחלף בשני המקומות.
- **הרשאות מנהל לפי מייל:** `aaci.yoni@gmail.com` (משמש לזיהוי בלבד).
- **Firebase:** פרויקט `pokerten`, אזור `us-central1`. הגרלת נקודת הקראש נעשית
  בשרת בלבד; המסמך `aviator/_engine` אינו קריא ללקוח.

## עקרונות שאסור לשבור
- כסף משחק בלבד — לא להפוך לכסף אמיתי.
- במשחק החי אף אחד (גם לא המנהל) לא רואה את נקודת הקראש מראש ומהמר באותו סיבוב:
  `avPeek` נועל כל סיבוב שנצפה ל"צפייה בלבד" עבור אותו משתמש.
- תשלום היציאה = בדיוק המספר שהוצג על מסך השחקן (מוגבל רק בנקודת הקראש).

## Timing protocol 2

The graph and central instrument use integer hundredths, capped at the latest
server-confirmed, player-bound signed quote. Network silence freezes the value
and disables manual cashout after the freshness window; it never extrapolates
past an unknown crash. A manual exit is valid only if the request reaches the
function before the crash. Stored automatic targets are settled by the server,
including when a player disconnects. No zero-latency network guarantee is made.

Bet, cancellation and cashout requests include round and request IDs. Successful
retries return the recorded result without moving chips again. Arrival time is
captured before the transaction, so a timely request waiting behind settlement
can correct the same archived bet once. The live supervisor view ignores stale
responses and retains the watch-only restriction for a round already viewed.

Validation: `node --test functions/aviator.test.js` (in-memory Firestore dependency
fixture, no production writes), then `node aviator-src/live/build-live.js` and
`node --check aviator-src/live/live-script-check.js`. `functions/test/preview.js`
serves the real client against the same isolated handlers for browser QA.

Deployment requires the client and server changes together. Deploy the client
preview first; it waits for protocol 2 rather than sending legacy actions. Keep
the backend changes in main as well as the Aviator branch, since both can deploy
to the shared Firebase project. Do not deploy unrelated poker functions from an
outdated Aviator branch. Roll back client and server together if needed.


## עדכון משולב: תזמון ותא טייס רחב

המקור כולל כעת מחיר שרת חתום, מאיות מכפיל ותשלום בצ׳יפים שלמים. המספר והגרף נעצרים כאשר הנתון מתיישן; אין המשך אקסטרפולציה. בלחיצה מוצג המספר שנשלח, ורק אישור השרת מציג הצלחה. זמן תגובת `avTick` וזמן אישור המשיכה מוצגים במילישניות ונמדדים במכשיר; הם אינם הבטחה לזמן הגעה קבוע.

משיכה ידנית מתקבלת רק כאשר הבקשה מגיעה לפונקציה לפני נקודת העצירה, עם מחיר חתום תקף. השוויון שייך לעצירה. יעד אוטומטי שכבר הופעל קודם להגעה קובע את המחיר. בקשה ידנית שהגיעה לפני היעד נשארת ידנית גם אם עסקת הזיכוי האוטומטי השיגה את נעילת מסד הנתונים קודם. זיכוי קודם מתוקן בדלתא מתועדת, ללא זיכוי כפול.

45 בדיקות מקומיות: `node --test functions/aviator.test.js aviator-src/live/timing.test.cjs aviator-ux.test.cjs`.
`npm run dev -- --port 4173` מפעיל שרת בדיקה מבודד עם Firestore בזיכרון; הוא אינו מתחבר ליתרות הייצור. `/review.html` מכיל iframe ברוחב 390 פיקסלים לבדיקת CSS מובייל אמיתי. אין לכלול את שרת הבדיקה בפריסת Vercel.

### סדר פריסה

1. להשלים בדיקת דפדפן לגרסת הבדיקה; סטטוס מפורט ב־`design-qa.md`.
2. לשמור את `functions/aviator.js` ואת `functions/aviatorCore.js` גם ב־`main` וב־`claude/pokerten-v1`, עם תיקון workflow מתאים וללא דריסת קוד פוקר. לא למזג ענף AVIATOR ישן במלואו ל־main.
3. workflow ענף AVIATOR פורס רק את שבע פונקציות AVIATOR. הוא פורס קודם `avBet` המחייב מזהי פעולה ומסמן הימורים חדשים `protocol:2`, ואז את יתר הפונקציות. אין `--force` ואין פריסה של פונקציות פוקר.
4. בהימורים קיימים בלבד, שנוצרו לפני protocol 2, השרת מאפשר משיכה/ביטול בפורמט הישן. אי אפשר להוריד הימור חדש לפורמט הישן. לקוח ישן נדרש לרענן לפני הימור חדש. בקרת המנהל הישנה נדרשת לרענן גם היא כדי לשלוח מזהה סיבוב.
5. לאחר אימות פריסת הפונקציות, לפרוס Vercel ידנית עם SHA מלא נעוץ לפי הכלים ב־`aviator-src/vercel/`. דחיפת GitHub אינה מפרסמת את הלקוח.
6. לאמת `/version.json`, מסך מחשב ומובייל, ולפחות משיכה אחת של אסימוני בדיקה. `/api/timing` נשאר 404 ללא שאילתות Firebase.

ההסתברויות, יתרון הבית, קוד המנהל וקוד הפוקר לא שונו. יעד האוטומטי העליון בשרת נשמר 1000x. יעד אוטומטי בניתוק מתחשבּן בשרת עם קידום הסיבוב, גם אם הלקוח של אותו שחקן אינו מחובר.


### מפת עולם ומטוס
מפת העולם מוטמעת בלקוח מקובץ המקור `aviator-src/live/assets/world-110m.json`, ונצבעת לשכבה בזיכרון רק כשהמידות משתנות. כך היא אינה נעלמת עקב כשל בבקשת רשת ואינה מחושבת מחדש בכל פריים. המטוס הריאליסטי הוא קובץ WebP קטן שנטען פעם אחת. מיקומו נגזר מאותו מכפיל מוצג ומאושר של הגרף. גרפיקת הטיסה נמצאת ב־`aviator-src/live/flight-visuals.js`; ב־Vercel מפורסמים `cockpit.webp` ו־`flight-jet.webp`.

בקשות מחיר במהלך טיסה קוראות את מצב הסיבוב והמנוע ללא עסקת כתיבה, ובודקות שוב את הזמן ואת התאמת הסיבוב לאחר הקריאה. כך הן אינן מחזיקות נעילות עסקה הדרושות למשיכה. מעברי סיבוב והתחשבנות נשארים בעסקה מוסמכת.

### בדיקת התאמת הגרף והמשיכה — 10.9.2026
תוקן פער שבו הצטרפות לטיסה מתקדמת משאירה את קנה המידה האופקי מאחור: קצה הקו יכול היה להסתיים מתחת למטוס ולמספר המרכזי. כעת קנה המידה מכיל תמיד את נקודת הזמן המאושרת, ורק המרווח סביבה משתנה בהדרגה.

נוספו בדיקות המחברות את פונקציות התצוגה והמשיכה מהלקוח שנבנה למנוע השרת, עם תלויות DOM/Canvas ו־Firestore מדומות בזיכרון. הן בודקות מספר מוצג → מטען שנשלח → התחשבנות → תשובה: הגעה לפני עצירה ותשובה אחריה, הגעה מאוחרת שנדחית, אובדן תשובה וניסיון חוזר ללא זיכוי כפול, ויעד אוטומטי שמסומן במפורש. אלו אינן בדיקות דפדפן ואינן מדידת השהיה ברשת הייצור; חסימת הדפדפן עדיין מתועדת ב־`design-qa.md`.

### אימות שרת חי בזמן פרסום
לאחר פריסת שבע פונקציות AVIATOR, ה־workflow מפעיל `node functions/test/aviatorLiveProbe.cjs --confirm-play-money-production`. הבדיקה משתמשת בכניסת אורח זמנית משלה ובאסימוני המשחק בלבד. היא בודקת משיכה ידנית, מחיר מדויק במאיות, זיכוי בצ׳יפים שלמים, ניסיונות חוזרים ללא חיוב או זיכוי כפולים ומשיכה אוטומטית ללא שליחת פקודת משיכה מהלקוח. היתרה וההימור נקראים ב־Firestore עם הרשאת אותו אורח. חשבון ההתחברות הזמני נמחק בסיום; רישומי המשחק נשמרים להתחשבנות.

הבדיקה מפיקה קבלה מסכמת וזמני תגובה מה־runner ב־GitHub Actions, ללא אסימוני התחברות או קוד מנהל בלוג. אלו אינם זמני ההשהיה במכשיר השחקן ואינם בדיקת דפדפן. בדיקת ה־API אינה פותחת את `/api/timing`, שנשאר סגור.
