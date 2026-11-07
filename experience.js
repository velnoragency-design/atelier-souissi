'use strict';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const delay = ms => new Promise(resolve => setTimeout(resolve, motion.matches ? 0 : ms));
const header = $('#header');
const menu = $('#menu');
const menuToggle = $('.menu-toggle');
const overviewToggle = $('.overview-toggle');
const opening = $('#opening');
const curtain = $('.route-transition');
let menuOpen = false;
let openingActive = false;
let navigating = false;
let pageCleanup = () => {};
let homeControl = null;
let homeIndex = 0;
let routeURL = location.href;
let openingTimer;
let hideOpeningTimer;
let scrollFrame;
let lastFocusedMenu;
let pendingPopstate = null;
const htmlCache = new Map();

// These controls persist while the actual page changes; retain absolute destinations.
$$('a', header).concat($$('a', menu)).forEach(link => { link.href = link.href; });
$$('[data-menu-image]', menu).forEach(link => { link.dataset.menuImage = new URL(link.dataset.menuImage, location.href).href; });
$('#menu-photo').src = $('#menu-photo').src;
if (location.protocol === 'file:') $$('a[href]').forEach(link => {
  const target = new URL(link.href,location.href);
  if (target.protocol === 'file:' && target.pathname.endsWith('/')) {
    target.pathname += 'index.html';
    link.href = target.href;
  }
});
const homeURL = $('.brand').href;
const isWeb = /^https?:$/.test(location.protocol);

function lockUI() {
  const locked = menuOpen || openingActive || navigating || $('#legal-dialog').open;
  document.body.classList.toggle('locked', locked);
  $('#main').inert = menuOpen || openingActive || navigating;
  header.inert = openingActive || navigating;
  $$('a', header).forEach(link => { link.inert = menuOpen; });
  overviewToggle.inert = menuOpen;
}

function finishOpening() {
  if (!openingActive) return;
  clearTimeout(openingTimer);
  openingActive = false;
  lockUI();
  if (opening.contains(document.activeElement)) $('#main').focus({preventScroll:true});
  opening.setAttribute('aria-hidden', 'true');
  $('.opening-skip').tabIndex = -1;
  opening.classList.add('depart');
  document.body.classList.add('experience-ready');
  try { sessionStorage.setItem('atelier-luxury-opening', 'seen'); } catch (_) {}
  hideOpeningTimer = setTimeout(() => opening.classList.add('done'), motion.matches ? 0 : 1500);
}

function startOpening(replay = false) {
  let seen = false;
  try { seen = sessionStorage.getItem('atelier-luxury-opening') === 'seen'; } catch (_) {}
  if (motion.matches || (seen && !replay)) {
    opening.classList.add('done');
    document.body.classList.add('experience-ready');
    return;
  }
  clearTimeout(hideOpeningTimer);
  opening.classList.remove('depart','done');
  opening.removeAttribute('aria-hidden');
  document.body.classList.remove('experience-ready');
  openingActive = true;
  lockUI();
  $('.opening-skip').tabIndex = 0;
  $('.opening-skip').focus({preventScroll:true});
  openingTimer = setTimeout(finishOpening, 2600);
}
$('.opening-skip').addEventListener('click', finishOpening);

function setMenu(open, returnFocus = true) {
  menuOpen = open;
  menu.hidden = !open;
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
  header.classList.toggle('menu-is-open', open);
  if (open) lastFocusedMenu = document.activeElement;
  lockUI();
  if (open) $('nav a', menu).focus({preventScroll:true});
  else if (returnFocus) (lastFocusedMenu || menuToggle).focus({preventScroll:true});
}
menuToggle.addEventListener('click', () => setMenu(!menuOpen));
let menuPhotoTimer;
$$('[data-menu-image]', menu).forEach(link => {
  const preview = () => {
    clearTimeout(menuPhotoTimer);
    const photo = $('#menu-photo');
    if (photo.src === link.dataset.menuImage) return;
    photo.style.opacity = '.25';
    menuPhotoTimer = setTimeout(() => { photo.src = link.dataset.menuImage; photo.style.opacity = '1'; }, motion.matches ? 0 : 170);
  };
  link.addEventListener('pointerenter', preview);
  link.addEventListener('focus', preview);
});

