"""Read every populated XLSX cell; map the four established workbook layouts.
Private output is written OUTSIDE the source tree. No workbook data is committed.
Usage: python prepare-workbook.py workbook.xlsx existing-roster.json output.json
"""
import sys, json, re, hashlib, collections
from decimal import Decimal, InvalidOperation
from datetime import datetime, timedelta
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as E

NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def text(x): return re.sub(r'\s+',' ',re.sub('[\u200e\u200f\u202a-\u202e\u2066-\u2069]','',str(x or ''))).strip()
def integer(x):
    try:
        n=Decimal(str(x)); return str(int(n)) if n.is_finite() and n==int(n) else ''
    except (InvalidOperation,ValueError,OverflowError): return ''
def identity(x):
    s=integer(x) or text(x); return s if re.fullmatch(r'\d{6,8}',s) else ''
def namekey(x): return ' '.join(sorted(re.findall(r'[\w]+',text(x))))
def phone(x):
    s=integer(x) or re.sub(r'[^0-9]','',text(x))
    if len(s)==9 and s.startswith('5'):s='0'+s
    return s if re.fullmatch(r'0\d{9}',s) else ''
def date(x):
    n=integer(x)
    return (datetime(1899,12,30)+timedelta(days=int(n))).date().isoformat() if n and 30000<int(n)<70000 else ''
