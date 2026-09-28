const SHEET_ID = '1rCYDhM3QbOf5ZgHmo-46jk3vQk4oypppvtpHbTmAaL4';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
const STORAGE_KEY = 'igualdad-en-practica-progreso-v1';
const INCIDENT_STORAGE_KEY = 'igualdad-en-practica-incidencias-demo-v1';
const EVALUATION_STORAGE_KEY = 'igualdad-en-practica-evaluaciones-demo-v1';
const ATTENDANCE_STORAGE_KEY = 'igualdad-en-practica-asistencia-demo-v1';

const COURSE_STRUCTURE = [
  { code:'MF1453_3', title:'Comunicación con Perspectiva de Género', units:[
    { code:'UF2683', title:'Aplicación de conceptos básicos de la teoría de género y del lenguaje no sexista' },
    { code:'UF2684', title:'Procesos de comunicación con perspectiva de género en el entorno de intervención' }
  ]},
  { code:'MF1454_3', title:'Participación y creación de redes con perspectiva de género', units:[
    { code:'UF2685', title:'Procesos de participación de mujeres y hombres y creación de redes para el impulso de la igualdad' }
  ]},
  { code:'MF1582_3', title:'Promoción para la igualdad efectiva entre mujeres y hombres en materia de empleo', units:[
    { code:'UF2686', title:'Análisis del entorno laboral y gestión de relaciones laborales desde la perspectiva de género' }
  ]},
  { code:'MF1583_3', title:'Acciones para la igualdad efectiva de mujeres y hombres', units:[
    { code:'UF2687', title:'Análisis y actuaciones en diferentes contextos de intervención (salud, sexualidad y educación)' }
  ]},
  { code:'MF1584_3', title:'Detección, prevención y acompañamiento en situaciones de violencia contra las mujeres', units:[
    { code:'UF2688', title:'Análisis y detección de la violencia de género y los procesos de atención a mujeres en situaciones de violencia' }
  ]}
];

const state = { data: null, role: 'student', page: 'home', month: null, currentSessionId: null };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const truthy = value => value === true || ['sí','si','true','1'].includes(String(value).toLowerCase());

window.addEventListener('DOMContentLoaded', () => { bindStatic(); loadCourse(); });

function bindStatic() {
  $('#retry').onclick = loadCourse;
  $$('[data-role]').forEach(button => button.onclick = enter);
  $('#logout').onclick = () => { state.page = 'home'; $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); };
  $('#closeSession').onclick = () => $('#sessionDialog').close();
  $('#closeIncident').onclick = () => $('#incidentDialog').close();
  $('#incidentForm').onsubmit = saveIncident;
  $('#closeEvaluation').onclick = () => $('#evaluationDialog').close();
  $('#evaluationForm').onsubmit = saveEvaluation;
  $('#resourceModule').onchange = renderResources;
  $('#resourceType').onchange = renderResources;
  $('#heroAction').onclick = () => state.currentSessionId ? openSession(state.currentSessionId) : go('program');
  $('#prevMonth').onclick = () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); renderCalendar(); };
  $('#nextMonth').onclick = () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); renderCalendar(); };
}

async function loadCourse() {
  $('#loading').classList.remove('hidden');
  $('#login').classList.add('hidden');
  $('#errorActions').classList.add('hidden');
  $('#loadingMessage').textContent = 'Conectando con el programa del curso…';
  try {
    const [configuration, calendar, materials] = await Promise.all([
      loadSheet('CONFIGURACION'), loadSheet('CALENDARIO_WEB'), loadSheet('MATERIALES_WEB')
    ]);
    const cfg = Object.fromEntries(configuration.map(row => [row.CLAVE, row.VALOR]));
    const activities = normalizeActivities(calendar.filter(row => row.ID && truthy(row.PUBLICAR)));
    const sessions = groupActivitiesIntoSessions(activities);
    const resources = materials.filter(row => row.ID_MATERIAL && truthy(row.VISIBLE)).map(normalizeResource);
    attachMaterialsToSessions(sessions,resources);
    if (!sessions.length) throw new Error('El calendario no contiene sesiones publicables.');
    state.data = { cfg, sessions, resources, modules: buildModules(sessions) };
    const firstDate = [...sessions].sort((a, b) => a.date - b.date)[0].date;
    state.month = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
    renderBase();
    $('#loading').classList.add('hidden');
    $('#login').classList.remove('hidden');
  } catch (error) {
    console.error(error);
    $('#loadingMessage').textContent = `No he podido conectar con el programa. ${error.message || error}`;
    $('#errorActions').classList.remove('hidden');
  }
}