overviewToggle.addEventListener('click', () => {
  if (homeControl) homeControl.overview(!document.body.classList.contains('is-overview'));
  else navigate(new URL('?view=ensemble',homeURL));
});

document.addEventListener('click', event => {
  const legalButton = event.target.closest('.legal-open');
  if (legalButton) { $('#legal-dialog').showModal(); lockUI(); }
});
$('.dialog-close').addEventListener('click', () => $('#legal-dialog').close());
$('#legal-dialog').addEventListener('close', lockUI);
$('#legal-dialog').addEventListener('click', event => {
  const dialog = event.currentTarget, box = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close();
});
$('#replay-opening').addEventListener('click', async () => {
  setMenu(false, false);
  if (!homeControl) await navigate(new URL(homeURL));
  homeControl?.go(0,true);
  homeControl?.overview(false);
  window.scrollTo({top:0,behavior:'instant'});
  startOpening(true);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (openingActive) finishOpening();
    else if (menuOpen) setMenu(false);
    else if (document.body.classList.contains('is-overview')) homeControl?.overview(false);
  }
  if (event.key !== 'Tab') return;
  if (openingActive) { event.preventDefault(); $('.opening-skip').focus(); }
  if (menuOpen && !$('#legal-dialog').open) {
    const controls = [menuToggle, ...$$('a,button',menu)];
    const first = controls[0], last = controls[controls.length-1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

function routeLabel(url) {
  const path = url.pathname;
  if (path.includes('villa-nour')) return 'Villa Nour';
  if (path.includes('residence-ambre')) return 'Résidence Ambre';
  if (path.includes('maison-sable')) return 'Maison Sable';
  if (path.includes('univers')) return 'Les univers';
  if (path.includes('atelier')) return 'L’atelier';
  if (path.includes('expertises')) return 'L’expertise';
  if (path.includes('contact')) return 'Votre projet';
  return 'Atelier Souissi';
}

async function loadPage(url) {
  const key = url.origin + url.pathname;
  if (htmlCache.has(key)) return htmlCache.get(key);
  const response = await fetch(key, {headers:{'X-Atelier-Navigation':'1'}});
  if (!response.ok) throw new Error(`Page indisponible (${response.status})`);
  const text = await response.text();
  const page = new DOMParser().parseFromString(text, 'text/html');
  if (!$('#main',page) || !page.body.dataset.page) throw new Error('Page inattendue');
  htmlCache.set(key,page);
  return page;
}

async function navigate(target, options = {}) {
  if (navigating) return;
  const url = target instanceof URL ? target : new URL(target,location.href);
  if (!isWeb) { location.href = url.href; return; }
  navigating = true;
  setMenu(false,false);
  $('.image-cursor').classList.remove('is-visible');
  lockUI();
  $('.route-transition-name').textContent = routeLabel(url);
  curtain.classList.remove('is-revealing');
  curtain.classList.add('is-active');
  const request = loadPage(url);
  request.catch(() => {});
  requestAnimationFrame(() => curtain.classList.add('is-covered'));
  try {
    const [page] = await Promise.all([request,delay(720)]);
    if (pendingPopstate) {
      const pending = pendingPopstate;
      pendingPopstate = null;
      navigating = false;
      return navigate(new URL(pending.url), {push:false,scroll:pending.scroll});
    }
    pageCleanup();
    homeControl = null;
    if (options.push !== false) {
      history.replaceState({...history.state,scroll:scrollY},'',location.href);
      history.pushState({scroll:0},'',url.href);
    }
    routeURL = url.href;
    document.title = page.title;
    document.body.dataset.page = page.body.dataset.page;
    document.body.dataset.title = page.body.dataset.title;
    document.body.className = page.body.className;
    document.body.classList.add('experience-ready');
    const description = $('meta[name=description]',page)?.content;
    if (description) $('meta[name=description]').content = description;
    $('#main').replaceWith(document.importNode($('#main',page),true));
    window.scrollTo({top:options.scroll || 0,behavior:'instant'});
    initPage();
    lockUI();
    updateReading();
    await delay(140);
    curtain.classList.add('is-revealing');
    curtain.classList.remove('is-covered');
    await delay(750);
    curtain.classList.remove('is-active','is-revealing');
    navigating = false;
    lockUI();
    if (pendingPopstate) {
      const pending = pendingPopstate;
      pendingPopstate = null;
      return navigate(new URL(pending.url), {push:false,scroll:pending.scroll});
    }
    $('#main').focus({preventScroll:true});
    if (url.hash) $(decodeURIComponent(url.hash))?.scrollIntoView({behavior:motion.matches?'instant':'smooth'});
  } catch (_) {
    // Every destination also exists as a real HTML page.
    location.assign(pendingPopstate?.url || url.href);
  }
}

document.addEventListener('click', event => {
  const link = event.target.closest('a[href]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
  const url = new URL(link.href,location.href);
  if (!isWeb || url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return;
  if (url.pathname === location.pathname && url.search === location.search) {
    if (menuOpen) setMenu(false,false);
    if (!url.hash && homeControl) { event.preventDefault(); homeControl.overview(false); homeControl.go(0,true); }
    return;
  }
  event.preventDefault();
  navigate(url);
});
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.addEventListener('popstate', event => {
  if (navigating) {
    pendingPopstate = {url:location.href,scroll:event.state?.scroll || 0};
    return;
  }
  const current = new URL(location.href), previous = new URL(routeURL);
  if (current.pathname !== previous.pathname || current.search !== previous.search) navigate(current,{push:false,scroll:event.state?.scroll || 0});
  else routeURL = location.href;
});

function updateReading() {
  const isHome = document.body.dataset.page === 'home';
  header.classList.toggle('is-scrolled', !isHome && scrollY > 75);
  const distance = document.documentElement.scrollHeight-innerHeight;
  header.style.setProperty('--reading',isHome || distance <= 0 ? 0 : Math.min(1,scrollY/distance));
  if (!motion.matches) $$('[data-expand]').forEach(figure => {
    const bounds = figure.getBoundingClientRect();
    const progress = Math.max(0,Math.min(1,(innerHeight-bounds.top)/(innerHeight+bounds.height)));
    figure.style.setProperty('--inset',`${Math.max(0,6-progress*15)}%`);
  });
}
window.addEventListener('scroll', () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => { updateReading(); scrollFrame = 0; });
},{passive:true});

function initHome(signal) {
  const home = $('.home-experience');
  if (!home) return;
  const stage = $('.home-stage'), scenes = $$('.scene');
  let index = homeIndex;
  let lastSwitch = -2000, wheelDelta = 0, wheelTimer;
  let pointerStart = null, dragged = false;
  const go = (next, immediate = false) => {
    if (!immediate && performance.now()-lastSwitch < (motion.matches ? 50 : 1150)) return;
    lastSwitch = performance.now();
    index = (next+scenes.length)%scenes.length;
    homeIndex = index;
    stage.style.setProperty('--scene',index);
    const overview = document.body.classList.contains('is-overview');
    scenes.forEach((scene,i) => {
      if (scene.contains(document.activeElement) && !overview && i !== index) $('#main').focus({preventScroll:true});
      scene.classList.toggle('is-active',i===index);
      scene.setAttribute('aria-hidden',String(!overview && i!==index));
      scene.inert = !overview && i!==index;
      $('.scene-copy',scene).inert = overview;
      $('.scene-select',scene).tabIndex = overview ? 0 : -1;
      $('.overview-caption',scene).setAttribute('aria-hidden',String(!overview));
    });
    $('.current-scene').textContent = String(index+1).padStart(2,'0');
    $('.pagination-line i').style.width = `${(index+1)/scenes.length*100}%`;
  };
  const overview = open => {
    document.body.classList.toggle('is-overview',open);
    $('.overview-intro').setAttribute('aria-hidden',String(!open));
    $('.home-top-label').setAttribute('aria-hidden',String(open));
    overviewToggle.setAttribute('aria-pressed',String(open));
    overviewToggle.setAttribute('aria-label',open ? 'Revenir à la vue plein écran' : 'Voir les univers en vue d’ensemble');
    $('.instruction-text').textContent = open ? 'CHOISIR UNE PERSPECTIVE' : 'DÉFILER POUR EXPLORER';
    go(index,true);
  };
  homeControl = {go,overview};
  $$('[data-slide]').forEach(button => button.addEventListener('click',()=>go(index+Number(button.dataset.slide)),{signal}));
  $$('[data-select-scene]').forEach(button => button.addEventListener('click',() => {
    if (dragged) return;
    go(Number(button.dataset.selectScene),true);
    overview(false);
    overviewToggle.focus({preventScroll:true});
  },{signal}));
  $$('[data-select-scene]').forEach(button => button.addEventListener('focus',() => {
    if (!document.body.classList.contains('is-overview')) return;
    go(Number(button.dataset.selectScene),true);
    requestAnimationFrame(()=>{home.scrollLeft=0;});
  },{signal}));
  home.addEventListener('wheel',event => {
    if (menuOpen || openingActive || navigating || $('#legal-dialog').open) return;
    if (event.ctrlKey) return;
    event.preventDefault();
    if (performance.now()-lastSwitch < 1150 && !motion.matches) return;
    wheelDelta += Math.abs(event.deltaY)>Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    clearTimeout(wheelTimer);
    wheelTimer=setTimeout(()=>{wheelDelta=0;},180);
    if (Math.abs(wheelDelta)>35) {go(index+(wheelDelta>0 ? 1 : -1));wheelDelta=0;}
  },{passive:false,signal});
  home.addEventListener('pointerdown',event => {
    if (event.target.closest('a,[data-slide]') || menuOpen || openingActive) return;
    pointerStart={x:event.clientX,y:event.clientY};dragged=false;
  },{signal});
  home.addEventListener('pointerup',event => {
    if (!pointerStart) return;
    const x=event.clientX-pointerStart.x,y=event.clientY-pointerStart.y;
    if (Math.max(Math.abs(x),Math.abs(y))>45) {
      dragged=true;go(index+((Math.abs(x)>Math.abs(y)?x:y)<0?1:-1));
      setTimeout(()=>{dragged=false;},100);
    }
    pointerStart=null;
  },{signal});
  home.addEventListener('pointercancel',()=>{pointerStart=null;},{signal});
  document.addEventListener('keydown',event => {
    if (menuOpen || openingActive || navigating || $('#legal-dialog').open || event.target.matches('input,textarea,select')) return;
    if (['ArrowRight','ArrowDown','PageDown'].includes(event.key)) {event.preventDefault();go(index+1);}
    else if (['ArrowLeft','ArrowUp','PageUp'].includes(event.key)) {event.preventDefault();go(index-1);}
  },{signal});
  go(index,true);
  if (new URLSearchParams(location.search).get('view')==='ensemble') overview(true);
}

function initBrief(signal) {
  const form = $('#project-form');
  if (!form) return;
  form.noValidate=true;
  let step=1, downloadURL;
  const labels=['VOTRE LIEU','VOS ENVIES','VOTRE BRIEF'];
  const setStep = next => {
    step=next;
    $$('[data-step]',form).forEach(fieldset=>{fieldset.hidden=Number(fieldset.dataset.step)!==step;});
    $('#brief-step-name').textContent=`0${step} — ${labels[step-1]}`;
    $('#brief-count').textContent=`${step} / 3`;
    $('.brief-progress b').style.width=`${step/3*100}%`;
    if (step===3) {
      const lines=[...new FormData(form)].filter(([,value])=>String(value).trim()).map(([key,value])=>{
        const row=document.createElement('div');row.className='summary-line';
        const label=document.createElement('span'),text=document.createElement('strong');
        label.textContent=key;text.textContent=String(value)+(key==='Surface'?' m²':'');row.append(label,text);return row;
      });
      $('#brief-summary').replaceChildren(...lines);
    }
    const first=$(`[data-step="${step}"] input,[data-step="${step}"] select,[data-step="${step}"] button`,form);
    first?.focus({preventScroll:true});
  };
  const advance = () => {
    for (const field of $$('input,select,textarea',$(`[data-step="${step}"]`,form))) if (!field.reportValidity()) return;
    setStep(Math.min(3,step+1));
  };
  $$('.brief-next',form).forEach(button=>button.addEventListener('click',advance,{signal}));
  $$('.brief-back',form).forEach(button=>button.addEventListener('click',()=>setStep(Math.max(1,step-1)),{signal}));
  form.addEventListener('submit',event=>{
    event.preventDefault();
    if (step<3) {advance();return;}
    const values=[...new FormData(form)].map(([key,value])=>`${key} : ${String(value).trim()||'À préciser'}${key==='Surface'&&value?' m²':''}`);
    const content=`ATELIER SOUISSI\nVOTRE PROJET DE RÉNOVATION\nRabat · Souissi\n\n${values.join('\n\n')}\n\nÀ PRÉCISER LORS DU PREMIER ÉCHANGE\n- Priorités et usages\n- Contraintes du lieu et autorisations éventuelles\n- Périmètre des travaux et choix de matières\n- Budget, calendrier et modalités de suivi\n\nCe document prépare un échange. Il ne constitue ni un devis ni une demande envoyée. Atelier Souissi est un nom provisoire pour ce concept de présentation.\n`;
    if (downloadURL) URL.revokeObjectURL(downloadURL);
    downloadURL=URL.createObjectURL(new Blob(['\ufeff'+content],{type:'text/plain;charset=utf-8'}));
    const link=document.createElement('a');link.href=downloadURL;link.download='Atelier-Souissi-mon-projet.txt';link.textContent='Télécharger votre brief';
    $('#brief-status').replaceChildren(document.createTextNode('Votre nouvelle histoire a ses premières lignes. '),link);link.click();
  },{signal});
  signal.addEventListener('abort',()=>{if(downloadURL)URL.revokeObjectURL(downloadURL);});
}

function initPage() {
  const controller=new AbortController(),signal=controller.signal;
  const observer='IntersectionObserver' in window ? new IntersectionObserver(entries=>entries.forEach(entry=>{
    if(entry.isIntersecting){entry.target.classList.add('revealed');observer.unobserve(entry.target);}
  }),{threshold:.08,rootMargin:'0px 0px -20px 0px'}) : null;
  $$('[data-reveal]').forEach(element=>observer?observer.observe(element):element.classList.add('revealed'));
  const page=document.body.dataset.page;
  $$('[data-nav]').forEach(link=>{
    if(link.dataset.nav===(page==='case'?'univers':page))link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  overviewToggle.setAttribute('aria-pressed','false');
  overviewToggle.setAttribute('aria-label','Voir les univers en vue d’ensemble');
  initHome(signal);
  initBrief(signal);
  $$('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
    const category=button.dataset.filter;
    $$('[data-filter]').forEach(control=>{control.classList.toggle('is-active',control===button);control.setAttribute('aria-pressed',String(control===button));});
    $('.collection-grid').classList.toggle('is-filtered',category!=='all');
    $$('[data-category]').forEach(card=>{card.hidden=category!=='all'&&card.dataset.category!==category;});
  },{signal}));
  $$('.service').forEach(service=>service.addEventListener('toggle',()=>{
    if(!service.open)return;
    $$('.service').forEach(other=>{if(other!==service)other.open=false;});
    const image=$('#service-image');image.src=service.dataset.serviceImage;image.alt=$('h3',service).textContent+' — étude d’ambiance';
  },{signal}));
  updateReading();
  pageCleanup=()=>{controller.abort();observer?.disconnect();homeControl=null;};
}

const cursor=$('.image-cursor');
if(matchMedia('(hover:hover) and (pointer:fine)').matches&&!motion.matches){
  document.addEventListener('pointermove',event=>{cursor.style.transform=`translate3d(${event.clientX-46}px,${event.clientY-46}px,0)`;},{passive:true});
  document.addEventListener('pointerover',event=>{if(event.target.closest('[data-cursor]')&&!menuOpen&&!navigating)cursor.classList.add('is-visible');});
  document.addEventListener('pointerout',event=>{if(event.target.closest('[data-cursor]')&&!event.relatedTarget?.closest?.('[data-cursor]'))cursor.classList.remove('is-visible');});
}
motion.addEventListener('change',()=>{if(motion.matches){finishOpening();cursor.classList.remove('is-visible');}});
initPage();
startOpening();
