'use strict';
// A legacy cycle has no inferred calendar boundary. Only an authenticated,
// recorded confirmation establishes it; Monday and clock passage never do.
const timestamp=n=>Number.isSafeInteger(n)&&n>=0&&n<=8640000000000000;
function legacyPeriod(record,now=Date.now()){
 const valid=record?.source==='manager-confirmed'&&typeof record.confirmedBy==='string'&&record.confirmedBy.length>0&&timestamp(record.confirmedAt)&&record.confirmedAt<=now&&timestamp(record.startAt)&&record.startAt<=record.confirmedAt;
 return{id:'legacy_current',number:0,legacy:true,status:'open',startAt:valid?record.startAt:null,endAt:null,autoClose:false,needsPeriodStart:!valid};
}
function dateRange(fromAt,toAt,now=Date.now()){
 if(!timestamp(fromAt)||!timestamp(toAt)||fromAt>=toAt||fromAt>now||toAt>now+366*86400000)throw new RangeError('Choose a valid From / To date range.');
 return{id:'date_range',number:0,legacy:true,historicalRange:true,status:'range',startAt:fromAt,endAt:toAt,autoClose:false,needsPeriodStart:false};
}
const inPeriod=(at,period,now=Date.now())=>timestamp(at)&&timestamp(period?.startAt)&&at>=period.startAt&&at<=now&&(period.endAt==null||at<period.endAt);
module.exports={timestamp,legacyPeriod,dateRange,inPeriod};
