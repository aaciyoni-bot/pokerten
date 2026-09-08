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
| `vercel/api/timing.js` | פונקציית `/api/timing` — אבחון תזמון היציאות (מה השחקן ראה מול מה השרת חישב) |
| `vercel/manifest.json` | מניפסט ה-PWA |
| `vercel/sw.js` | Service worker (navigation-only, network-first) |
| `vercel/vercel.json.template` | תבנית ה-rewrites (פרוקסי `/__/auth`, אייקונים, `/solo`) — החלף `<SHA>` |
| `vercel/build-vercel2.js` | סקריפט בנייה ישן (היסטורי) |

---

## איך בונים מחדש את הלקוח החי

```bash
# מתוך תיקייה שמכילה את aviator-src/live/ ואת aviator-live.html:
cd aviator-src/live
node build-live.js        # כותב ../../aviator-live.html
node --check ../../aviator-live.html  # (אופציונלי) בדיקת תחביר על התסריט המחולץ
```

עורכים אך ורק את `main1.js` / `main2.js` / `extra.css` / `extra.html` / `module.html` —
ואז מריצים `build-live.js` מחדש. **לעולם לא עורכים את `aviator-live.html` ישירות**, כי
הבנייה הבאה תדרוס את השינוי.

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
