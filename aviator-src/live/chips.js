// Owner credit is accessible without opening GOD MODE or revealing a round.
const chipsDialog=$('#chipsDialog');
function showChips(){
  if (!joined || !user) return;
  $('#pilotId').textContent=user.uid;
  $('#creditCode').required=!isAdminUser && !store.get('avSupCode','');
  $('#creditStatus').textContent='יתרה זמינה: '+fmt(balance)+' צ׳יפים';
  chipsDialog.showModal();
}
$('#chipsBtn').addEventListener('click',showChips);
$('#chipsClose').addEventListener('click',()=>chipsDialog.close());
let creditPending=false, creditRequest=null;
$('#chipsForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if (creditPending || !user) return;
  const amount=Number($('#creditAmount').value);
  if (!Number.isSafeInteger(amount) || amount<25 || amount>1e9) return;
  const code=$('#creditCode').value.trim() || store.get('avSupCode','');
  if (!creditRequest || creditRequest.amount!==amount || creditRequest.uid!==user.uid)
    creditRequest={uid:user.uid,amount,requestId:newRequestId()};
  creditPending=true; $('#creditSubmit').disabled=true;
  $('#creditStatus').textContent='ממתין לאישור הטעינה…';
  try {
    const result=await sendAction('avCredit',{...creditRequest,code});
    setBalance(result.balance); updateAction();
    $('#creditStatus').textContent='הטעינה אושרה. יתרה: '+fmt(result.balance)+' צ׳יפים';
    $('#creditCode').value=''; creditRequest=null;
  } catch(error) {
    $('#creditStatus').textContent=String(error.message || 'הטעינה לא אושרה. אפשר לנסות שוב.');
  } finally {creditPending=false;$('#creditSubmit').disabled=false;}
});