async function loadSheet(sheetName) {
  const response = await fetch(`https://opensheet.elk.sh/${SHEET_ID}/${encodeURIComponent(sheetName)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`No se pudo leer ${sheetName} (${response.status}).`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error(`La pestaña ${sheetName} no tiene un formato válido.`);
  return rows;
}

function normalizeActivities(rows) {
  let previousDate=null,previousDay='',previousModule='';
  return rows.map(row=>{
    const courseDay=String(row.DIA_CURSO||previousDay).trim(),rawModule=String(row.MODULO||'').trim();
    if(rawModule)previousModule=rawModule;
    let date=asDate(row.FECHA); if(!date&&courseDay&&courseDay===previousDay)date=previousDate;
    if(date)previousDate=date; if(courseDay)previousDay=courseDay;
    return { id:String(row.ID), module:rawModule||previousModule||'Próximos módulos', moduleAvailable:truthy(row.MODULO_DISPONIBLE), courseDay, weekday:String(row.DIA_SEMANA||'').trim(), date, title:String(row.ACTIVIDAD_PRINCIPAL||row.ACTIVIDADES_ESPECIFICAS||'Actividad del curso').trim(), details:String(row.ACTIVIDADES_ESPECIFICAS||'').trim(), webResource:String(row.RECURSOS_WEB||'').trim(), presentation:String(row.RECURSOS_PRESENTACIONES||'').trim(), link:String(row.ENLACE||'').trim() };
  }).filter(item=>item.date);
}

function groupActivitiesIntoSessions(activities) {
  const groups=new Map();
  activities.forEach(activity=>{
    const dateKey=`${activity.date.getFullYear()}-${activity.date.getMonth()+1}-${activity.date.getDate()}`,key=`${activity.module}|${activity.courseDay||dateKey}|${dateKey}`;
    if(!groups.has(key))groups.set(key,{id:`session-${activity.id}`,module:activity.module,moduleAvailable:activity.moduleAvailable,courseDay:activity.courseDay,weekday:activity.weekday,date:activity.date,activities:[]});
    groups.get(key).activities.push(activity);
  });
  return [...groups.values()].map(session=>{
    const titles=unique(session.activities.map(item=>item.title).filter(Boolean));
    return {...session,title:sessionTitle(titles),details:unique(session.activities.map(item=>item.details).filter(Boolean)).join(' · '),links:session.activities.flatMap(item=>[['Contenido',item.link],['Recurso web',item.webResource],['Presentación',item.presentation]].filter(([,url])=>/^https?:\/\//i.test(url)).map(([label,url])=>({label,url,activity:item.title})))};
  }).sort((a,b)=>a.date-b.date);
}

function sessionTitle(titles){if(!titles.length)return'Sesión del curso';if(titles.length===1)return titles[0];return `${titles[0]} y ${titles.length-1} actividades más`;}
function unique(values){return [...new Set(values)]}

function normalizeResource(row) {
  return { id:String(row.ID_MATERIAL), date:asDate(row.FECHA), module:String(row.MODULO||'').trim(), title:String(row.TITULO||'Material del curso').trim(), type:String(row.TIPO||'Material del curso').trim(), link:String(row.ENLACE||'').trim(), sourceRow:String(row.FILA_ORIGEN||'').trim(), access:String(row.ACCESO||'AMBOS').trim().toUpperCase() };
}

function attachMaterialsToSessions(sessions,resources){resources.filter(resource=>/^https?:\/\//i.test(resource.link)).forEach(resource=>{const session=sessions.find(item=>sameDay(item.date,resource.date)&&keyText(item.module)===keyText(resource.module));if(session&&!session.links.some(item=>item.url===resource.link))session.links.push({label:resource.type,url:resource.link,activity:resource.title,access:resource.access})})}
function keyText(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase()}

function moduleReference(value) {
  const text=String(value||'');
  return { moduleCode:(text.match(/MF\d+_3/i)||[])[0]?.toUpperCase()||'', unitCode:(text.match(/UF\d+/i)||[])[0]?.toUpperCase()||'' };
}

function buildModules(sessions) {
  return COURSE_STRUCTURE.map((definition,index)=>{
    const items=sessions.filter(session=>moduleReference(session.module).moduleCode===definition.code).sort((a,b)=>a.date-b.date);
    const units=definition.units.map(unit=>{
      const unitSessions=items.filter(session=>moduleReference(session.module).unitCode===unit.code);
      return {...unit,sessions:unitSessions,available:unitSessions.some(session=>session.moduleAvailable)};
    });
    return { id:`module-${definition.code.toLowerCase()}`, code:definition.code, number:index+1, order:index+1, available:items.some(item=>item.moduleAvailable), name:definition.code, title:definition.title, units, sessions:items, start:items.reduce((min,item)=>!min||item.date<min?item.date:min,null), end:items.reduce((max,item)=>!max||item.date>max?item.date:max,null) };
  });
}

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(Math.round((value - 25569) * 86400 * 1000));
  const spanish=String(value).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if(spanish)return new Date(+spanish[3],+spanish[2]-1,+spanish[1]);
  const gviz=String(value).match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
  if(gviz)return new Date(+gviz[1],+gviz[2],+gviz[3],+(gviz[4]||0),+(gviz[5]||0),+(gviz[6]||0));
  const date=new Date(value); return Number.isNaN(date.getTime())?null:date;
}

function fmtDate(value, options={day:'2-digit',month:'short',year:'numeric'}) { const date=asDate(value); return date?new Intl.DateTimeFormat('es-ES',options).format(date):'—'; }

function renderBase() { const name='Promoción para la igualdad efectiva entre mujeres y hombres'; $('#brandName').textContent=name; $('#sideBrand').textContent=name; document.title=`${name} · Aula`; }
function enter(event) { state.role=event.currentTarget.dataset.role||'student'; $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); $('#app').dataset.role=state.role; renderNav(); renderAll(); go(state.role==='teacher'?'teacher-home':'home'); }

function renderNav() {
  const items=state.role==='teacher'?[['teacher-home','⌂','Inicio'],['program','▦','Programa'],['attendance','✓','Asistencia'],['evaluations','☆','Evaluaciones'],['resources','◇','Materiales']]:[['home','⌂','Inicio'],['program','▦','Programa'],['calendar','□','Calendario'],['resources','◇','Recursos'],['progress','◎','Panel personal']];
  $('#nav').innerHTML=items.map(([id,icon,label])=>`<button data-page="${id}" aria-label="${label}"><i aria-hidden="true">${icon}</i><span>${label}</span></button>`).join('');
  $$('#nav button').forEach(button=>button.onclick=()=>go(button.dataset.page));
  $('#userName').textContent=state.role==='teacher'?'Coral':'Alumno demo'; $('#userRole').textContent=state.role==='teacher'?'Profesora':'Alumno';
}

function go(page) { state.page=page; $$('.page').forEach(section=>section.classList.toggle('active',section.id===`page-${page}`)); $$('#nav button').forEach(button=>button.classList.toggle('active',button.dataset.page===page)); const button=$(`#nav [data-page="${page}"]`); $('#topTitle').textContent=button?button.textContent.trim():'Aula'; if(page==='program'){ $('#moduleGrid').classList.remove('hidden'); $('#moduleView').classList.add('hidden'); } window.scrollTo({top:0,behavior:'smooth'}); }
function renderAll() { renderHome(); renderModules(); renderResources(); renderPersonal(); renderCalendar(); renderTeacherHome(); renderToday(); renderStudents(); renderAttendance(); renderTeacherEvaluations(); }

function renderHome() {
  const {cfg,sessions,resources}=state.data, ordered=[...sessions].sort((a,b)=>a.date-b.date), today=startOfDay(new Date()), next=ordered.find(session=>session.date>=today)||ordered[ordered.length-1],currentModule=state.data.modules.find(module=>module.available&&module.sessions.some(session=>session.id===next?.id)),completed=currentModule?.sessions.filter(isSessionPassed).length||0,progress=currentModule?.sessions.length?completed/currentModule.sessions.length:0;
  $('#homeEyebrow').textContent='Tu aula'; $('#welcome').textContent='Buenos días.'; $('#homeIntro').textContent='Consulta el programa actualizado y continúa tu recorrido por el curso.'; $('#courseEdition').textContent=`Edición ${cfg.EDICION||'2026–2027'}`;
  state.currentSessionId=next?.id||null;
  $('#heroCard').dataset.number=next?.courseDay||'•'; $('#heroTitle').textContent=next?.title||'Programa del curso'; $('#heroText').textContent=next?`${sameDay(next.date,today)?'Sesión de hoy':'Próxima sesión'} · ${fmtDate(next.date)}${next.details?` · ${next.details}`:''}`:'Consulta las sesiones publicadas.'; $('#heroAction').textContent=next?'Ir a la sesión':'Ver programa';
  $('#progressValue').textContent=`${Math.round(progress*100)}%`; $('#progressText').textContent=currentModule?`${currentModule.title} · ${completed} de ${currentModule.sessions.length} sesiones realizadas`:'Todavía no hay un módulo disponible'; $('#progressBar').style.width=`${Math.round(progress*100)}%`;
  $('#nextDate').textContent=next?fmtDate(next.date,{day:'2-digit',month:'short'}):'—'; $('#nextEvent').textContent=next?.title||'Sin sesiones próximas';
  $('#resourceCount').textContent=`${resources.length} recursos`;
}

function renderModules() {
  const modules=state.data.modules; $('#moduleCount').textContent=`${modules.length} módulos`;
  $('#moduleGrid').innerHTML=modules.map(module=>{const locked=state.role!=='teacher'&&!module.available;return `<article class="card module ${locked?'locked':''}"><span class="module-no module-code">${esc(module.code)}</span><span class="tag">${state.role==='teacher'?(module.available?'Visible':'Borrador'):(locked?'Próximamente':'Disponible')}</span><h3>${esc(module.title)}</h3><p>${locked?'Este módulo todavía no está disponible.':'Consulta sus unidades formativas, contenidos y materiales.'}</p><div class="module-meta"><span>${module.units.length} ${module.units.length===1?'unidad formativa':'unidades formativas'}</span></div><button class="ghost" ${locked?'disabled':`data-module="${esc(module.id)}"`}>${locked?'No disponible':state.role==='teacher'?'Gestionar módulo':'Entrar al módulo'}</button></article>`}).join('');
  $$('[data-module]').forEach(button=>button.onclick=()=>openModule(button.dataset.module));
}

function unitActivities(unit) {
  const activities=new Map();
  unit.sessions.forEach(session=>session.activities.forEach(activity=>{
    const key=keyText(activity.title);
    if(key&&!activities.has(key))activities.set(key,{activity,session});
  }));
  return [...activities.values()];
}

function openModule(id, focusSessionId=null) {
  const module=state.data.modules.find(item=>item.id===id); if(!module||(state.role!=='teacher'&&!module.available))return;
  go('program'); $('#moduleGrid').classList.add('hidden');
  const view=$('#moduleView'); view.classList.remove('hidden');
  const evaluation=loadEvaluations().find(item=>item.moduleId===module.id);
  view.innerHTML=`<div class="module-view-head"><button class="ghost" id="backModules">← Módulos</button><div><p class="eyebrow">${esc(module.code)} · ${module.units.length} ${module.units.length===1?'unidad formativa':'unidades formativas'}</p><h2>${esc(module.title)}</h2></div></div><div class="session-grid">${module.units.map(unit=>programUnitCard(module,unit)).join('')}${state.role==='student'?`<article class="card session-card evaluation-card"><span class="chip">Evaluación del módulo</span><h3>Tu valoración</h3><p>Valora la utilidad, claridad y aplicación de lo aprendido en este módulo.</p><div class="session-actions"><button class="primary" data-module-evaluation="${esc(module.id)}">${evaluation?'Modificar evaluación':'Completar evaluación'}</button>${evaluation?'<span class="tag">Enviada ✓</span>':''}</div></article>`:''}</div>`;
  $('#backModules').onclick=()=>{view.classList.add('hidden');$('#moduleGrid').classList.remove('hidden');};
  view.querySelectorAll('[data-program-unit]').forEach(button=>button.onclick=()=>openUnit(button.dataset.programModule,button.dataset.programUnit));
  view.querySelectorAll('[data-module-evaluation]').forEach(button=>button.onclick=()=>openEvaluation(button.dataset.moduleEvaluation));
  if(focusSessionId){const unit=module.units.find(item=>item.sessions.some(session=>session.id===focusSessionId));if(unit)openUnit(module.id,unit.code);}
}

function programUnitCard(module,unit) {
  const activityCount=unitActivities(unit).length;
  return `<article class="card session-card"><span class="chip">${esc(unit.code)}</span><h3>${esc(unit.title)}</h3>${activityCount?`<p>${activityCount} ${activityCount===1?'contenido':'contenidos'}</p>`:''}<div class="session-actions">${activityCount||state.role==='teacher'?`<button class="primary" data-program-module="${esc(module.id)}" data-program-unit="${esc(unit.code)}">Ver unidad formativa</button>`:''}</div></article>`;
}

function openUnit(moduleId,unitCode) {
  const module=state.data.modules.find(item=>item.id===moduleId),unit=module?.units.find(item=>item.code===unitCode); if(!module||!unit)return;
  const activities=unitActivities(unit),view=$('#moduleView');
  view.innerHTML=`<div class="module-view-head"><button class="ghost" id="backModule">← ${esc(module.code)}</button><div><p class="eyebrow">${esc(unit.code)}</p><h2>${esc(unit.title)}</h2></div></div><div class="session-grid">${activities.map(({session,activity})=>programActivityCard(session,activity)).join('')}</div>`;
  $('#backModule').onclick=()=>openModule(module.id);
  view.querySelectorAll('[data-program-activity]').forEach(button=>button.onclick=()=>openProgramActivity(button.dataset.programSession,button.dataset.programActivity));
}

function programActivityCard(session,activity) {
  return `<article class="card session-card activity-card"><h3>${esc(activity.title)}</h3>${activity.details?`<p>${esc(activity.details)}</p>`:''}<div class="session-actions"><button class="primary" data-program-session="${esc(session.id)}" data-program-activity="${esc(activity.id)}">Ver contenido</button></div></article>`;
}

function sessionLinks(session) { const allowed=(session.links||[]).filter(link=>state.role==='teacher'||link.access!=='SOLO_PROFESORA'); return unique(allowed.map(link=>link.url)).map(url=>allowed.find(link=>link.url===url)); }

function openSession(id) {
  const session=state.data.sessions.find(item=>item.id===id); if(!session)return;
  $('#sessionEyebrow').textContent=`${session.module||'Programa'} · ${fmtDate(session.date)}`; $('#sessionTitle').textContent=session.title; $('#sessionDescription').textContent=session.details||'Contenido de la sesión.';
  $('#sessionActivityList').innerHTML=session.activities.map(activity=>`<li><strong>${esc(activity.title)}</strong>${activity.details?`<br><small>${esc(activity.details)}</small>`:''}</li>`).join('');
  const links=sessionLinks(session); $('#sessionResources').innerHTML=links.map(link=>`<a class="primary" href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.label)}${link.activity?` · ${esc(link.activity)}`:''}</a>`).join('');
  if(!$('#sessionDialog').open)$('#sessionDialog').showModal();
}

function openProgramActivity(sessionId,activityId) {
  const session=state.data.sessions.find(item=>item.id===sessionId),activity=session?.activities.find(item=>item.id===activityId); if(!session||!activity)return;
  $('#sessionEyebrow').textContent=session.module||'Programa'; $('#sessionTitle').textContent=activity.title; $('#sessionDescription').textContent=activity.details||'Contenido de la unidad.';
  $('#sessionActivityList').innerHTML='';
  const exact=sessionLinks(session).filter(link=>keyText(link.activity)===keyText(activity.title)),links=exact.length?exact:sessionLinks(session);
  $('#sessionResources').innerHTML=links.map(link=>`<a class="primary" href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.label)}</a>`).join('');
  if(!$('#sessionDialog').open)$('#sessionDialog').showModal();
}

function renderResources() {
  const all=state.data.resources.sort((a,b)=>(a.date||0)-(b.date||0)),visible=state.role==='teacher'?all:all.filter(resource=>resource.access!=='SOLO_PROFESORA'&&/^https?:\/\//i.test(resource.link));
  const moduleSelect=$('#resourceModule'),typeSelect=$('#resourceType'),moduleValue=moduleSelect.value,typeValue=typeSelect.value;
  if(moduleSelect.options.length===1)unique(visible.map(item=>item.module).filter(Boolean)).forEach(value=>moduleSelect.add(new Option(value,value)));
  if(typeSelect.options.length===1)unique(visible.map(item=>item.type).filter(Boolean)).forEach(value=>typeSelect.add(new Option(value,value)));
  moduleSelect.value=moduleValue;typeSelect.value=typeValue;
  const resources=visible.filter(item=>(!moduleValue||item.module===moduleValue)&&(!typeValue||item.type===typeValue)); $('#resourceCount').textContent=`${visible.length} recursos`;
  $('#resourceGrid').innerHTML=resources.map(resource=>{const linked=/^https?:\/\//i.test(resource.link);return `<article class="card resource"><span class="resource-type">${esc(resource.type)}${resource.module?` · ${esc(resource.module)}`:''}</span><h3>${esc(resource.title)}</h3><p>${resource.date?fmtDate(resource.date):'Material del curso'} · ${linked?'Disponible en línea.':'Enlace pendiente.'}</p>${linked?`<a class="ghost" href="${esc(resource.link)}" target="_blank" rel="noopener">Abrir recurso</a>`:'<button class="ghost" disabled>Pendiente en Sheets</button>'}</article>`}).join('')||'<div class="card empty">No hay materiales con estos filtros.</div>';
}

function renderPersonal() {
  const today=startOfDay(new Date()),available=state.data.modules.filter(module=>module.available),current=available.find(module=>module.start<=today&&module.end>=today)||available.find(module=>module.end>=today)||available[available.length-1],sessions=current?.sessions||[],done=sessions.filter(isSessionPassed).length,percentage=sessions.length?Math.round(done/sessions.length*100):0,next=state.data.sessions.find(session=>session.date>=today),incidents=loadIncidents(),evaluations=loadEvaluations(),pending=available.filter(module=>module.end<today&&!evaluations.some(item=>item.moduleId===module.id));
  $('#personalProgress').textContent=current?current.title:'Módulo actual';
  const incidentLabels={absence:'Ausencia',late:'Retraso',early:'Salida anticipada',other:'Otra incidencia'};
  const moduleSummary=state.data.modules.map(module=>{const count=module.sessions.filter(isSessionPassed).length,percent=module.sessions.length?Math.round(count/module.sessions.length*100):0;return `<div class="status-item"><div><strong>${esc(module.title)}</strong><p>${module.available?`${count} de ${module.sessions.length} fechas transcurridas`:'Todavía no disponible'}</p></div><span class="tag">${module.available?`${percent}%`:'Bloqueado'}</span></div>`}).join('');
  $('#personalDashboard').innerHTML=`<article class="card dashboard-card"><p class="eyebrow">Progreso del módulo actual</p><h2>${esc(current?.title||'Sin módulo activo')}</h2><div class="gauge" style="--value:${percentage*1.8}deg"><span class="gauge-value">${percentage}%</span></div><div class="metric-row"><div class="metric"><strong>${done}</strong><span>realizadas</span></div><div class="metric"><strong>${Math.max(0,sessions.length-done)}</strong><span>pendientes</span></div><div class="metric"><strong>${sessions.length}</strong><span>sesiones</span></div></div></article><article class="card dashboard-card"><p class="eyebrow">Siguiente paso</p><h2>${next?esc(next.title):'Curso finalizado'}</h2><p>${next?`${fmtDate(next.date)} · ${esc(next.module)}`:'No hay más sesiones publicadas.'}</p>${next?`<button class="primary" data-dashboard-session="${esc(next.id)}">Continuar</button>`:''}<div class="section"><p class="eyebrow">Evaluaciones</p><div class="status-list">${pending.length?pending.map(module=>`<div class="status-item"><div><strong>${esc(module.title)}</strong><p>Pendiente de completar</p></div><button class="ghost" data-evaluate="${esc(module.id)}">Evaluar</button></div>`).join(''):'<div class="status-item"><div><strong>Al día</strong><p>No tienes evaluaciones pendientes.</p></div><span class="tag">✓</span></div>'}</div></div></article><article class="card dashboard-card full-span"><p class="eyebrow">Progreso por módulos</p><h2>Vista general</h2><div class="status-list">${moduleSummary}</div></article><article class="card dashboard-card full-span"><p class="eyebrow">Ausencias e incidencias</p><h2>Mis comunicaciones</h2><div class="status-list">${incidents.length?incidents.slice().reverse().map(item=>{const session=state.data.sessions.find(candidate=>candidate.id===item.sessionId);return `<div class="status-item"><div><strong>${incidentLabels[item.type]||'Incidencia'} · ${session?fmtDate(session.date):'Sesión'}</strong><p>${esc(item.note||session?.title||'Sin observaciones')}</p></div><span class="tag">Registrada</span></div>`}).join(''):'<div class="status-item"><div><strong>Sin comunicaciones</strong><p>No has registrado ausencias ni incidencias.</p></div></div>'}</div></article>`;
  $$('[data-dashboard-session]').forEach(button=>button.onclick=()=>openSessionFromProgram(button.dataset.dashboardSession));
  $$('[data-evaluate]').forEach(button=>button.onclick=()=>openEvaluation(button.dataset.evaluate));
}

function isSessionPassed(session){const status=loadAttendance()[session.id];if(status&&status!=='pending')return ['present','late','early'].includes(status);return session.date<startOfDay(new Date())}

function sessionRow(session) { return `<article class="card row"><strong>${fmtDate(session.date,{day:'2-digit',month:'short'})}</strong><div><strong>${esc(session.title)}</strong><br><small>${esc(session.weekday)}${session.module?` · ${esc(session.module)}`:''}</small></div><button class="ghost" data-home-session="${esc(session.id)}">Ver sesión</button></article>`; }
function renderCalendar() {
  const date=state.month||new Date(),year=date.getFullYear(),month=date.getMonth(); $('#monthTitle').textContent=new Intl.DateTimeFormat('es-ES',{month:'long',year:'numeric'}).format(date);
  $('#calendarLegend').innerHTML=state.data.modules.map((module,index)=>`<span class="calendar-key module-tone-${index%8}" title="${esc(module.title)}"><i></i>${esc(module.code)}</span>`).join('')+'<span class="calendar-key milestone-exam"><i></i>Examen</span><span class="calendar-key milestone-evaluation"><i></i>Evaluación</span>';
  let html=['L','M','X','J','V','S','D'].map(day=>`<div class="weekday">${day}</div>`).join(''); const first=(new Date(year,month,1).getDay()+6)%7,days=new Date(year,month+1,0).getDate();
  for(let index=0;index<first;index++)html+='<div></div>';
  const today=startOfDay(new Date());
  for(let day=1;day<=days;day++){
    const current=new Date(year,month,day),sessions=state.data.sessions.filter(session=>sameDay(session.date,current)),module=state.data.modules.find(item=>sessions.some(session=>item.sessions.some(candidate=>candidate.id===session.id))),moduleIndex=Math.max(0,state.data.modules.indexOf(module)),locked=sessions.length&&sessions.every(session=>!session.moduleAvailable),future=current>today,milestones=calendarMilestones(sessions);
    const moduleLabel=sessions.length?(locked||future?`<span class="calendar-module">${esc(module?.code||sessions[0].module)}</span>`:`<button class="calendar-session" data-calendar-module="${esc(module?.id||'')}">${esc(module?.code||sessions[0].module)}</button>`):'';
    html+=`<div class="day ${[0,6].includes(current.getDay())?'weekend':''} ${sessions.length?`has-event module-tone-${moduleIndex%8}`:''} ${locked?'locked-module':''}"><strong class="day-number">${day}</strong>${moduleLabel}${milestones.map(type=>`<span class="calendar-milestone milestone-${type}">${type==='exam'?'Examen':'Evaluación'}</span>`).join('')}${sessions.length?`<div class="day-actions"><button class="add-incident" data-incident="${esc(sessions[0].id)}" aria-label="Comunicar ausencia o incidencia" title="Comunicar ausencia o incidencia">+</button></div>`:''}</div>`;
  }
  $('#calendarGrid').innerHTML=html;
  $$('[data-calendar-module]').forEach(button=>button.onclick=()=>openModule(button.dataset.calendarModule));
  $$('[data-incident]').forEach(button=>button.onclick=()=>openIncident(button.dataset.incident));
}

function calendarMilestones(sessions) {
  const titles=sessions.flatMap(session=>session.activities.map(activity=>activity.title.trim())),milestones=[];
  if(titles.some(title=>/^examen(?:\b|$)|^prueba\s+(?:final|de\s+evaluaci[oó]n)/i.test(title)))milestones.push('exam');
  if(titles.some(title=>/^evaluaci[oó]n\b|^valoraci[oó]n\s+(?:del\s+)?m[oó]dulo\b/i.test(title)))milestones.push('evaluation');
  return milestones;
}

function openSessionFromProgram(id) {
  const session=state.data.sessions.find(item=>item.id===id),module=state.data.modules.find(item=>item.sessions.some(candidate=>candidate.id===id));
  if(module&&(state.role==='teacher'||module.available)){openModule(module.id,id);openSession(id);}else{showToast('Este módulo todavía no está disponible.');}
}

function openIncident(id) {
  const session=state.data.sessions.find(item=>item.id===id); if(!session)return;
  $('#incidentSessionId').value=id; $('#incidentSession').textContent=`${fmtDate(session.date)} · ${session.title}`; $('#incidentType').value='absence'; $('#incidentNote').value=''; $('#incidentDialog').showModal();
}

function saveIncident(event) {
  event.preventDefault();
  const records=loadIncidents(),id=$('#incidentSessionId').value;
  records.push({id:`demo-${Date.now()}`,sessionId:id,type:$('#incidentType').value,note:$('#incidentNote').value.trim(),createdAt:new Date().toISOString()});
  localStorage.setItem(INCIDENT_STORAGE_KEY,JSON.stringify(records)); $('#incidentDialog').close(); renderPersonal(); showToast('Comunicación guardada en este dispositivo.');
}

function loadIncidents(){try{return JSON.parse(localStorage.getItem(INCIDENT_STORAGE_KEY)||'[]')}catch{return[]}}
const evaluationQuestions=['Los contenidos del módulo me han resultado útiles.','Las explicaciones han sido claras.','Las actividades me han ayudado a comprender los contenidos.','Puedo aplicar lo aprendido en situaciones reales.','Mi valoración global del módulo es positiva.'];
function openEvaluation(moduleId){const module=state.data.modules.find(item=>item.id===moduleId),existing=loadEvaluations().find(item=>item.moduleId===moduleId);if(!module)return;$('#evaluationModule').value=moduleId;$('#evaluationEyebrow').textContent=module.title;$('#evaluationQuestions').innerHTML=evaluationQuestions.map((question,index)=>`<div class="question"><strong>${esc(question)}</strong><div class="scale">${[1,2,3,4,5].map(value=>`<label>${value}<input type="radio" name="evaluation-${index}" value="${value}" ${existing?.answers[index]===value?'checked':''} required></label>`).join('')}</div></div>`).join('');$('#evaluationComment').value=existing?.comment||'';$('#evaluationDialog').showModal()}
function saveEvaluation(event){event.preventDefault();const moduleId=$('#evaluationModule').value,records=loadEvaluations().filter(item=>item.moduleId!==moduleId),answers=evaluationQuestions.map((_,index)=>Number(new FormData(event.currentTarget).get(`evaluation-${index}`)));records.push({id:`evaluation-${Date.now()}`,moduleId,answers,comment:$('#evaluationComment').value.trim(),createdAt:new Date().toISOString()});localStorage.setItem(EVALUATION_STORAGE_KEY,JSON.stringify(records));$('#evaluationDialog').close();renderPersonal();renderTeacherEvaluations();showToast('Evaluación guardada. Gracias por tu valoración.')}
function loadEvaluations(){try{return JSON.parse(localStorage.getItem(EVALUATION_STORAGE_KEY)||'[]')}catch{return[]}}
function showToast(message){const toast=$('#toast');toast.textContent=message;toast.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.classList.remove('show'),2600)}

function activeTeacherSession(){const today=startOfDay(new Date()),ordered=state.data.sessions;return ordered.find(session=>sameDay(session.date,today))||ordered.find(session=>session.date>today)||ordered[ordered.length-1]}

function renderTeacherHome(){
  const session=activeTeacherSession(),incidents=loadIncidents(),evaluations=loadEvaluations(),pendingMaterials=state.data.resources.filter(item=>!/^https?:\/\//i.test(item.link)).length;
  $('#teacherDashboard').innerHTML=`<article class="hero-card full-span" data-number="${esc(session?.courseDay||'•')}"><div><p class="eyebrow" style="color:#efb8b1">${session&&sameDay(session.date,new Date())?'Hoy':'Próxima sesión'}</p><h2>${esc(session?.title||'Sin sesiones programadas')}</h2><p>${session?`${fmtDate(session.date)} · ${esc(session.module)}`:'Revisa el programa del curso.'}</p></div><button class="primary" data-teacher-program>Ir al programa</button></article><article class="card dashboard-card full-span"><p class="eyebrow">Requiere atención</p><h2>Resumen</h2><div class="status-list"><div class="status-item"><div><strong>${incidents.length}</strong><p>incidencias comunicadas</p></div><span class="tag">Asistencia</span></div><div class="status-item"><div><strong>${pendingMaterials}</strong><p>materiales sin enlace</p></div><span class="tag">Materiales</span></div><div class="status-item"><div><strong>${evaluations.length}</strong><p>evaluaciones recibidas</p></div><span class="tag">Evaluaciones</span></div></div></article>`;
  $('[data-teacher-program]').onclick=()=>go('program');
}

function renderToday(forcedId=null){
  const session=state.data.sessions.find(item=>item.id===forcedId)||activeTeacherSession(); if(!session)return;
  $('#todayTitle').textContent=session.title;$('#todayMeta').textContent=`${fmtDate(session.date)} · Día ${session.courseDay||'—'} del curso`;$('#todayModule').textContent=session.module;
  const links=sessionLinks(session);$('#todayContent').innerHTML=`<div class="dashboard-grid"><article class="card dashboard-card"><p class="eyebrow">Actividades previstas</p><h2>Contenido de la sesión</h2><div class="status-list">${session.activities.map(item=>`<div class="status-item"><div><strong>${esc(item.title)}</strong><p>${esc(item.details||'Sin indicaciones adicionales')}</p></div></div>`).join('')}</div></article><article class="card dashboard-card"><p class="eyebrow">Materiales</p><h2>Enlaces de trabajo</h2><div class="status-list">${links.length?links.map(link=>`<div class="status-item"><div><strong>${esc(link.activity||link.label)}</strong><p>${esc(link.label)}</p></div><a class="ghost" href="${esc(link.url)}" target="_blank" rel="noopener">Abrir</a></div>`).join(''):'<div class="status-item"><div><strong>Sin enlaces</strong><p>Añádelos en MATERIALES_WEB.</p></div></div>'}</div></article><article class="card dashboard-card full-span"><p class="eyebrow">Asistencia rápida</p><h2>Alumno demo</h2>${attendanceButtons(session.id)}</article></div>`;bindAttendanceButtons(session.id);
}

function renderStudents(){const sessions=state.data.sessions,passed=sessions.filter(isSessionPassed).length,attendance=loadAttendance(),absences=Object.values(attendance).filter(value=>value==='absence').length,evaluations=loadEvaluations().length;$('#studentList').innerHTML=`<article class="card row"><strong>Alumno demo</strong><div><strong>${passed} fechas transcurridas</strong><br><small>${absences} ausencias · ${evaluations} evaluaciones enviadas</small></div><span class="tag">Perfil demo</span></article>`}

function renderAttendance(){const session=activeTeacherSession();if(!session)return;$('#attendancePanel').innerHTML=`<article class="card dashboard-card"><div class="section-title"><div><p class="eyebrow">${fmtDate(session.date)}</p><h2>${esc(session.title)}</h2></div><button class="primary" id="allPresent">Marcar presentes a todos</button></div><div class="status-item"><div><strong>Alumno demo</strong><p>${esc(session.module)}</p></div>${attendanceButtons(session.id)}</div></article>`;$('#allPresent').onclick=()=>saveAttendance(session.id,'present');bindAttendanceButtons(session.id)}

function attendanceButtons(sessionId){const value=loadAttendance()[sessionId]||'pending',labels={present:'Presente',absence:'Ausencia',justified:'Justificada',late:'Retraso',early:'Salida antes'};return `<div class="attendance-controls">${Object.entries(labels).map(([key,label])=>`<button class="ghost ${value===key?'active':''}" data-attendance="${key}" data-attendance-session="${esc(sessionId)}">${label}</button>`).join('')}</div>`}
function bindAttendanceButtons(){ $$('[data-attendance]').forEach(button=>button.onclick=()=>saveAttendance(button.dataset.attendanceSession,button.dataset.attendance)); }
function saveAttendance(sessionId,value){const data=loadAttendance();data[sessionId]=value;localStorage.setItem(ATTENDANCE_STORAGE_KEY,JSON.stringify(data));renderToday(sessionId);renderAttendance();renderStudents();showToast('Asistencia actualizada.')}
function loadAttendance(){try{return JSON.parse(localStorage.getItem(ATTENDANCE_STORAGE_KEY)||'{}')}catch{return{}}}

function renderTeacherEvaluations(){const records=loadEvaluations();$('#teacherEvaluations').innerHTML=state.data.modules.map(module=>{const record=records.find(item=>item.moduleId===module.id),average=record?record.answers.reduce((sum,value)=>sum+value,0)/record.answers.length:null;return `<article class="card dashboard-card"><p class="eyebrow">${esc(module.name)}</p><h2>${record?`${average.toFixed(1)} / 5`:'Sin respuestas'}</h2><p>${record?`1 respuesta recibida · ${esc(record.comment||'Sin comentario')}`:'El alumno demo todavía no ha enviado la evaluación.'}</p><div class="bar"><span style="width:${record?average/5*100:0}%"></span></div></article>`}).join('')}

function startOfDay(date){return new Date(date.getFullYear(),date.getMonth(),date.getDate())}
function sameDay(a,b){return a&&b&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()}
window.COURSE_DATA_SOURCE=SHEET_URL;
