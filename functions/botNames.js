'use strict';
const crypto=require('node:crypto');
const men=['יוסי|Yossi','אבי|Avi','איתי|Itay','אורן|Oren','דניאל|Daniel','תומר|Tomer','רועי|Roy','עידו|Ido','איציק|Itzik','שלומי|Shlomi','אלון|Alon','ניר|Nir','אמיר|Amir','גיא|Guy','עומר|Omer','רונן|Ronen','ליאור|Lior','אייל|Eyal','גיל|Gil','נדב|Nadav'].map(s=>s.split('|'));
const women=['נועה|Noa','מאיה|Maya','יעל|Yael','שירה|Shira','תמר|Tamar','מיכל|Michal','דנה|Dana','ליאת|Liat','אורית|Orit','איילת|Ayelet','הילה|Hila','נעמה|Naama','רוני|Roni','שני|Shani','נופר|Nofar','קרן|Keren','עדי|Adi','מור|Mor','רותם|Rotem','שחר|Shahar'].map(s=>s.split('|'));
const families=['כהן|Cohen|Kohen','לוי|Levi|Levy','מזרחי|Mizrahi|Mizrachi','פרץ|Peretz|Perez','ביטון|Biton','אברהם|Avraham|Abraham','פרידמן|Friedman|Fridman','שפירא|Shapira|Shapiro','רוזן|Rosen','כץ|Katz','דוד|David','אוחיון|Ohayon','גבאי|Gabay|Gabbay','חדד|Hadad|Haddad','אסולין|Assouline|Asulin','ברק|Barak','גולן|Golan','לביא|Lavi','הררי|Harari','אלון|Alon|Allon','שמש|Shemesh','סגל|Segal','שחר|Shahar|Shachar','ישראלי|Israeli','שלום|Shalom','ארבל|Arbel','רז|Raz','רבין|Rabin','הראל|Harel','כרמי|Carmi|Karmi','בן דוד|Ben-David|Ben David|Bendavid','דהן|Dahan','אזולאי|Azulay|Azoulay','מלכה|Malka','עמר|Amar','שרעבי|Sharabi','דיין|Dayan','אלבז|Elbaz','אמסלם|Amsalem','אדרי|Edri','סבן|Saban','טולדנו|Toledano','בוזגלו|Buzaglo','אשכנזי|Ashkenazi','ממן|Maman','קדוש|Kadosh','ברוך|Baruch','סויסה|Swissa|Suissa','חזן|Hazan|Chazan','נחום|Nahum|Nachum','ועקנין|Vaknin','לוגסי|Lugassi|Lugasi','אביטן|Avitan','שטרית|Shitrit|Sheetrit','יפרח|Ifrah','דניאלי|Danieli'].map(s=>s.split('|'));
const nick=['קפטן אס|Captain Ace','מלכת הלבבות|Queen of Hearts','דג מלוח|Salty Fish','פלאפל חריף|Spicy Falafel','קלף מנצח|Winning Card','רוח ים|Sea Breeze','שועל המדבר|Desert Fox','פלפל שחור|Black Pepper','לילה לבן|White Night','תות שדה|Strawberry','צ׳יפס בצד|Side of Chips','נס קפה|Nes Cafe','חומוס ביתי|Homemade Hummus','הפנתר|The Panther','טורבו|Turbo','ירח מלא|Full Moon','רביעיית אסים|Four Aces','דובדבן|Cherry','בזוקה|Bazooka','הקוסמת|The Magician'].map(s=>s.split('|'));
const normal=s=>String(s||'').normalize('NFKC').trim().toLowerCase().replace(/[־–—-]/g,' ').replace(/\s+/g,' ');
const nickKeys=new Set(nick.flat().map(normal));
const aliases=families.flatMap((f,i)=>f.map(a=>[normal(a),String(i)])).sort((a,b)=>b[0].length-a[0].length);
const generic=name=>!String(name||'').trim()||/^bot(?:[\s_-]*\d+)?$/i.test(String(name).trim());
const language=name=>/[א-ת]/.test(name||'')?'he':/[a-z]/i.test(name||'')?'en':null;
function familyKey(name){
 const n=normal(name);if(nickKeys.has(n)||!n.includes(' '))return null;
 for(const [alias,key] of aliases)if(n.endsWith(' '+alias))return key;
 const last=n.split(' ').at(-1);return /^\d+$/.test(last)?null:'other:'+last;
}
// Full names are unique in the supplied roster; family uniqueness is scoped to
// the actual table. Tournament registration can contain hundreds of entrants.
function botName(uid,used=[],options={}){
 const table=options.tableNames??used,names=new Set(used.map(normal)),keys=new Set(table.map(familyKey).filter(Boolean));
 const counts={he:0,en:0};for(const n of table){const l=language(n);if(l)counts[l]++;}
 for(let salt=0;salt<10000;salt++){
  const h=crypto.createHash('sha256').update(String(uid)+':'+salt).digest();
  const lang=options.language||(counts.he===counts.en?(h[7]%2?'he':'en'):counts.he<counts.en?'he':'en'),ix=lang==='he'?0:1;
  const first=h[0]%2?women:men;
  const name=h[1]%4===0?nick[h.readUInt16BE(2)%nick.length][ix]:first[h.readUInt16BE(4)%first.length][ix]+' '+families[h.readUInt16BE(6)%families.length][ix];
  if(!names.has(normal(name))&&(!familyKey(name)||!keys.has(familyKey(name))))return name;
 }
 throw Error('No unused bot display name available');
}
// Repair existing seats too, without changing identities, stacks or cards.
// A supplied tournament roster is updated so moves and results keep the name.
function renameGenericBots(players,roster,options={}){
 let changed=false;const entries=Object.entries(players||{}),table=options.table!==false;
 const used=entries.filter(([,p])=>!p.isBot).map(([,p])=>p.name||p.username).filter(Boolean);
 const bots=entries.filter(([,p])=>p.isBot).sort(([a,p],[b,q])=>(p.seatIndex??999)-(q.seatIndex??999)||a.localeCompare(b));
 const save=(uid,p,name)=>{if(p.name!==name){p.name=name;changed=true;}if('username'in p&&p.username!==name){p.username=name;changed=true;}if(roster?.[uid]&&roster[uid].name!==name){roster[uid].name=name;changed=true;}};
 for(const [uid,p]of bots){
  let name=roster?.[uid]?.name||p.name||p.username;
  const conflict=generic(name)||used.some(n=>normal(n)===normal(name)||table&&familyKey(name)&&familyKey(n)===familyKey(name));
  if(conflict){const rosterNames=roster?Object.entries(roster).filter(([id])=>id!==uid).map(([,p])=>p.name):[];name=botName(uid,[...used,...rosterNames],{tableNames:table?used:[]});}
  save(uid,p,name);used.push(name);
 }
 if(table&&bots.length>=2){
  const scripts=new Set(bots.map(([,p])=>language(p.name)));
  if(!scripts.has('he')||!scripts.has('en')){
   const [uid,p]=bots.at(-1),others=entries.filter(([id])=>id!==uid).map(([,p])=>p.name||p.username),rosterNames=roster?Object.entries(roster).filter(([id])=>id!==uid).map(([,p])=>p.name):[];
   save(uid,p,botName(uid,[...others,...rosterNames],{tableNames:others,language:scripts.has('en')?'he':'en'}));
  }
 }
 return changed;
}
module.exports={botName,renameGenericBots,generic,familyKey,language};
