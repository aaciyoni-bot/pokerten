/* ZADALOG — shared data ------------------------------------------------- */
window.ZD = (function () {
  'use strict';

  /* Ports: [code, name-en, name-he, lat, lon] */
  var PORTS = {
    SHA: ['SHA', 'Shanghai',  'שנחאי',      31.2, 121.5],
    NGB: ['NGB', 'Ningbo',    'נינגבו',     29.9, 121.6],
    SZX: ['SZX', 'Shenzhen',  'שנג׳ן',      22.5, 114.1],
    SIN: ['SIN', 'Singapore', 'סינגפור',     1.3, 103.8],
    BUS: ['BUS', 'Busan',     'בוסאן',      35.1, 129.0],
    MUN: ['MUN', 'Mundra',    'מונדרה',     22.8,  69.7],
    JEA: ['JEA', 'Jebel Ali', 'ג׳בל עלי',   25.0,  55.1],
    IST: ['IST', 'Istanbul',  'איסטנבול',   41.0,  29.0],
    PIR: ['PIR', 'Piraeus',   'פיראוס',     37.9,  23.6],
    RTM: ['RTM', 'Rotterdam', 'רוטרדם',     51.9,   4.5],
    ANR: ['ANR', 'Antwerp',   'אנטוורפן',   51.2,   4.4],
    HAM: ['HAM', 'Hamburg',   'המבורג',     53.5,  10.0],
    VLC: ['VLC', 'Valencia',  'ולנסיה',     39.4,  -0.3],
    NYC: ['NYC', 'New York',  'ניו יורק',   40.7, -74.0],
    LAX: ['LAX', 'Los Angeles','לוס אנג׳לס',33.7,-118.2],
    ASD: ['ASD', 'Ashdod',    'אשדוד',      31.8,  34.6],
    HFA: ['HFA', 'Haifa',     'חיפה',       32.8,  35.0]
  };

  /* Animated hero routes: [from, to, curvature] */
  var ROUTES = [
    ['SHA', 'ASD', -0.24],
    ['NGB', 'HFA', -0.30],
    ['RTM', 'ASD',  0.20],
    ['NYC', 'HFA',  0.22],
    ['MUN', 'ASD', -0.16],
    ['IST', 'HFA',  0.30],
    ['VLC', 'ASD',  0.16],
    ['LAX', 'HFA',  0.26]
  ];

  /* Trade lanes for the network table */
  var LANES = [
    { from: 'SHA', to: 'ASD', days: '26–30', freq: 'weekly', svc: 'FCL / LCL' },
    { from: 'NGB', to: 'HFA', days: '27–31', freq: 'weekly', svc: 'FCL' },
    { from: 'SZX', to: 'ASD', days: '28–33', freq: 'biweekly', svc: 'FCL / LCL' },
    { from: 'SIN', to: 'HFA', days: '21–25', freq: 'weekly', svc: 'FCL' },
    { from: 'MUN', to: 'ASD', days: '14–18', freq: 'weekly', svc: 'FCL / LCL' },
    { from: 'JEA', to: 'HFA', days: '10–14', freq: 'weekly', svc: 'FCL' },
    { from: 'IST', to: 'ASD', days: '4–7',   freq: 'twice weekly', svc: 'FCL / LCL / RoRo' },
    { from: 'PIR', to: 'HFA', days: '3–5',   freq: 'twice weekly', svc: 'FCL / LCL' },
    { from: 'RTM', to: 'ASD', days: '16–20', freq: 'weekly', svc: 'FCL / LCL' },
    { from: 'HAM', to: 'HFA', days: '18–22', freq: 'weekly', svc: 'FCL' },
    { from: 'VLC', to: 'ASD', days: '8–11',  freq: 'weekly', svc: 'FCL / LCL' },
    { from: 'NYC', to: 'HFA', days: '18–23', freq: 'biweekly', svc: 'FCL' }
  ];

  /* Container specs — internal dimensions in cm, payload in kg */
  var CONTAINERS = [
    { id: '20',  label: "20' GP",  L: 589,  W: 235, H: 239, payload: 28200, cbm: 33.2 },
    { id: '40',  label: "40' GP",  L: 1203, W: 235, H: 239, payload: 26600, cbm: 67.7 },
    { id: '40hc',label: "40' HC",  L: 1203, W: 235, H: 269, payload: 26460, cbm: 76.3 },
    { id: '45hc',label: "45' HC",  L: 1355, W: 235, H: 269, payload: 27600, cbm: 86.0 }
  ];

  /* Cargo presets. `known` = industry-standard floor counts per container id. */
  var CARGO = [
    { id: 'eur',  he: 'משטח אירו', en: 'EUR pallet', dim: '120×80',
      L: 120, W: 80,  H: 150, kg: 600, stack: false,
      known: { '20': 11, '40': 25, '40hc': 25, '45hc': 27 } },
    { id: 'std',  he: 'משטח תקני', en: 'Standard pallet', dim: '120×100',
      L: 120, W: 100, H: 150, kg: 700, stack: false,
      known: { '20': 10, '40': 21, '40hc': 21, '45hc': 24 } },
    { id: 'boxL', he: 'קרטון גדול', en: 'Large carton', dim: '60×40×40',
      L: 60, W: 40, H: 40, kg: 25, stack: true },
    { id: 'boxM', he: 'קרטון בינוני', en: 'Medium carton', dim: '40×30×30',
      L: 40, W: 30, H: 30, kg: 12, stack: true },
    { id: 'drum', he: 'חבית', en: 'Drum', dim: '200L',
      L: 60, W: 60, H: 90, kg: 210, stack: true },
    { id: 'custom', he: 'מידות מותאמות', en: 'Custom dimensions', dim: '',
      L: 100, W: 80, H: 100, kg: 300, stack: true }
  ];

  /* Testimonials */
  var QUOTES = [
    { av: 'ד', he: { t: 'שלוש שנים שאנחנו מייבאים דרכם מסין. מה שהשתנה זה שאני כבר לא מתקשר לשאול איפה המכולה — הם מתקשרים אליי לפני שאני שואל.', n: 'דוד ל.', r: 'מנכ״ל, יבואן ריהוט' },
             en: { t: 'Three years importing from China with them. What changed is that I stopped calling to ask where the container is — they call me before I ask.', n: 'David L.', r: 'CEO, furniture importer' } },
    { av: 'ר', he: { t: 'הפריקה היא הסיפור. הגיעו בזמן, פרקו 40 פאלטים בשלוש שעות, ובסוף היום כבר היה לי דוח מצולם עם כל פריט. עם הספק בסין זה שווה זהב.', n: 'רונית מ.', r: 'מנהלת תפעול, רשת קמעונאית' },
             en: { t: 'The unloading is the real story. On time, 40 pallets in three hours, and a photo report in my inbox the same day. Against a supplier dispute that is worth its weight in gold.', n: 'Ronit M.', r: 'Head of ops, retail chain' } },
    { av: 'א', he: { t: 'עברנו אליהם אחרי שנתקענו עם מכולה שצברה ימי אחסנה. אצלם התיק היה מוכן לפני שהאונייה עגנה. חסכנו כסף כבר במשלוח הראשון.', n: 'אבי ש.', r: 'בעלים, יבוא חומרי גלם' },
             en: { t: 'We moved after getting stuck with a container racking up demurrage. With them the file was ready before the vessel berthed. We saved money on the first shipment.', n: 'Avi S.', r: 'Owner, raw materials import' } },
    { av: 'ט', he: { t: 'מה שאני הכי מעריך זה שאומרים לי גם כשיש בעיה. עיכוב בנמל, שינוי במחיר — אני שומע את זה מהם קודם, לא מהלקוח שלי.', n: 'טל ב.', r: 'סמנכ״ל רכש, יצרן מזון' },
             en: { t: 'What I value most is that they tell me when there is a problem. A port delay, a price change — I hear it from them first, not from my own customer.', n: 'Tal B.', r: 'VP procurement, food manufacturer' } }
  ];

  /* Ops ticker events */
  var TICKER = [
    { he: 'נפרקה במלואה · אשדוד', en: 'Fully unloaded · Ashdod' },
    { he: 'שוחררה ממכס · חיפה', en: 'Customs cleared · Haifa' },
    { he: 'הופלגה משנחאי', en: 'Departed Shanghai' },
    { he: 'עגנה בפיראוס', en: 'Berthed at Piraeus' },
    { he: 'נטענה לאונייה · נינגבו', en: 'Loaded on board · Ningbo' },
    { he: 'צוות פריקה בדרך', en: 'Unloading crew dispatched' },
    { he: 'תיק מכס הוגש', en: 'Customs file submitted' },
    { he: 'הגיעה למחסן הלקוח', en: 'Arrived at customer warehouse' },
    { he: 'קונסולידציה הושלמה · שנג׳ן', en: 'Consolidation complete · Shenzhen' },
    { he: 'דוח פריקה נשלח ללקוח', en: 'Unloading report sent to client' },
    { he: 'שטח שוריין להפלגה הבאה', en: 'Space booked on next sailing' },
    { he: 'עברה את תעלת סואץ', en: 'Transited the Suez Canal' }
  ];

  var VESSELS = ['MSC AURORA', 'EVER LINDEN', 'CMA CGM ARIES', 'ZIM QINGDAO',
                 'MAERSK SELETAR', 'ONE MERIDIAN', 'COSCO ATLAS', 'HAPAG BREMEN'];

  return { PORTS: PORTS, ROUTES: ROUTES, LANES: LANES, CONTAINERS: CONTAINERS,
           CARGO: CARGO, QUOTES: QUOTES, TICKER: TICKER, VESSELS: VESSELS };
})();
