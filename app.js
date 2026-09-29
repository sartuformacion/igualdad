const SHEET_ID = '1rCYDhM3QbOf5ZgHmo-46jk3vQk4oypppvtpHbTmAaL4';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
// La web guarda incidencias, evaluaciones y asistencia en la hoja a través de su script.
// La dirección del script se lee de la pestaña CONFIGURACION (CLAVE = URL_SCRIPT).
const EVALUATION_STORAGE_KEY = 'sartu-mis-evaluaciones-v2';
const QUEUE_STORAGE_KEY = 'sartu-envios-pendientes-v1';
const DEVICE_STORAGE_KEY = 'sartu-dispositivo-v1';
const STUDENT_NAMES = ['Jessica','Saio','Yuri','Andrea','Natalia','Xabier','Itxaso','Pilar','Zigor','Nerea','Joseph'];
const ANONYMOUS = 'Sin identificar';
const ATTENDANCE_LABELS = { present:'Presente', absence:'Ausencia', justified:'Justificada', late:'Retraso', early:'Salida antes' };
const INCIDENT_LABELS = { absence:'Ausencia', late:'Retraso', early:'Salida anticipada', other:'Otra incidencia' };

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

const state = { data: null, role: 'student', userName: '', page: 'home', month: null, currentSessionId: null, teacherKey: '', remote: null, attendanceDate: null };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const truthy = value => value === true || ['sí','si','true','1'].includes(String(value).toLowerCase());

window.addEventListener('DOMContentLoaded', () => { bindStatic(); loadCourse(); });

function bindStatic() {
  $('#retry').onclick = loadCourse;
  $$('[data-role]').forEach(button => button.onclick = enter);
  $('#studentLoginForm').onsubmit = enterNamedStudent;
  $('#enterAnonymous').onclick = () => enterRole('student',ANONYMOUS);
  $('#teacherLoginForm').onsubmit = enterTeacher;
  $('#logout').onclick = () => { state.page = 'home'; state.teacherKey = ''; state.remote = null; $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); };
  $('#refreshData').onclick = refreshTeacherData;
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
    flushQueue();
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
function enter(event) { const role=event.currentTarget.dataset.role||'student'; if(role==='teacher')return; enterRole('student',ANONYMOUS); }
function enterNamedStudent(event) {
  event.preventDefault();
  const input=$('#studentName'),error=$('#studentLoginError'),typed=keyText(input.value);
  const student=STUDENT_NAMES.find(name=>keyText(name)===typed);
  if(!student){error.textContent='No encuentro ese nombre en la lista. Revisa cómo está escrito o entra sin identificarte.';input.focus();return;}
  error.textContent=''; enterRole('student',student);
}
async function enterTeacher(event) {
  event.preventDefault();
  const password=$('#teacherPassword'),error=$('#teacherLoginError'),button=event.currentTarget.querySelector('button[type="submit"]');
  if(!password.value){password.focus();return;}
  error.textContent=''; button.disabled=true; button.textContent='Comprobando…';
  try {
    const result=await callScript({accion:'datos',clave:password.value});
    state.teacherKey=password.value; state.remote=normalizeRemote(result); password.value=''; enterRole('teacher','Coral');
  } catch(problem) {
    error.textContent=/contraseña/i.test(problem.message)?'La contraseña no es correcta.':`No he podido conectar con la hoja. ${problem.message}`;
    password.select();
  } finally { button.disabled=false; button.textContent='Entrar como profesora'; }
}
function enterRole(role,userName) {
  state.role=role; state.userName=userName; $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); $('#app').dataset.role=role; renderNav(); renderAll(); go(role==='teacher'?'teacher-home':'home');
}