def extract(filename):
    z=ZipFile(filename); ss=[]
    if 'xl/sharedStrings.xml' in z.namelist():
        ss=[''.join(t.text or '' for t in si.findall('.//s:t',NS)) for si in E.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',NS)]
    rels={x.attrib['Id']:x.attrib['Target'] for x in E.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    wb=E.fromstring(z.read('xl/workbook.xml'));pr=wb.find('s:workbookPr',NS)
    if pr is not None and pr.get('date1904') in ['1','true']:raise ValueError('Unsupported 1904 epoch; do not guess dates')
    out=[]
    for sh in wb.findall('s:sheets/s:sheet',NS):
        target=rels[sh.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
        target=target.lstrip('/') if target.startswith('/') else 'xl/'+target
        rows=[]
        for row in E.fromstring(z.read(target)).findall('s:sheetData/s:row',NS):
            cells={}
            for c in row.findall('s:c',NS):
                v=c.find('s:v',NS); val=v.text if v is not None else ''
                if c.get('t')=='s':val=ss[int(val)] if val else ''
                if c.get('t')=='inlineStr':val=''.join(x.text or '' for x in c.findall('.//s:t',NS))
                f=c.find('s:f',NS)
                if val or f is not None:cells[re.sub(r'\d','',c.get('r'))]={'value':val,'type':c.get('t','n'),**({'formula':f.text} if f is not None else {})}
            if cells:rows.append({'row':int(row.get('r')),'cells':cells})
        out.append({'name':sh.get('name'),'state':sh.get('state','visible'),'rows':rows})
    tables=[{'name':r.get('name'),'range':r.get('ref')} for n in z.namelist() if n.startswith('xl/tables/') and n.endswith('.xml') for r in [E.fromstring(z.read(n))]]
    return out,tables

def prepare(filename,roster):
    sheets,tables=extract(filename)
    assert len(sheets)==4 and sheets[2]['name']=='נהגים ונוהגים גדוד 1894','Workbook layout changed'
    batch='workbook-'+hashlib.sha256(Path(filename).read_bytes()).hexdigest()[:20]
    ds={}; review=[]; covered=set(); rowlabels={}
    def rows(si):return [(r['row'],{c:v['value'] for c,v in r['cells'].items()}) for r in sheets[si]['rows']]
    def source(si,r,d,label):
        for c in d:covered.add((si,r,c))
        rowlabels[(si,r)]=label
        return {'sheet':sheets[si]['name'],'row':r,'values':{k:text(v) for k,v in d.items()}}
    def problem(kind,message,src,**extra):review.append({'kind':kind,'message':message,'source':src,**extra})
    # Main table has the most complete identity/contact records. Repeated IDs merge,
    # but disagreements are preserved and shown in the record, never silently replaced.
    candidates=collections.defaultdict(set)
    for si in [0,1,2]:
        for r,d in rows(si):
            cols=('D','E') if si==2 else ('J','K') if si==0 and 67<=r<=87 else ('K','L') if si==0 and 99<=r<=132 else ('A','B') if si==1 and (4<=r<=22 or 32<=r<=49 or 55<=r<=57) else None
            if cols and identity(d.get(cols[1])):candidates[namekey(d.get(cols[0]))].add(identity(d.get(cols[1])))
    main_ids={identity(d.get('E')) for r,d in rows(2) if d.get('D') and identity(d.get('E'))}
    def add(pn,name,values,src,permit_yes=None,permit_no=None):
        if not pn:
            ids=candidates.get(namekey(name),set())
            if len(ids)==1:pn=next(iter(ids))
        if not pn:
            problem('driver-identity','חסר מספר אישי חד־משמעי; הרשומה נשמרה לבדיקה',src,name=name);return
        ids=candidates.get(namekey(name),set())
        if pn not in main_ids and len(ids)>1 and ids&main_ids:
            problem('driver-id-conflict','מספר אישי סותר את טבלת הגדוד; אין איחוד אוטומטי',src,pn=pn,name=name);return
        d=ds.setdefault(pn,{'pn':pn,'name':text(name),'sources':[],'importReview':[],'permits':[]})
        if namekey(name)!=namekey(d['name']) and text(name)!=d['name']:
            # Cosmetic spelling variants are retained as alternatives too.
            d['importReview'].append({'field':'name','current':d['name'],'incoming':text(name),'source':src['sheet']+':'+str(src['row'])})
            if namekey(name).split()[0:1]!=namekey(d['name']).split()[0:1] and not set(text(name).split())&set(d['name'].split()):
                problem('driver-name-conflict','מספר אישי מופיע בשמות שונים; שורה זו לא מוזגה',src,pn=pn);return
        d['sources'].append(src)
        for k,v in values.items():
            if v in ['',None,[]]:continue
            if not d.get(k):d[k]=v
            elif d[k]!=v:
                if k in ['courses','notes','requestedPermits','trainingPlan','refreshRequired']:
                    if text(v) not in d[k].split('\n'):d[k]+='\n'+text(v)
                else:d['importReview'].append({'field':k,'current':d[k],'incoming':v,'source':src['sheet']+':'+str(src['row'])})
        for p in permit_yes or []:
            if p not in d['permits']:d['permits'].append(p)
        if permit_no is not None:d.setdefault('permitNotMarked',[]).extend(p for p in permit_no if p not in d.get('permitNotMarked',[]))
    permits=dict(zip('JKLMNOPQ',['האמר (41)','אושקוש (96)','אמבולנס (52)','דוד (36)','סוואנה (26)','זאב (47,48)','מלגזה (15)','חומ״ס (20,25)']))
    for r,d in rows(2):
        if r==1:source(2,r,d,'headers');continue
        src=source(2,r,d,'driver' if d.get('D') else 'unassigned')
        if not d.get('D'):
            problem('unassigned-row','שורת רישוי ללא שם ומספר אישי',src);continue
        pn=identity(d.get('E')); ph=phone(d.get('F'))
        values={'company':text(d.get('A')),'dept':text(d.get('B')),'role':text(d.get('C')),'phone':ph,'license':text(d.get('H')),'trailer':text(d.get('G')),'private':text(d.get('I')),'lastRefresh':date(d.get('R')),'courses':'\n'.join(text(d.get(c)) for c in ['S','T'] if d.get(c))}
        if d.get('F') and not ph:values['notes']='טלפון בקובץ דורש בדיקה: '+text(d['F'])
        add(pn,d['D'],values,src,[p for c,p in permits.items() if d.get(c)=='1'],[p for c,p in permits.items() if d.get(c)=='0'])
    for si in [0,1]:
        for r,d in rows(si):
            cols=('J','K','L','M','N','O','P') if si==0 and 67<=r<=87 else ('K','L','M',None,'N','O',None) if si==0 and 99<=r<=132 else ('A','B','C',None,'D','G',None) if si==1 and (4<=r<=22 or 32<=r<=49) else None
            if cols and d.get(cols[0]):
                nc,pc,rc,lc,perm,phc,note=cols
                subset={c:d[c] for c in set(filter(None,cols))|({'E','F','H','I'} if si==1 else set()) if c in d}
                src=source(si,r,subset,'driver-supplement')
                pn=identity(d.get(pc)); name=text(d[nc]); vals={'role':text(d.get(rc)),'requestedPermits':text(d.get(perm)),'license':text(d.get(lc)) if lc and d.get(lc)!='רענון' else ''}
                if note and d.get(note):vals['notes']=text(d[note])
                if lc and d.get(lc)=='רענון':vals['refreshRequired']=text(d.get(perm))
                ph=phone(d.get(phc)) or (phone(d.get('H')) if si==1 else '')
                if ph:vals['phone']=ph
                elif d.get(phc):vals['notes']='\n'.join(filter(None,[vals.get('notes'),text(d[phc])]))
                if si==1:
                    vals['trainingPlan']='\n'.join(text(d.get(c)) for c in ['H','I'] if d.get(c) and not phone(d[c]))
                    if r>=32 and d.get('E')=='כן':vals['license']='C1'
                confirmed=[];p=text(d.get(perm))
                if 'קיים היתר' in p:
                    if 'טיגריס' in p.split('(')[0]:confirmed.append('טיגריס')
                    if 'קיים היתר סוואנה' in p:confirmed.append('סוואנה (26)')
                if si==1 and r<30 and d.get('E')=='כן':confirmed.append('דוד (36)')
                if si==1 and r>=32 and d.get('F')=='כן' and 'טיגריס' in p:confirmed.append('טיגריס')
                # A conflicting full ID is not guessed from name or padded with a zero.
                ids=candidates.get(namekey(name),set())
                if pn and len(ids)>1 and pn not in ds:
                    problem('driver-id-conflict','אותו שם מופיע במספרים אישיים שונים; אין איחוד אוטומטי',src,pn=pn,name=name);continue
                add(pn,name,vals,src,confirmed)
            if si==1 and 55<=r<=57 and d.get('A'):
                add(identity(d.get('B')),d['A'],{'refreshRequired':'דוד'},source(si,r,{c:d[c] for c in ['A','B'] if c in d},'refresh-request'))
            if si==1 and r in [9,10,14,15] and d.get('K'):
                add(identity(d.get('L')),d['K'],{'trainingPlan':('בקשה להכניס להיתר דוד' if r<13 else 'בקשה להוריד מהיתר דוד')},source(si,r,{c:d[c] for c in ['K','L'] if c in d},'permit-change-request'))
    for d in ds.values():
        for p in set(d['permits'])&set(d.get('permitNotMarked',[])):
            d['importReview'].append({'field':'permits','current':'לא מסומן בטבלת הגדוד','incoming':p,'source':'סתירה בין לשוניות; יש לבדוק היתר'})
        if 'רישיון מבוטל' in d.get('notes',''):d['licenseStatus']='רישיון מבוטל — לפי הקובץ'
        d['permitBasis']='דיווח בקובץ, לא אימות רישיון'
    known={re.sub(r'\D','',v['number']):v for v in (roster if isinstance(roster,list) else roster['vehicles'])}
    vehicles=[]
    for r,d in rows(3):
        if r==1:source(3,r,d,'headers');continue
        src=source(3,r,d,'vehicle' if d.get('C') else 'counter')
        if not d.get('C'):continue
        key=integer(d['C']) or re.sub(r'\D','',text(d['C'])); vals={}
        for col,field in [('D','km'),('E','nextServiceKm'),('G','extinguisherCount')]:
            if integer(d.get(col)):vals[field]=int(integer(d[col]))
        if d.get('E') and not integer(d['E']):
            vals['nextServiceNote']=text(d['E'])
            if text(d['E'])=='עד סוף אוקטובר 2026':vals.update(nextServiceDate='2026-10-31',serviceDateKind='deadline')
        if d.get('K') and date(d['K']):vals['testExpiry']=date(d['K'])
        vals.update({k:text(d.get(c)) for c,k in [('H','driverTools'),('I','inspectionPhotoNote'),('J','notes')] if d.get(c)})
        if d.get('F'):vals['reportedRemainingKm']=int(integer(d['F'])) if integer(d['F']) else text(d['F'])
        item={'number':key,'type':text(d.get('B')),'fields':vals,'sources':[src]}
        near=[k for k in known if len(k)==len(key) and sum(a!=b for a,b in zip(k,key))==1]
        if key not in known and near:
            problem('vehicle-id-conflict','מספר חדש דומה למספר קיים; הרשומה ממתינה לזיהוי ואינה מעדכנת רכב אחר',src,number=key,candidates=near,vehicle=item);continue
        if key not in known:item['create']={'unit':'POOL','status':'לא כשיר' if d.get('I')=='במוסך' else 'ממתין לשיבוץ'}
        vehicles.append(item)
    # Separate right-hand vehicle table in sheet 2; not linked to the driver on that row.
    for r,d in rows(1):
        if r==34 and d.get('AD'):
            src=source(1,r,{c:d[c] for c in ['U','V','W','X','Y','Z','AA','AB','AC','AD'] if c in d},'vehicle-side-table')
            key=integer(d['AD']) or re.sub(r'\D','',d['AD']);vals={'km':int(integer(d['AB'])),'nextServiceKm':int(integer(d['AA'])),'serviceIntervalKm':int(integer(d['W'])),'fuelCode':integer(d.get('X')) or text(d.get('X')),'testExpiry':date(d.get('Z')),'sourceFrameworkLabel':'פלוגה אורי — נדרש בירור'}
            vehicles.append({'number':key,'type':text(d['AC']),'fields':vals,'sources':[src],**({'create':{'unit':'POOL','status':'ממתין לשיבוץ'}} if key not in known else {})})
    # Explicitly retain every remaining cell: orphan notes, table headers, counters,
    # training annotations and ambiguous labels. They remain readable in the import report.
    unmapped=[]
    for si,s in enumerate(sheets):
        for r in s['rows']:
            rest={c:v['value'] for c,v in r['cells'].items() if (si,r['row'],c) not in covered}
            if rest:unmapped.append({'sheet':s['name'],'row':r['row'],'values':rest})
    result={'schema':'fleet-workbook-v1','id':batch,'filename':Path(filename).name,'sha256':hashlib.sha256(Path(filename).read_bytes()).hexdigest(),'drivers':list(ds.values()),'vehicles':vehicles,'review':review,'unmapped':unmapped,'sourceSheets':sheets,'tables':tables}
    result['counts']={'sheets':len(sheets),'tables':len(tables),'drivers':len(ds),'vehicleRecords':len(vehicles),'reviewItems':len(review),'unmappedRows':len(unmapped),'sourceCells':sum(len(r['cells']) for s in sheets for r in s['rows'])}
    return result

if __name__=='__main__':
    result=prepare(sys.argv[1],json.loads(Path(sys.argv[2]).read_text()))
    Path(sys.argv[3]).write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')))
    print(json.dumps(result['counts'])); print('bytes',Path(sys.argv[3]).stat().st_size)
