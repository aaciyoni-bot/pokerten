'use strict';
module.exports=function fixture(role='player',uid='player'){
 const cycle={id:'cycle_1',number:1,startAt:1,endAt:Date.now()+86400000,status:'open',autoClose:false};
 const player={playerId:uid,playerName:'השחקן שלי',totals:{result:-34017,hands:20,games:1},rows:[{tableId:'t',tableName:'NLH 1/2',kind:'cash',result:-34017,hands:20,games:1}],opening:0,paid:0,closing:-34017,counterparties:[{id:'agent',name:'הסוכן שלי',closing:-34017}]};
 const pair={agentId:'agent',playerId:'other',playerName:'Other human player',totals:{result:-34017,rake:1000,rakeback:0,hands:20,games:1},rows:[{...player.rows[0],rake:1000}],opening:0,paid:0,activity:-34017,closing:-34017};
 const a={agentId:uid,agentName:'סוכן א׳',playersResult:-34017,rake:1000,hands:20,commission:500,earnings:500,leadsIncome:0,opening:0,paid:0,toClub:33517,closing:33517,leads:[],players:[]};
 return{active:true,role,clubPartyId:'owner',cycle,cycles:[cycle],currentCycleId:cycle.id,activatedAt:1,payments:[],approvals:[],...(role==='player'?{player,balance:15983}:role==='agent'?{player,agent:a,details:[pair],funds:[{uid:'other',balance:15983}]}:{club:{totals:{playersResult:-34017,rake:1000,commission:500,leadsIncome:0,hands:20,toClub:33517,closing:33517},rows:[a]},agents:[a],details:[pair],funds:[{uid:'other',balance:15983}]})};
};