function renderNav() {
  const items=state.role==='teacher'?[['teacher-home','⌂','Inicio'],['program','▦','Programa'],['students','◎','Alumnado'],['attendance','✓','Asistencia'],['evaluations','☆','Evaluaciones'],['resources','◇','Materiales']]:[['home','⌂','Inicio'],['program','▦','Programa'],['calendar','□','Calendario'],['resources','◇','Recursos']];
  $('#nav').innerHTML=items.map(([id,icon,label])=>`<button data-page="${id}" aria-label="${label}"><i aria-hidden="true">${icon}</i><span>${label}</span></button>`).join('');
  $$('#nav button').forEach(button=>button.onclick=()=>go(button.dataset.page));
  $('#userName').textContent=state.userName||(state.role==='teacher'?'Coral':ANONYMOUS); $('#userRole').textContent=state.role==='teacher'?'Profesora':'Alumno/a';
  $('#refreshData').classList.toggle('hidden',state.role!=='teacher');
}

function go(page) { state.page=page; $$('.page').forEach(section=>section.classList.toggle('active',section.id===`page-${page}`)); $$('#nav button').forEach(button=>button.classList.toggle('active',button.dataset.page===page)); const button=$(`#nav [data-page="${page}"]`); $('#topTitle').textContent=button?button.textContent.trim():'Aula'; if(page==='program'){ $('#moduleGrid').classList.remove('hidden'); $('#moduleView').classList.add('hidden'); } window.scrollTo({top:0,behavior:'smooth'}); }
function renderAll() { renderHome(); renderModules(); renderResources(); renderCalendar(); if(state.role==='teacher')renderTeacherPages(); }
function renderTeacherPages() { renderTeacherHome(); renderToday(); renderStudents(); renderAttendance(); renderTeacherEvaluations(); }

function renderHome() {
  const {cfg,sessions,resources}=state.data, ordered=[...sessions].sort((a,b)=>a.date-b.date), today=startOfDay(new Date()), next=ordered.find(session=>session.date>=today)||ordered[ordered.length-1],nextEvaluation=ordered.find(session=>session.date>=today&&calendarMilestones([session]).includes('evaluation')),currentModule=state.data.modules.find(module=>module.available&&module.sessions.some(session=>session.id===next?.id)),completed=currentModule?.sessions.filter(isSessionPassed).length||0,progress=currentModule?.sessions.length?completed/currentModule.sessions.length:0;
  $('#homeEyebrow').textContent='Tu aula'; $('#welcome').textContent='Buenos días.'; $('#homeIntro').textContent='Consulta el programa actualizado y continúa tu recorrido por el curso.'; $('#courseEdition').textContent=`Edición ${cfg.EDICION||'2026–2027'}`;
  state.currentSessionId=next?.id||null;
  $('#heroCard').dataset.number=next?.courseDay||'•'; $('#heroTitle').textContent=next?.title||'Programa del curso'; $('#heroText').textContent=next?`${sameDay(next.date,today)?'Sesión de hoy':'Próxima sesión'} · ${fmtDate(next.date)}${next.details?` · ${next.details}`:''}`:'Consulta las sesiones publicadas.'; $('#heroAction').textContent=next?'Ir a la sesión':'Ver programa';
  $('#progressValue').textContent=`${Math.round(progress*100)}%`; $('#progressText').textContent=currentModule?`${currentModule.title} · ${completed} de ${currentModule.sessions.length} sesiones realizadas`:'Todavía no hay un módulo disponible'; $('#progressBar').style.width=`${Math.round(progress*100)}%`;
  $('#nextDate').textContent=nextEvaluation?fmtDate(nextEvaluation.date,{day:'2-digit',month:'short'}):'—'; $('#nextEvent').textContent=nextEvaluation?.title||'Sin evaluaciones próximas';
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
  const evaluation=myEvaluation(module.id);
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
}

function programActivityCard(session,activity) {
  const available=sessionLinks(session),exact=available.filter(link=>keyText(link.activity)===keyText(activity.title)),links=exact.length?exact:(session.activities.length===1?available:[]);
  const resourceLinks=links.map(link=>`<a class="primary" href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.label||'Abrir recurso')}</a>`).join('');
  return `<article class="card session-card activity-card"><h3>${esc(activity.title)}</h3>${activity.details?`<p>${esc(activity.details)}</p>`:''}${resourceLinks?`<div class="session-actions">${resourceLinks}</div>`:''}</article>`;
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

function isSessionPassed(session){return session.date<startOfDay(new Date())}

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
  if(state.userName===ANONYMOUS){showToast('Para comunicar una incidencia, sal y entra con tu nombre.');return;}
  $('#incidentSessionId').value=id; $('#incidentSession').textContent=`${fmtDate(session.date)} · ${session.title}`; $('#incidentType').value='absence'; $('#incidentNote').value=''; $('#incidentDialog').showModal();
}

