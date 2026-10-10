/* Keep bottom sheets within the visual viewport when the phone keyboard opens. */
(function(){
 const viewport=window.visualViewport;
 function update(){const height=viewport?viewport.height:window.innerHeight,top=viewport?viewport.offsetTop:0;document.documentElement.style.setProperty('--visible-height',height+'px');document.documentElement.style.setProperty('--visible-top',top+'px');const editing=/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||'');document.body.classList.toggle('keyboard-open',editing&&window.innerHeight-height>120);}
 viewport?.addEventListener('resize',update);viewport?.addEventListener('scroll',update);window.addEventListener('resize',update);document.addEventListener('focusin',update);document.addEventListener('focusout',()=>requestAnimationFrame(update));update();
})();
