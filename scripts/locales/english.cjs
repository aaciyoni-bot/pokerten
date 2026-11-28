'use strict';

// Keep cached older clients in English too, without touching login or seat state.
function clearLanguagePreference(){
  try { localStorage.setItem('pkUiLanguage','en'); } catch (_) {}
}

function englishEntry(html,version){
  html=html.replace(/(<meta name="app-version" content=")\d+(")/,(_,open,close)=>open+version+close)
    .replace(/(assets\/css\/reference-experience\.css\?v=)\d+/,(_,before)=>before+version)
    .replace(/(assets\/js\/(?:app|native)-update\.js\?v=)\d+/,(_,before)=>before+version);
  const bootstrap='<script>('+clearLanguagePreference.toString()+')();</script>';
  const charset='<meta charset="UTF-8">';
  if(!html.includes(charset))throw Error('HTML charset not found');
  return html.includes(bootstrap)?html:html.replace(charset,charset+'\n'+bootstrap);
}
module.exports={englishEntry};