async function saveIncident(event) {
  event.preventDefault();
  const session=state.data.sessions.find(item=>item.id===$('#incidentSessionId').value); if(!session)return;
  const payload={accion:'incidencia',id:`inc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,alumno:state.userName,fecha:dmy(session.date),modulo:session.module,sesion:session.title,tipo:$('#incidentType').value,observaciones:$('#incidentNote').value.trim()};
  $('#incidentDialog').close(); showToast('Enviando la comunicación…');
  try { const result=await sendOrQueue(payload); showToast(result==='sent'?'Comunicación enviada a Coral.':'Sin conexión con la hoja. Se enviará automáticamente más tarde.'); }
  catch(problem) { showToast(`No se ha podido enviar: ${problem.message}`); }
}

const evaluationQuestions=['Los contenidos del módulo me han resultado útiles.','Las explicaciones han sido claras.','Las actividades me han ayudado a comprender los contenidos.','Puedo aplicar lo aprendido en situaciones reales.','Mi valoración global del módulo es positiva.'];
function studentKey(){return state.userName===ANONYMOUS?'anon':keyText(state.userName)}
function myEvaluation(moduleId){return readStorage(EVALUATION_STORAGE_KEY,[]).find(item=>item.student===studentKey()&&item.moduleId===moduleId)}
function openEvaluation(moduleId){const module=state.data.modules.find(item=>item.id===moduleId),existing=myEvaluation(moduleId);if(!module)return;$('#evaluationModule').value=moduleId;$('#evaluationEyebrow').textContent=module.title;$('#evaluationQuestions').innerHTML=evaluationQuestions.map((question,index)=>`<div class="question"><strong>${esc(question)}</strong><div class="scale">${[1,2,3,4,5].map(value=>`<label>${value}<input type="radio" name="evaluation-${index}" value="${value}" ${existing?.answers[index]===value?'checked':''} required></label>`).join('')}</div></div>`).join('');$('#evaluationComment').value=existing?.comment||'';$('#evaluationDialog').showModal()}
async function saveEvaluation(event){
  event.preventDefault();
  const moduleId=$('#evaluationModule').value,module=state.data.modules.find(item=>item.id===moduleId); if(!module)return;
  const form=new FormData(event.currentTarget),answers=evaluationQuestions.map((_,index)=>Number(form.get(`evaluation-${index}`))),comment=$('#evaluationComment').value.trim();
  const others=readStorage(EVALUATION_STORAGE_KEY,[]).filter(item=>!(item.student===studentKey()&&item.moduleId===moduleId));
  writeStorage(EVALUATION_STORAGE_KEY,[...others,{student:studentKey(),moduleId,answers,comment,createdAt:new Date().toISOString()}]);
  $('#evaluationDialog').close(); if(!$('#moduleView').classList.contains('hidden'))openModule(moduleId); showToast('Enviando tu evaluación…');
  try { const result=await sendOrQueue({accion:'evaluacion',alumno:state.userName===ANONYMOUS?'':state.userName,dispositivo:deviceId(),moduloId:moduleId,modulo:`${module.code} · ${module.title}`,respuestas:answers,comentario:comment}); showToast(result==='sent'?'Evaluación enviada. Gracias por tu valoración.':'Sin conexión con la hoja. Tu evaluación se enviará automáticamente más tarde.'); }
  catch(problem) { showToast(`No se ha podido enviar: ${problem.message}`); }
}
function showToast(message){const toast=$('#toast');toast.textContent=message;toast.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.classList.remove('show'),Math.max(2600,message.length*60))}

/* ---------- Conexión con la hoja (script de Google) ---------- */

function readStorage(key,fallback){try{const value=localStorage.getItem(key);return value?JSON.parse(value):fallback}catch{return fallback}}
function writeStorage(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{}}
function deviceId(){let id=readStorage(DEVICE_STORAGE_KEY,'');if(!id){id=`dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;writeStorage(DEVICE_STORAGE_KEY,id)}return id}
function scriptUrl(){return String(state.data?.cfg?.URL_SCRIPT||'').trim()}
function offlineError(message){const problem=new Error(message);problem.offline=true;return problem}

