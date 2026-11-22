'use strict';

function applyLanguagePreference(){
  const page=new URL(location.href);
  try{
    if(document.documentElement.lang==='he'){
      localStorage.setItem('pkUiLanguage','he');
    }else if(page.searchParams.get('uiLang')==='en'){
      localStorage.setItem('pkUiLanguage','en');
    }else if(localStorage.getItem('pkUiLanguage')==='he'){
      const hebrew=new URL('he.html',page);
      hebrew.search=page.search;
      hebrew.hash=page.hash;
      location.replace(hebrew.href);
    }
  }catch(_){ /* Either explicit entry still works when storage is unavailable. */ }
}

function LanguageChoice(){
  const hebrew=document.documentElement.lang==='he';
  const page=new URL(hebrew?'index.html':'he.html',window.location.href);
  page.search=window.location.search;
  page.searchParams.set('uiLang',hebrew?'en':'he');
  page.hash=window.location.hash;
  return React.createElement('a',{'data-language-choice':true,href:page.href,lang:'en',dir:'ltr'},hebrew?'English':'Hebrew');
}

// Derive both web and native release headers from the published manifest.
function englishEntry(html,version){
  html=html.replace(/(<meta name="app-version" content=")\d+(")/,(_,open,close)=>open+version+close)
    .replace(/(assets\/js\/(?:app|native)-update\.js\?v=)\d+/,(_,before)=>before+version);
  if(html.includes('data-language-choice'))return html;
  const component='function AppReleaseControls()';
  const first=html.indexOf(component);
  const control='React.createElement(PokerMusicButton),';
  const at=html.indexOf(control,first);
  if(first<0||at<0||at>html.indexOf('function App()',first))throw Error('Release controls not found');
  html=html.slice(0,at)+'React.createElement(LanguageChoice),\n    '+html.slice(at);
  html=html.replace(component,LanguageChoice.toString()+'\n'+component);
  const charset='<meta charset="UTF-8">';
  if(!html.includes(charset))throw Error('HTML charset not found');
  return html.replace(charset,charset+'\n<script>('+applyLanguagePreference.toString()+')();</script>');
}
module.exports={englishEntry,applyLanguagePreference,LanguageChoice};