async function callScript(payload){
  const url=scriptUrl();
  if(!/^https:\/\/script\.google\.com\//i.test(url))throw offlineError('La web todavía no está conectada con la hoja: falta URL_SCRIPT en la pestaña CONFIGURACION.');
  let response,result;
  try{response=await fetch(url,{method:'POST',body:JSON.stringify(payload)})}catch{throw offlineError('No hay conexión con la hoja.')}
  try{result=await response.json()}catch{throw offlineError(`La hoja ha respondido con un error (${response.status}).`)}
  if(!result.ok)throw new Error(result.error||'La hoja no ha aceptado los datos.');
  return result;
}

async function sendOrQueue(payload){
  try{await callScript(payload);return 'sent'}
  catch(problem){if(!problem.offline)throw problem;writeStorage(QUEUE_STORAGE_KEY,[...readStorage(QUEUE_STORAGE_KEY,[]),payload]);return 'queued'}
}

async function flushQueue(){
  const pending=readStorage(QUEUE_STORAGE_KEY,[]); if(!pending.length||!scriptUrl())return;
  const rest=[];
  for(const payload of pending){try{await callScript(payload)}catch(problem){if(problem.offline)rest.push(payload)}}
  writeStorage(QUEUE_STORAGE_KEY,[...rest,...readStorage(QUEUE_STORAGE_KEY,[]).slice(pending.length)]);
}

const ATTENDANCE_FROM_LABEL=Object.fromEntries(Object.entries(ATTENDANCE_LABELS).map(([key,label])=>[keyText(label),key]));
function dayKey(date){return date?`${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`:''}
function attendanceKey(date,student){return `${dayKey(date)}|${keyText(student)}`}
function dmy(date){return `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}/${date.getFullYear()}`}
function fmtNumber(value){return value==null?'—':value.toLocaleString('es-ES',{minimumFractionDigits:1,maximumFractionDigits:1})}

function normalizeRemote(result){
  const attendance=new Map();
  (result.asistencia||[]).forEach(row=>{const date=asDate(row.FECHA_SESION),student=String(row.ALUMNO||'').trim(),status=ATTENDANCE_FROM_LABEL[keyText(row.ESTADO)];if(date&&student&&status)attendance.set(attendanceKey(date,student),{date,student,status})});
  return {
    attendance,
    incidents:(result.incidencias||[]).map(row=>({createdAt:String(row.REGISTRADO||''),student:String(row.ALUMNO||'').trim(),date:asDate(row.FECHA_SESION),module:String(row.MODULO||'').trim(),type:String(row.TIPO||'Incidencia').trim(),note:String(row.OBSERVACIONES||'').trim()})).filter(item=>item.student&&item.date).sort((a,b)=>b.date-a.date),
    evaluations:(result.evaluaciones||[]).map(row=>({moduleId:String(row.MODULO_ID||'').trim(),answers:['P1','P2','P3','P4','P5'].map(key=>Number(row[key])),comment:String(row.COMENTARIO||'').trim()})).filter(item=>item.moduleId&&item.answers.every(value=>value>=1&&value<=5))
  };
}

async function refreshTeacherData(){
  if(state.role!=='teacher')return;
  const button=$('#refreshData'); button.disabled=true; button.textContent='Actualizando…';
  try{state.remote=normalizeRemote(await callScript({accion:'datos',clave:state.teacherKey}));renderTeacherPages();showToast('Datos actualizados.')}
  catch(problem){showToast(`No se han podido actualizar los datos: ${problem.message}`)}
  finally{button.disabled=false;button.textContent='Actualizar'}
}

/* ---------- Vista de profesora ---------- */

function remoteData(){return state.remote||{attendance:new Map(),incidents:[],evaluations:[]}}
function allStudents(){const remote=remoteData(),known=new Set(STUDENT_NAMES.map(keyText)),extra=[];[...remote.incidents,...remote.attendance.values()].forEach(item=>{const key=keyText(item.student);if(item.student&&!known.has(key)){known.add(key);extra.push(item.student)}});return [...STUDENT_NAMES,...extra]}
function attendanceFor(date,student){return remoteData().attendance.get(attendanceKey(date,student))?.status||''}
function incidentsFor(date,student=null){return remoteData().incidents.filter(item=>sameDay(item.date,date)&&(!student||keyText(item.student)===keyText(student)))}
function courseDays(){const days=new Map();state.data.sessions.forEach(session=>{const key=dayKey(session.date);if(!days.has(key))days.set(key,{date:session.date,sessions:[]});days.get(key).sessions.push(session)});return [...days.values()].sort((a,b)=>a.date-b.date)}
function sessionCode(session){const reference=moduleReference(session.module);return reference.unitCode||reference.moduleCode||session.module}

function activeTeacherSession(){const today=startOfDay(new Date()),ordered=state.data.sessions;return ordered.find(session=>sameDay(session.date,today))||ordered.find(session=>session.date>today)||ordered[ordered.length-1]}

function renderTeacherHome(){
  const session=activeTeacherSession(),remote=remoteData(),students=allStudents(),pendingMaterials=state.data.resources.filter(item=>!/^https?:\/\//i.test(item.link)).length,isToday=session&&sameDay(session.date,new Date()),notices=session?incidentsFor(session.date):[],marked=session?students.filter(student=>attendanceFor(session.date,student)).length:0;
  $('#teacherDashboard').innerHTML=`<article class="hero-card full-span" data-number="${esc(session?.courseDay||'•')}"><div><p class="eyebrow" style="color:#efb8b1">${isToday?'Hoy':'Próxima sesión'}</p><h2>${esc(session?.title||'Sin sesiones programadas')}</h2><p>${session?`${fmtDate(session.date)} · ${esc(session.module)}`:'Revisa el programa del curso.'}</p></div><button class="primary" data-go="attendance">Pasar lista</button></article><article class="card dashboard-card"><p class="eyebrow">${session?`${isToday?'Hoy':'Próxima sesión'} · ${fmtDate(session.date,{day:'2-digit',month:'short'})}`:'Sesión'}</p><h2>Avisos del alumnado</h2><div class="status-list">${notices.length?notices.map(item=>`<div class="status-item"><div><strong>${esc(item.student)} · ${esc(item.type)}</strong><p>${esc(item.note||'Sin observaciones')}</p></div></div>`).join(''):'<div class="status-item"><div><strong>Sin avisos</strong><p>Nadie ha comunicado ausencias ni incidencias para esta sesión.</p></div></div>'}</div></article><article class="card dashboard-card"><p class="eyebrow">Requiere atención</p><h2>Resumen</h2><div class="status-list"><div class="status-item"><div><strong>${marked} de ${students.length}</strong><p>con asistencia registrada en esta sesión</p></div><button class="ghost" data-go="attendance">Asistencia</button></div><div class="status-item"><div><strong>${remote.incidents.length}</strong><p>comunicaciones del alumnado</p></div><button class="ghost" data-go="students">Alumnado</button></div><div class="status-item"><div><strong>${remote.evaluations.length}</strong><p>evaluaciones recibidas</p></div><button class="ghost" data-go="evaluations">Evaluaciones</button></div><div class="status-item"><div><strong>${pendingMaterials}</strong><p>materiales sin enlace</p></div><span class="tag">Materiales</span></div></div></article>`;
  $$('#teacherDashboard [data-go]').forEach(button=>button.onclick=()=>go(button.dataset.go));
}

function renderToday(forcedId=null){
  const session=state.data.sessions.find(item=>item.id===forcedId)||activeTeacherSession(); if(!session)return;
  $('#todayTitle').textContent=session.title;$('#todayMeta').textContent=`${fmtDate(session.date)} · Día ${session.courseDay||'—'} del curso`;$('#todayModule').textContent=session.module;
  const links=sessionLinks(session);$('#todayContent').innerHTML=`<div class="dashboard-grid"><article class="card dashboard-card"><p class="eyebrow">Actividades previstas</p><h2>Contenido de la sesión</h2><div class="status-list">${session.activities.map(item=>`<div class="status-item"><div><strong>${esc(item.title)}</strong><p>${esc(item.details||'Sin indicaciones adicionales')}</p></div></div>`).join('')}</div></article><article class="card dashboard-card"><p class="eyebrow">Materiales</p><h2>Enlaces de trabajo</h2><div class="status-list">${links.length?links.map(link=>`<div class="status-item"><div><strong>${esc(link.activity||link.label)}</strong><p>${esc(link.label)}</p></div><a class="ghost" href="${esc(link.url)}" target="_blank" rel="noopener">Abrir</a></div>`).join(''):'<div class="status-item"><div><strong>Sin enlaces</strong><p>Añádelos en MATERIALES_WEB.</p></div></div>'}</div></article></div>`;
}

function studentSummary(student){
  const counts={present:0,absence:0,justified:0,late:0,early:0},key=keyText(student),remote=remoteData();
  remote.attendance.forEach(item=>{if(keyText(item.student)===key)counts[item.status]++});
  const marked=Object.values(counts).reduce((sum,value)=>sum+value,0),attended=counts.present+counts.late+counts.early;
  return {counts,marked,attended,rate:marked?Math.round(attended/marked*100):null,incidents:remote.incidents.filter(item=>keyText(item.student)===key).length};
}

function renderStudents(){
  const students=allStudents(),incidents=remoteData().incidents; $('#studentCount').textContent=`${students.length} alumnos`;
  const rows=students.map(student=>{const summary=studentSummary(student);return `<tr><td><strong>${esc(student)}</strong></td><td>${summary.rate===null?'—':`${summary.rate}%`}<br><small>${summary.attended} de ${summary.marked} ${summary.marked===1?'sesión':'sesiones'}</small></td><td>${summary.counts.absence}</td><td>${summary.counts.justified}</td><td>${summary.counts.late}</td><td>${summary.counts.early}</td><td>${summary.incidents}</td></tr>`}).join('');
  $('#studentList').innerHTML=`<article class="card table-wrap"><table class="table"><thead><tr><th>Alumno/a</th><th>Asistencia</th><th>Ausencias</th><th>Justificadas</th><th>Retrasos</th><th>Salidas antes</th><th>Avisos</th></tr></thead><tbody>${rows}</tbody></table></article><div class="section"><div class="section-title"><h2>Comunicaciones del alumnado</h2></div><div class="list">${incidents.length?incidents.map(item=>`<article class="card row"><strong>${fmtDate(item.date,{day:'2-digit',month:'short'})}</strong><div><strong>${esc(item.student)} · ${esc(item.type)}</strong><br><small>${esc(item.note||'Sin observaciones')}${item.module?` · ${esc(item.module)}`:''}</small></div><small>${item.createdAt?`Enviado ${esc(item.createdAt)}`:''}</small></article>`).join(''):'<div class="card empty">Todavía no hay comunicaciones del alumnado.</div>'}</div></div>`;
}

function renderAttendance(){
  const days=courseDays(); if(!days.length)return;
  if(!state.attendanceDate||!days.some(day=>sameDay(day.date,state.attendanceDate)))state.attendanceDate=activeTeacherSession()?.date||days[0].date;
  const day=days.find(item=>sameDay(item.date,state.attendanceDate)),students=allStudents(),marked=students.filter(student=>attendanceFor(day.date,student)).length;
  const options=days.map(item=>`<option value="${dayKey(item.date)}" ${sameDay(item.date,day.date)?'selected':''}>${esc(fmtDate(item.date,{weekday:'short',day:'2-digit',month:'short'}))} · ${esc(unique(item.sessions.map(sessionCode)).join(', '))}</option>`).join('');
  $('#attendancePanel').innerHTML=`<article class="card dashboard-card"><div class="attendance-head"><div class="field attendance-day"><label for="attendanceDay">Sesión</label><select id="attendanceDay">${options}</select></div><button class="primary" id="allPresent">Marcar presentes a todos</button></div><p class="helper">${esc(unique(day.sessions.map(item=>item.title)).join(' · '))}</p><p class="helper"><strong>${marked} de ${students.length}</strong> con asistencia registrada. «Marcar presentes a todos» no cambia a quien ya tenga otra marca.</p><div class="status-list">${students.map(student=>{const notices=incidentsFor(day.date,student);return `<div class="status-item attendance-item"><div><strong>${esc(student)}</strong>${notices.map(item=>`<p class="student-notice">Ha avisado: ${esc(item.type)}${item.note?` · ${esc(item.note)}`:''}</p>`).join('')}</div>${attendanceButtons(day.date,student)}</div>`}).join('')}</div></article>`;
  $('#attendanceDay').onchange=event=>{state.attendanceDate=days.find(item=>dayKey(item.date)===event.target.value)?.date||null;renderAttendance()};
  $('#allPresent').onclick=()=>{const pending=students.filter(student=>!attendanceFor(day.date,student));if(!pending.length){showToast('Ya están todos registrados.');return}saveAttendance(day,pending.map(student=>({student,status:'present'})))};
  $$('#attendancePanel [data-attendance]').forEach(button=>button.onclick=()=>saveAttendance(day,[{student:button.dataset.attendanceStudent,status:button.dataset.attendance}]));
}

function attendanceButtons(date,student){const value=attendanceFor(date,student);return `<div class="attendance-controls">${Object.entries(ATTENDANCE_LABELS).map(([key,label])=>`<button class="ghost ${value===key?'active':''}" data-attendance="${key}" data-attendance-student="${esc(student)}">${label}</button>`).join('')}</div>`}

async function saveAttendance(day,changes){
  const map=remoteData().attendance,previous=changes.map(change=>{const key=attendanceKey(day.date,change.student);return [key,map.get(key)]});
  const refresh=()=>{renderAttendance();renderStudents();renderTeacherHome()};
  changes.forEach(change=>map.set(attendanceKey(day.date,change.student),{date:day.date,student:change.student,status:change.status})); refresh();
  try{
    await callScript({accion:'asistencia',clave:state.teacherKey,filas:changes.map(change=>({fecha:dmy(day.date),alumno:change.student,estado:ATTENDANCE_LABELS[change.status],modulo:unique(day.sessions.map(item=>item.module)).join(' / '),sesion:unique(day.sessions.map(item=>item.title)).join(' / ')}))});
    showToast(changes.length>1?`Asistencia guardada: ${changes.length} presentes.`:'Asistencia guardada.');
  }catch(problem){
    previous.forEach(([key,value])=>value?map.set(key,value):map.delete(key)); refresh();
    showToast(`No se ha guardado la asistencia: ${problem.message}`);
  }
}

function renderTeacherEvaluations(){
  const records=remoteData().evaluations,total=allStudents().length,average=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
  $('#teacherEvaluations').innerHTML=state.data.modules.map(module=>{
    const items=records.filter(item=>item.moduleId===module.id),overall=average(items.map(item=>average(item.answers))),comments=items.map(item=>item.comment).filter(Boolean);
    const questions=evaluationQuestions.map((question,index)=>`<div class="question-result"><span>${esc(question)}</span><strong>${fmtNumber(average(items.map(item=>item.answers[index])))}</strong></div>`).join('');
    return `<article class="card dashboard-card"><p class="eyebrow">${esc(module.code)}</p><h2>${overall===null?'Sin respuestas':`${fmtNumber(overall)} / 5`}</h2><p class="helper">${esc(module.title)} · ${items.length} de ${total} ${items.length===1?'respuesta':'respuestas'}</p><div class="bar"><span style="width:${overall===null?0:overall/5*100}%"></span></div>${items.length?`<div class="question-results">${questions}</div>`:''}${comments.length?`<div class="section"><p class="eyebrow">Comentarios</p><ul class="comment-list">${comments.map(comment=>`<li>${esc(comment)}</li>`).join('')}</ul></div>`:''}</article>`;
  }).join('');
}

function startOfDay(date){return new Date(date.getFullYear(),date.getMonth(),date.getDate())}
function sameDay(a,b){return a&&b&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()}
window.COURSE_DATA_SOURCE=SHEET_URL;
