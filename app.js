
let produtos = [];
let movimentos = [];
let custos = [];
let telegramConfig = { token:'', chatId:'' };
let telegramQueue = [];
let appDb = null;

// === v5.0 ALTERAÇÃO === Logo oficial Dist Lírios (arquivo na raiz)
const LOGO_SRC = 'logo-topo.png';
const LS_PRODUTOS = 'aguaLirios_produtos';
const LS_MOVS = 'aguaLirios_movs';
const LS_CUSTOS = 'aguaLirios_custos';
const LS_TG_CONFIG = 'aguaLirios_telegram_config';
const LS_TG_QUEUE = 'aguaLirios_telegram_queue';

const FIXOS = [
  {id:'p1',nome:'Água 20L',quantidade:0,precoUnitario:0,estoqueMinimo:5},
  {id:'p2',nome:'Água 10L',quantidade:0,precoUnitario:0,estoqueMinimo:5},
  {id:'p3',nome:'Água 5L',quantidade:0,precoUnitario:0,estoqueMinimo:5},
  {id:'p4',nome:'Água 1,5L (fardo 6 unid.)',quantidade:0,precoUnitario:0,estoqueMinimo:5},
  {id:'p5',nome:'Água 500ml Sem Gás (fardo 12 unid.)',quantidade:0,precoUnitario:0,estoqueMinimo:10},
  {id:'p6',nome:'Água 500ml Com Gás (fardo 12 unid.)',quantidade:0,precoUnitario:0,estoqueMinimo:10},
  {id:'p7',nome:'Água 300ml Pet (fardo 12 unid.)',quantidade:0,precoUnitario:0,estoqueMinimo:10},
  {id:'p8',nome:'Garrafão PP 20L (Embalagem)',quantidade:0,precoUnitario:0,estoqueMinimo:2},
  {id:'p9',nome:'Garrafão Pet 20L (Embalagem)',quantidade:0,precoUnitario:0,estoqueMinimo:2},
  {id:'p10',nome:'Garrafão Pet 10L (Embalagem)',quantidade:0,precoUnitario:0,estoqueMinimo:2}
];

const byId = (id)=>document.getElementById(id);
const fmtMoney = (v)=>'R$ ' + Number(v||0).toFixed(2).replace('.', ',');
const normPay = (v)=>{ const s=String(v||'dinheiro').toLowerCase(); return s==='pix'?'pix':(s==='vale'?'vale':'dinheiro'); };
const payLabel = (v)=> normPay(v)==='pix'?'Pix':(normPay(v)==='vale'?'Vale':'Dinheiro');
const todayKey = (ts)=>new Date(ts).toISOString().slice(0,10);
const sameDayISO = (ts, ref)=> todayKey(ts)===todayKey(ref);
const sameMonth = (ts, d)=>{ const x=new Date(ts), y=new Date(d); return x.getFullYear()===y.getFullYear() && x.getMonth()===y.getMonth(); };

// === v5.5 ALTERACAO === Funcoes de geolocalizacao e calculo de distancia (Haversine)
function calcularDistancia(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// === v8.1 ALTERAÇÃO === Função para encontrar ou criar ponto cadastrado
async function encontrarOuCriarPonto(lat, lng, tipo, distribuidora) {
  const pontos = await idbGetAll('pontos_cadastrados');
  const RAIO_METROS = 8;
  
  for (const ponto of pontos) {
    if (!ponto.ativo) continue;
    const dist = calcularDistancia(lat, lng, ponto.lat, ponto.lng);
    if (dist <= RAIO_METROS) {
      return ponto;
    }
  }
  
  const novoPonto = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    distribuidora: distribuidora || localStorage.getItem('aguaLirios_distribuidora_nome') || 'Distribuidora nao informada',
    nome: null,
    lat: lat,
    lng: lng,
    tipo: tipo,
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
    ativo: true
  };
  
  await idbPut('pontos_cadastrados', novoPonto);
  return novoPonto;
}

// === v8.2 ALTERAÇÃO === Buscar sugestões de pontos azuis próximos (15 metros)
async function buscarSugestoesPontosAntigos(lat, lng) {
  const pontos = await idbGetAll('pontos_cadastrados');
  const acoesPonto = await idbGetAll('acoes_ponto');
  const RAIO_METROS = 15;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  
  const sugestoes = [];
  for (const ponto of pontos) {
    if (!ponto.ativo) continue;
    const dist = calcularDistancia(lat, lng, ponto.lat, ponto.lng);
    if (dist > RAIO_METROS) continue;
    
    const acaoHoje = acoesPonto.find(a => {
      const aData = new Date(a.ts);
      aData.setHours(0, 0, 0, 0);
      return a.pontoId === ponto.id && aData >= hoje;
    });
    
    if (!acaoHoje) {
      sugestoes.push({
        ponto: ponto,
        distancia: Math.round(dist)
      });
    }
  }
  
  return sugestoes.sort((a, b) => a.distancia - b.distancia);
}

async function obterGeolocalizacao() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocalizacao nao disponivel'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

function escapeHtml(s){
  return String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
function toast(msg){
  const t = byId('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>t.classList.add('hidden'), 2200);
}
async function nativeShare(shareData){
  try {
    if(navigator.share){
      await navigator.share(shareData);
      return true;
    }
  } catch(e) {
    return false;
  }
  return false;
}
async function shareTextFallback(title, text){
  const ok = await nativeShare({ title, text });
  if(ok) return true;
  try {
    await navigator.clipboard.writeText(text);
    toast('Texto copiado para compartilhar.');
    return true;
  } catch(e) {
    openModal(title, `<textarea rows="10">${escapeHtml(text)}</textarea>`, ()=>true);
    return true;
  }
}

function carregarDados(){
  try {
    produtos = JSON.parse(localStorage.getItem(LS_PRODUTOS) || 'null') || FIXOS;
    movimentos = JSON.parse(localStorage.getItem(LS_MOVS) || '[]');
    custos = JSON.parse(localStorage.getItem(LS_CUSTOS) || '[]');
    telegramConfig = JSON.parse(localStorage.getItem(LS_TG_CONFIG) || '{"token":"","chatId":""}');
    telegramQueue = JSON.parse(localStorage.getItem(LS_TG_QUEUE) || '[]');
  } catch(e) {
    produtos = FIXOS; movimentos=[]; custos=[]; telegramConfig={token:'',chatId:''}; telegramQueue=[];
  }
  salvarDados();
}
function salvarDados(){
  localStorage.setItem(LS_PRODUTOS, JSON.stringify(produtos));
  localStorage.setItem(LS_MOVS, JSON.stringify(movimentos));
  localStorage.setItem(LS_CUSTOS, JSON.stringify(custos));
  localStorage.setItem(LS_TG_CONFIG, JSON.stringify(telegramConfig));
  localStorage.setItem(LS_TG_QUEUE, JSON.stringify(telegramQueue));
}

// === v4.9 ALTERAÇÃO === openDb versão 3: adiciona store fechamentos
// === v5.5 ALTERAÇÃO === openDb versão 4: adiciona store pontos_rota para geolocalização
function openDb(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open('aguaLirios_clientes_db', 6);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains('clientes')) db.createObjectStore('clientes', { keyPath:'id' });
      if(!db.objectStoreNames.contains('vales_pendentes')) db.createObjectStore('vales_pendentes', { keyPath:'id' });
      // === v4.9 ALTERAÇÃO === Nova store para fechamentos diários
      if(!db.objectStoreNames.contains('fechamentos')) {
        const fStore = db.createObjectStore('fechamentos', { keyPath:'id' });
        fStore.createIndex('por_data', 'data', { unique: true });
      }
      // === v5.5 ALTERAÇÃO === Nova store para pontos de rota com geolocalização
      if(!db.objectStoreNames.contains('pontos_rota')) {
        const pStore = db.createObjectStore('pontos_rota', { keyPath:'id' });
        pStore.createIndex('por_data', 'ts', { unique: false });
      }
      // === v8.1 ALTERAÇÃO === Nova store para cadastro permanente de pontos
      if(!db.objectStoreNames.contains('pontos_cadastrados')) {
        const pcStore = db.createObjectStore('pontos_cadastrados', { keyPath:'id' });
        pcStore.createIndex('por_distribuidora', 'distribuidora', { unique: false });
        pcStore.createIndex('por_ativo', 'ativo', { unique: false });
      }
      // === v8.1 ALTERAÇÃO === Nova store para ações de pontos (renomear pontos_rota)
      if(!db.objectStoreNames.contains('acoes_ponto')) {
        const apStore = db.createObjectStore('acoes_ponto', { keyPath:'id' });
        apStore.createIndex('por_ponto', 'pontoId', { unique: false });
        apStore.createIndex('por_data', 'ts', { unique: false });
      }
      // === v8.4.1 ALTERAÇÃO === Nova store para movimentos de comodato
      if(!db.objectStoreNames.contains('comodato_movimentos')) {
        const cmStore = db.createObjectStore('comodato_movimentos', { keyPath:'id' });
        cmStore.createIndex('por_cliente', 'clientId', { unique: false });
        cmStore.createIndex('por_data', 'ts', { unique: false });
      }
    };
    req.onsuccess = (e)=>{ appDb = e.target.result; resolve(appDb); };
    req.onerror = ()=> reject(req.error);
  });
}
function getStore(name, mode='readonly'){ return appDb.transaction(name, mode).objectStore(name); }
function idbGetAll(name){
  return new Promise((resolve,reject)=>{
    const req = getStore(name).getAll();
    req.onsuccess = ()=> resolve(req.result || []);
    req.onerror = ()=> reject(req.error);
  });
}
function idbGet(name, key){
  return new Promise((resolve,reject)=>{
    const req = getStore(name).get(key);
    req.onsuccess = ()=> resolve(req.result || null);
    req.onerror = ()=> reject(req.error);
  });
}
function idbPut(name, value){
  return new Promise((resolve,reject)=>{
    const tx = appDb.transaction(name, 'readwrite');
    const req = tx.objectStore(name).put(value);
    req.onsuccess = ()=> resolve(value);
    req.onerror = ()=> reject(req.error);
  });
}
function idbAddValePendente(v){ return idbPut('vales_pendentes', v); }

function hasTelegramConfig(){ return Boolean((telegramConfig.token||'').trim() && (telegramConfig.chatId||'').trim()); }
function queueTelegramMessage(text){ telegramQueue.push({id:String(Date.now())+'-'+Math.random().toString(16).slice(2), text, ts:new Date().toISOString()}); salvarDados(); }
async function sendTelegramTextSilently(text){
  if(!hasTelegramConfig()) return false;
  const url = `https://api.telegram.org/bot${telegramConfig.token.trim()}/sendMessage`;
  const res = await fetch(url, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id: telegramConfig.chatId.trim(), text })
  });
  return !!res.ok;
}
async function telegramSilentDispatch(text){
  if(!hasTelegramConfig()) return;
  if(!navigator.onLine) return queueTelegramMessage(text);
  try {
    const ok = await sendTelegramTextSilently(text);
    if(!ok) queueTelegramMessage(text);
  } catch(e) {
    queueTelegramMessage(text);
  }
}

// === v9.5 ALTERAÇÃO === Envia o Extrato Operacional como mensagens Telegram
// O limite oficial do sendMessage é 4096 caracteres; 3800 deixa margem para
// cabeçalho, Unicode, emojis e diferenças de contagem da API.
const TELEGRAM_EXTRATO_SAFE_LIMIT = 3800;

function dividirExtratoOperacional(extrato) {
  const texto = String(extrato || '');
  if (!texto) return [''];

  // Reserva espaço para o maior cabeçalho técnico possível antes de conhecer N.
  const digitosEstimados = String(Math.max(1, texto.length)).length;
  const cabecalhoMaximo = `EXTRATO OPERACIONAL — ${'9'.repeat(digitosEstimados)}/${'9'.repeat(digitosEstimados)}\n`;
  const limiteCorpo = Math.max(1, TELEGRAM_EXTRATO_SAFE_LIMIT - cabecalhoMaximo.length);
  const partes = [];
  let inicio = 0;

  while (inicio < texto.length) {
    const restante = texto.length - inicio;
    if (restante <= limiteCorpo) {
      partes.push(texto.slice(inicio));
      break;
    }

    const limite = inicio + limiteCorpo;
    const trecho = texto.slice(inicio, limite);
    let fim = trecho.lastIndexOf('\n\n');

    // Primeiro tenta terminar entre seções completas, preservando o separador.
    if (fim >= 0) {
      fim += 2;
    } else {
      // Se não houver uma seção completa, termina na última linha completa.
      fim = trecho.lastIndexOf('\n');
      if (fim >= 0) fim += 1;
    }

    // Último recurso para uma linha individual maior que o limite seguro.
    if (fim <= 0) fim = limite;
    partes.push(texto.slice(inicio, inicio + fim));
    inicio += fim;
  }

  return partes;
}

async function enviarExtratoOperacionalTelegram(extrato) {
  const partesCorpo = dividirExtratoOperacional(extrato);
  const totalPartes = partesCorpo.length;
  const mensagens = partesCorpo.map((parte, indice) =>
    `EXTRATO OPERACIONAL — ${indice + 1}/${totalPartes}\n${parte}`
  );

  if (!hasTelegramConfig()) return false;

  // Mantém o padrão offline existente: as mensagens ficam na fila na ordem.
  if (!navigator.onLine) {
    mensagens.forEach(mensagem => queueTelegramMessage(mensagem));
    return false;
  }

  for (let indice = 0; indice < mensagens.length; indice++) {
    try {
      const ok = await sendTelegramTextSilently(mensagens[indice]);
      if (!ok) {
        for (let restante = indice; restante < mensagens.length; restante++) {
          queueTelegramMessage(mensagens[restante]);
        }
        console.warn(`[v9.5] Falha ao enviar parte ${indice + 1}/${totalPartes} do Extrato Operacional.`);
        return false;
      }
    } catch (e) {
      for (let restante = indice; restante < mensagens.length; restante++) {
        queueTelegramMessage(mensagens[restante]);
      }
      console.warn(`[v9.5] Erro ao enviar parte ${indice + 1}/${totalPartes} do Extrato Operacional:`, e);
      return false;
    }
  }

  return true;
}

// === v9.7 ALTERAÇÃO === Divide e envia o fechamento sem alterar o transporte V9.5 do Extrato
function dividirFechamentoDiaTelegram(fechamento) {
  const texto = String(fechamento || '');
  if (!texto) return [''];

  const digitosEstimados = String(Math.max(1, texto.length)).length;
  const cabecalhoMaximo = `FECHAMENTO DO DIA — ${'9'.repeat(digitosEstimados)}/${'9'.repeat(digitosEstimados)}\n`;
  const limiteCorpo = Math.max(1, TELEGRAM_EXTRATO_SAFE_LIMIT - cabecalhoMaximo.length);
  const partes = [];
  let inicio = 0;

  while (inicio < texto.length) {
    const restante = texto.length - inicio;
    if (restante <= limiteCorpo) {
      partes.push(texto.slice(inicio));
      break;
    }

    const limite = inicio + limiteCorpo;
    const trecho = texto.slice(inicio, limite);
    let fim = trecho.lastIndexOf('\n\n');
    if (fim >= 0) {
      fim += 2;
    } else {
      fim = trecho.lastIndexOf('\n');
      if (fim >= 0) fim += 1;
    }
    if (fim <= 0) fim = limite;
    partes.push(texto.slice(inicio, inicio + fim));
    inicio += fim;
  }

  return partes;
}

async function enviarFechamentoDiaTelegram(fechamento) {
  const partesCorpo = dividirFechamentoDiaTelegram(fechamento);
  const totalPartes = partesCorpo.length;
  const mensagens = partesCorpo.map((parte, indice) =>
    `FECHAMENTO DO DIA — ${indice + 1}/${totalPartes}\n${parte}`
  );

  if (!hasTelegramConfig()) return false;
  if (!navigator.onLine) {
    mensagens.forEach(mensagem => queueTelegramMessage(mensagem));
    return false;
  }

  for (let indice = 0; indice < mensagens.length; indice++) {
    try {
      const ok = await sendTelegramTextSilently(mensagens[indice]);
      if (!ok) {
        for (let restante = indice; restante < mensagens.length; restante++) {
          queueTelegramMessage(mensagens[restante]);
        }
        console.warn(`[v9.7] Falha ao enviar parte ${indice + 1}/${totalPartes} do Fechamento do Dia.`);
        return false;
      }
    } catch (e) {
      for (let restante = indice; restante < mensagens.length; restante++) {
        queueTelegramMessage(mensagens[restante]);
      }
      console.warn(`[v9.7] Erro ao enviar parte ${indice + 1}/${totalPartes} do Fechamento do Dia:`, e);
      return false;
    }
  }

  return true;
}

// === v5.4 ALTERAÇÃO === Envia arquivo de backup como documento no Telegram via sendDocument
async function telegramSendDocument(data, filename, caption, mimeType = 'application/json') {
  if (!hasTelegramConfig()) return;
  if (!navigator.onLine) return;
  try {
    const blob = new Blob([data], { type: mimeType });
    const formData = new FormData();
    formData.append('chat_id', telegramConfig.chatId.trim());
    formData.append('document', blob, filename);
    if (caption) formData.append('caption', caption);
    const url = `https://api.telegram.org/bot${telegramConfig.token.trim()}/sendDocument`;
    const res = await fetch(url, { method: 'POST', body: formData });
    if (!res.ok) console.warn('[v5.4] Falha ao enviar documento ao Telegram:', await res.text());
  } catch (e) {
    console.warn('[v5.4] Erro ao enviar documento ao Telegram:', e);
  }
}

async function flushTelegramQueue(){
  if(!navigator.onLine || !hasTelegramConfig() || !telegramQueue.length) return;
  const pending = [...telegramQueue];
  const left = [];
  for(const item of pending){
    try {
      const ok = await sendTelegramTextSilently(item.text);
      if(!ok) left.push(item);
    } catch(e) {
      left.push(item);
      break;
    }
  }
  if(left.length !== telegramQueue.length) {
    telegramQueue = left;
    salvarDados();
  }
}
// === v7.0 ALTERACAO === slugifyDistribuidoraNome: normaliza nome para usar em nomes de arquivo
function slugifyDistribuidoraNome(nome) {
  return String(nome || 'distribuidora_nao_informada')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function openModal(title, bodyHTML, onConfirm){
  byId('modal-title').textContent = title;
  byId('modal-body').innerHTML = bodyHTML;
  byId('modal').classList.remove('hidden');
  byId('modal-cancel').onclick = ()=> byId('modal').classList.add('hidden');
  byId('modal-confirm').onclick = async ()=> {
    const ok = onConfirm ? await onConfirm() : true;
    if(ok !== false) byId('modal').classList.add('hidden');
  };
}
function openTelegramConfigProtected(){
  openModal('Configurações do Telegram', `
    <label>Senha</label>
    <input type="password" id="tg-pass" placeholder="Informe a senha">
  `, ()=>{
    const pass = (byId('tg-pass').value||'').trim();
    if(pass !== '975321') { alert('Senha incorreta.'); return false; }
    setTimeout(()=>openModal('Telegram — Configurações', `
      <label>Token do Bot</label>
      <textarea id="tg-token" rows="3">${escapeHtml(telegramConfig.token||'')}</textarea>
      <label>Chat ID</label>
      <input id="tg-chatid" value="${escapeHtml(telegramConfig.chatId||'')}">
    `, ()=>{
      telegramConfig = { token:(byId('tg-token').value||'').trim(), chatId:(byId('tg-chatid').value||'').trim() };
      salvarDados();
      setTimeout(flushTelegramQueue, 60);
      return true;
    }), 50);
    return true;
  });
}

window.addEventListener('DOMContentLoaded', async ()=>{
  carregarDados();
  try { await openDb(); } catch(e) { console.error(e); }
  // === v4.7 ALTERAÇÃO === Inicializa o módulo de AutoBackup
  if (typeof window.AutoBackup !== 'undefined' && typeof window.AutoBackup.initAutoBackup === 'function') {
    window.AutoBackup.initAutoBackup();
  }
  const bind = (id, fn) => {
    const el = byId(id);
    if (el) el.onclick = fn;
  };
  bind('btn-venda', showVenda);
  bind('btn-estoque', showEstoque);
  bind('btn-custos', showCustos);
  bind('btn-rel', showRelatorios);
  bind('btn-clientes', showClientes);
  bind('btn-mapa', showMapa);
  bind('btn-config', showConfiguracoes);
  window.addEventListener('online', flushTelegramQueue);
  flushTelegramQueue();
  showHome();
});
function renderScreen(title, subtitle, bodyHTML){
  byId('home').classList.add('hidden');
  const c = byId('conteudo');
  c.classList.remove('hidden');
  c.innerHTML = `
    <div class="section-shell">
      <div class="section-head">
        <button class="back-btn" id="btn-back-home">← Voltar</button>
        <h1 class="section-title">${escapeHtml(title)}</h1>
        ${subtitle ? `<div class="section-subtitle">${escapeHtml(subtitle)}</div>` : ''}
      </div>
      ${bodyHTML}
    </div>
  `;
  byId('btn-back-home').onclick = showHome;
}
function showHome(){
  byId('conteudo').classList.add('hidden');
  byId('conteudo').innerHTML='';
  byId('home').classList.remove('hidden');
}

async function showClientes(){
  renderScreen('Clientes', 'Cadastro, edição, recebimento e compartilhamento de extrato.', `
    <div class="card">
      <form id="form-cliente" class="form-grid">
        <input type="hidden" id="cli-id">
        <div><label class="lbl">Nome</label><input class="input-big" id="cli-nome" required></div>
        <div class="form-grid two">
          <div><label class="lbl">Telefone</label><input class="input-big" id="cli-telefone"></div>
          <div>
            <label class="lbl">Tipo de Cliente</label>
            <select class="input-big" id="cli-tipo">
              <option value="Residência">Residência</option>
              <option value="Comércio">Comércio</option>
              <option value="Não informado">Não informado</option>
            </select>
          </div>
        </div>
        <div class="form-grid two">
          <div><label class="lbl">Cidade / Bairro</label><input class="input-big" id="cli-cidade"></div>
          <div>
            <label class="lbl">Situação</label>
            <select class="input-big" id="cli-situacao">
              <option value="Ativo">Ativo</option>
              <option value="Inativo">Inativo</option>
            </select>
          </div>
        </div>
        <div><label class="lbl">Observação</label><textarea class="input-big" id="cli-obs" rows="2"></textarea></div>
        
        <!-- === v8.9 ALTERAÇÃO === Bloco de GPS do Cliente -->
        <div class="card-inner" style="background:#f1f5f9;padding:12px;border-radius:8px;margin-bottom:12px;">
          <label class="lbl" style="margin-top:0;">Localização GPS Fixa</label>
          <div id="cli-geo-status" style="display:flex;align-items:center;gap:10px;margin:8px 0;">
            <span id="geo-status-icon" style="font-size:1.4em;">🔴</span>
            <span id="geo-status-text" style="font-size:0.9em;font-weight:bold;color:#475569;">Sem GPS cadastrado</span>
          </div>
          <input type="hidden" id="cli-latitude">
          <input type="hidden" id="cli-longitude">
          <input type="hidden" id="cli-data-localizacao">
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn-secondary" id="btn-gps-acao" style="flex:1;font-size:0.85em;padding:8px;">Capturar GPS do Cliente</button>
          </div>
        </div>

        <div><label class="lbl">Débito Total</label><input class="input-big" id="cli-debito" value="R$ 0,00" readonly style="background:#f3f4f6;"></div>
        <button class="btn-primary" type="submit">Salvar Cliente</button>
      </form>
    </div>

    <div class="card" style="background:#f8fafc;">
      <div id="cliente-stats" style="display:flex;justify-content:space-around;text-align:center;font-size:0.9em;font-weight:bold;color:#475569;">
        <div>Ativos: <span id="stat-ativos">0</span></div>
        <div>Inativos: <span id="stat-inativos">0</span></div>
        <div>Total: <span id="stat-total">0</span></div>
      </div>
    </div>

    <div class="card">
      <div class="form-grid" style="margin-bottom:12px;">
        <input type="text" id="cli-busca" class="input-big" placeholder="Buscar por nome, telefone ou bairro...">
        <select id="cli-filtro" class="input-big" style="margin-top:8px;">
          <option value="Todos">Todos os Clientes</option>
          <option value="Ativos">Apenas Ativos</option>
          <option value="Inativos">Apenas Inativos</option>
          <option value="Comércio">Apenas Comércio</option>
          <option value="Residência">Apenas Residência</option>
        </select>
      </div>
      <div id="lista-clientes" class="stack"></div>
    </div>
  `);

  byId('cli-busca').oninput = () => renderListaClientes();
  byId('cli-filtro').onchange = () => renderListaClientes();

  // === v8.9 ALTERAÇÃO === Lógica de GPS do Cliente
  // === v8.9.3 CORREÇÃO VISUAL === Tornar global para resetFormCliente acessar
  window.updateGeoStatus = (lat, lng, ts) => {
    const icon = byId('geo-status-icon');
    const text = byId('geo-status-text');
    const btn = byId('btn-gps-acao');
    const latInput = byId('cli-latitude');
    const lngInput = byId('cli-longitude');
    const tsInput = byId('cli-data-localizacao');

    if(!icon || !text || !btn) return;

    latInput.value = lat || '';
    lngInput.value = lng || '';
    tsInput.value = ts || '';

    if (lat && lng) {
      icon.innerHTML = '🟢';
      text.innerHTML = `Com GPS cadastrado<br><span style="font-weight:normal;font-size:0.85em;color:#64748b;">Atualizado em: ${new Date(ts).toLocaleString('pt-BR')}</span>`;
      btn.textContent = 'Atualizar GPS do Cliente';
    } else {
      icon.innerHTML = '🔴';
      text.textContent = 'Sem GPS cadastrado';
      btn.textContent = 'Capturar GPS do Cliente';
    }
  };

  const capturarLocalizacao = async () => {
    const icon = byId('geo-status-icon');
    const text = byId('geo-status-text');
    
    icon.innerHTML = '⏳';
    text.textContent = 'Obtendo localização...';

    try {
      const pos = await obterGeolocalizacao();
      const ts = new Date().toISOString();
      
      // === v8.9.2 CORREÇÃO DEFINITIVA ===
      // 1. Atualiza os inputs ocultos para que o form.onsubmit pegue os valores
      byId('cli-latitude').value = pos.lat;
      byId('cli-longitude').value = pos.lng;
      byId('cli-data-localizacao').value = ts;
      
      // 2. Atualiza o status visual
      updateGeoStatus(pos.lat, pos.lng, ts);
      
      // 3. Se for edição de cliente existente, persiste IMEDIATAMENTE no banco
      const idAtual = (byId('cli-id').value||'').trim();
      if(idAtual) {
        const antigo = await idbGet('clientes', idAtual);
        if(antigo) {
          const atualizado = { 
            ...antigo, 
            latitude: pos.lat, 
            longitude: pos.lng, 
            dataLocalizacao: ts 
          };
          await idbPut('clientes', atualizado);
          // Opcional: recarregar a lista para refletir o selo de GPS
          await renderListaClientes();
        }
      }
      
      toast('GPS capturado com sucesso.');
    } catch (e) {
      toast('Falha ao obter GPS. Verifique a permissão.');
      console.warn('[v8.9.2] Erro GPS:', e);
      // Restaura o status visual com o que estiver nos inputs ocultos
      updateGeoStatus(byId('cli-latitude').value, byId('cli-longitude').value, byId('cli-data-localizacao').value);
    }
  };

  byId('btn-gps-acao').onclick = capturarLocalizacao;

  byId('form-cliente').onsubmit = async (e)=>{
    e.preventDefault();
    const idAtual = (byId('cli-id').value||'').trim();
    const antigo = idAtual ? await idbGet('clientes', idAtual) : null;
    // === v8.9.2 CORREÇÃO DEFINITIVA ===
    // Prioriza o valor que está no input oculto (que pode ter sido acabado de capturar)
    // Se o input estiver vazio, mantém o valor antigo (preservação de dados)
    const latVal = byId("cli-latitude").value;
    const lngVal = byId("cli-longitude").value;
    const tsVal = byId("cli-data-localizacao").value;

    const cliente = {
      id: idAtual || String(Date.now()),
      nome: (byId('cli-nome').value||'').trim(),
      telefone: (byId('cli-telefone').value||'').trim(),
      tipo: byId('cli-tipo').value,
      cidade: (byId('cli-cidade').value||'').trim(),
      situacao: byId('cli-situacao').value,
      obs: (byId('cli-obs').value||'').trim(),
      debitoTotal: Number(antigo?.debitoTotal || 0),
      garrafoesEmprestados: Number(antigo?.garrafoesEmprestados || 0),
      latitude: latVal ? Number(latVal) : (antigo?.latitude || null),
      longitude: lngVal ? Number(lngVal) : (antigo?.longitude || null),
      dataLocalizacao: tsVal || (antigo?.dataLocalizacao || null)
    };
    if(!cliente.nome) return alert('Informe o nome.');
    await idbPut('clientes', cliente);
    resetFormCliente();
    await renderListaClientes();
    toast('Cliente salvo.');
  };
  await renderListaClientes();
}
function resetFormCliente(){
  byId('cli-id').value='';
  byId('cli-nome').value='';
  byId('cli-telefone').value='';
  byId('cli-tipo').value='Residência';
  byId('cli-cidade').value='';
  byId('cli-situacao').value='Ativo';
  byId("cli-obs").value='';
  byId("cli-latitude").value='';
  byId("cli-longitude").value='';
  byId("cli-data-localizacao").value='';
  // === v8.9.3 CORREÇÃO VISUAL === Usar a função global
  if(typeof window.updateGeoStatus === 'function') {
    window.updateGeoStatus(null, null, null);
  }
  byId('cli-debito').value='R$ 0,00';
}
async function shareClienteExtrato(cliente){
  // === v5.0 ALTERAÇÃO === Nome atualizado para Dist Lírios
  const texto = `Olá ${cliente.nome}, seu saldo devedor atual na Dist Lírios é ${fmtMoney(cliente.debitoTotal||0)}.`;
  await shareTextFallback('Extrato de Débito', texto);
}
async function renderListaClientes(){
  const box = byId('lista-clientes');
  if(!box) return;
  const todos = await idbGetAll('clientes');
  
  // Atualizar contadores
  const ativos = todos.filter(c => (c.situacao||'Ativo') === 'Ativo').length;
  const inativos = todos.length - ativos;
  byId('stat-ativos').textContent = ativos;
  byId('stat-inativos').textContent = inativos;
  byId('stat-total').textContent = todos.length;

  const busca = (byId('cli-busca').value||'').toLowerCase().trim();
  const filtro = byId('cli-filtro').value;

  let filtrados = todos.filter(c => {
    // Filtro por busca
    const matchBusca = !busca || 
      (c.nome||'').toLowerCase().includes(busca) || 
      (c.telefone||'').toLowerCase().includes(busca) || 
      (c.cidade||'').toLowerCase().includes(busca);
    
    // Filtro por categoria
    let matchFiltro = true;
    if(filtro === 'Ativos') matchFiltro = (c.situacao||'Ativo') === 'Ativo';
    else if(filtro === 'Inativos') matchFiltro = (c.situacao||'Ativo') === 'Inativo';
    else if(filtro === 'Comércio') matchFiltro = (c.tipo||'Não informado') === 'Comércio';
    else if(filtro === 'Residência') matchFiltro = (c.tipo||'Não informado') === 'Residência';

    return matchBusca && matchFiltro;
  });

  // Ordem alfabética global
  filtrados.sort((a, b) => (a.nome||'').localeCompare((b.nome||''), 'pt-BR'));

  if(!filtrados.length) { box.innerHTML = '<div class="report-empty">— nenhum cliente encontrado —</div>'; return; }
  
  box.innerHTML = filtrados.map(c=>`
    <div class="list-item" style="${(c.situacao||'Ativo') === 'Inativo' ? 'opacity:0.6;background:#f3f4f6;' : ''}">
      <div class="li-main">
        <div class="li-desc">
          ${escapeHtml(c.nome)} 
          <span style="font-size:0.8em;font-weight:normal;color:#64748b;">(${escapeHtml(c.tipo||'Não informado')})</span>
        </div>
        <div class="li-meta">
          ${escapeHtml(c.telefone||'Sem tel')} ${c.cidade ? ' • ' + escapeHtml(c.cidade) : ''}
          ${(c.situacao||'Ativo') === 'Inativo' ? ' • <span style="color:#ef4444;font-weight:bold;">INATIVO</span>' : ''}
          ${c.latitude && c.longitude ? ' • <span style="color:#22c55e;font-weight:bold;">🟢 GPS</span>' : ' • <span style="color:#ef4444;font-weight:bold;">🔴 Sem GPS</span>'}
        </div>
        ${c.obs ? `<div class="li-meta" style="color:#0369a1;font-style:italic;">obs: ${escapeHtml(c.obs)}</div>` : ''}
        <div class="li-meta"><strong>Débito:</strong> ${fmtMoney(c.debitoTotal||0)}</div>
      </div>
      <div class="li-actions">
        <button class="btn-small" data-edit="${c.id}">Editar</button>
        <button class="btn-small" data-share="${c.id}">Compartilhar Extrato</button>
        <button class="btn-primary" data-pay="${c.id}">Pagar Vale</button>
        <button class="btn-secondary" data-comodato="${c.id}">Comodato/Garrafões</button>
      </div>
    </div>
  `).join('');

  box.querySelectorAll('[data-edit]').forEach(btn=> btn.onclick = async ()=> {
    const c = await idbGet('clientes', btn.dataset.edit);
    if(!c) return;
    byId('cli-id').value = c.id;
    byId('cli-nome').value = c.nome||'';
    byId('cli-telefone').value = c.telefone||'';
    byId('cli-tipo').value = c.tipo||'Não informado';
    byId('cli-cidade').value = c.cidade||'';
    byId('cli-situacao').value = c.situacao||'Ativo';
    byId('cli-obs').value = c.obs||'';
    byId("cli-debito").value = fmtMoney(c.debitoTotal||0);
    if(typeof window.updateGeoStatus === 'function') {
      window.updateGeoStatus(c.latitude, c.longitude, c.dataLocalizacao);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  box.querySelectorAll('[data-share]').forEach(btn=> btn.onclick = async ()=> {
    const c = await idbGet('clientes', btn.dataset.share);
    if(c) await shareClienteExtrato(c);
  });
  box.querySelectorAll('[data-pay]').forEach(btn=> btn.onclick = async ()=> {
    const c = await idbGet('clientes', btn.dataset.pay);
    if(!c) return;
    // Se o cliente estiver inativo, avisar mas permitir o recebimento (para limpar dívida)
    if((c.situacao||'Ativo') === 'Inativo') toast('Atenção: Cliente Inativo.');
    openModal(`Pagar Vale — ${escapeHtml(c.nome)}`, `
      <label>Valor recebido (R$)</label>
      <input type="number" id="vale-pay-valor" min="0.01" step="0.01" value="${Number(c.debitoTotal||0).toFixed(2)}">
      <label>Forma de recebimento</label>
      <select id="vale-pay-method">
        <option value="dinheiro">Dinheiro</option>
        <option value="pix">Pix</option>
      </select>
    `, async ()=> {
      const valor = Number(byId('vale-pay-valor').value||0);
      const forma = normPay(byId('vale-pay-method').value);
      if(!(valor>0)) return alert('Informe um valor maior que zero.'), false;
      if(valor > Number(c.debitoTotal||0)) return alert('O valor não pode ser maior que o débito do cliente.'), false;

      const atualizado = { ...c, id: c.id, debitoTotal: Number(c.debitoTotal||0) - valor };
      await idbPut('clientes', atualizado);

      movimentos.push({
        type:'vale_receipt',
        clientId:c.id,
        clientName:c.nome,
        value:valor,
        payMethod:forma,
        descricao:'Recebimento de Vale',
        ts:new Date().toISOString()
      });
      salvarDados();
      // === v4.7 ALTERAÇÃO === Snapshot crítico após recebimento de pagamento
      if (typeof gerarSnapshotCritico === 'function') gerarSnapshotCritico('pagamento');
      // telegramSilentDispatch(`✅ Recebimento: ${c.nome} pagou ${fmtMoney(valor)} em ${payLabel(forma)}.`); // Desativado na v8.4.1
      await renderListaClientes();
      toast('Recebimento registrado.');
      return true;
    });
  });

  box.querySelectorAll('[data-comodato]').forEach(btn => btn.onclick = () => showModalComodato(btn.dataset.comodato));
}

// === v5.5 ALTERACAO === Registra ponto de rota com logica de distancia (8 metros)
// === v7.0.1 AJUSTE === Adicionar vendaId como parametro para vincular vendas
// === v8.1 ALTERAÇÃO === registrarPontoRota: usa cadastro permanente e acoes_ponto
async function registrarPontoRota(lat, lng, tipo, vendaId = null) {
  try {
    const ponto = await encontrarOuCriarPonto(lat, lng, tipo);
    
    const acao = {
      id: String(Date.now()) + '-' + Math.random().toString(16).slice(2),
      pontoId: ponto.id,
      distribuidora: ponto.distribuidora,
      lat: lat,
      lng: lng,
      tipo: tipo,
      status: 'positivo',
      motivo: null,
      observacao: null,
      vendaId: vendaId || null,
      ts: new Date().toISOString()
    };
    
    await idbPut('acoes_ponto', acao);
    toast('Venda registrada no ponto!');
  } catch(e) {
    console.warn('[v8.1] Erro ao registrar ponto de rota:', e);
  }
}

// === v6.0 ALTERACAO === registrarVisita: registra visita sem venda com motivo
// === v8.1 ALTERACAO === registrarVisita: usa cadastro permanente e acoes_ponto
async function registrarVisita(lat, lng, tipo, motivo, observacao) {
  try {
    const ponto = await encontrarOuCriarPonto(lat, lng, tipo);
    
    const acao = {
      id: String(Date.now()) + '-' + Math.random().toString(16).slice(2),
      pontoId: ponto.id,
      distribuidora: ponto.distribuidora,
      lat: lat,
      lng: lng,
      tipo: tipo,
      status: 'visitado',
      motivo: motivo || null,
      observacao: observacao || null,
      vendaId: null,
      ts: new Date().toISOString()
    };
    
    await idbPut('acoes_ponto', acao);
    toast('Visita registrada no ponto!');
  } catch(e) {
    console.warn('[v8.1] Erro ao registrar visita:', e);
  }
}

// === v4.9 ALTERAÇÃO === showVenda: bloqueia operações se o dia já foi fechado
async function showVenda(){
  // Verifica se o dia atual já foi fechado
  if (await dijaFoiFechado()) {
    renderScreen('Registrar Venda', 'Venda com baixa automática e vínculo de cliente no Vale.', `
      <div class="card">
        <div class="card-alert" style="background:#fef9c3;border-color:#fde047;color:#713f12;font-size:1.05em;">
          ⚠️ <strong>Dia já fechado!</strong> O fechamento do dia foi realizado. Novas vendas só serão possíveis a partir de amanhã.
        </div>
      </div>
    `);
    return;
  }
  renderScreen('Registrar Venda', 'Venda com baixa automática e vínculo de cliente no Vale.', `
    <div class="card">
      <form id="form-venda" class="form-grid">
        <div>
          <label class="lbl" for="sel-prod">Produto</label>
          <select id="sel-prod" class="input-big"></select>
        </div>
        <div>
          <label class="lbl">Quantidade</label>
          <div class="qtd-box">
            <button type="button" id="qtd-menos" class="q-btn">➖</button>
            <input type="number" id="qtd-venda" min="1" value="1" required>
            <button type="button" id="qtd-mais" class="q-btn">➕</button>
          </div>
        </div>
        <div class="form-grid two">
          <div>
            <label class="lbl">Preço por unidade (R$)</label>
            <input type="number" id="preco-venda" min="0" step="0.01" value="0.00" class="input-big" required>
          </div>
          <div>
            <label class="lbl">Pagamento</label>
            <select id="pay-method" class="input-big">
              <option value="dinheiro">Dinheiro</option>
              <option value="pix">Pix</option>
              <option value="vale">Vale</option>
            </select>
          </div>
        </div>
        <div id="cliente-box">
          <label class="lbl">Cliente (obrigatório)</label>
          <select id="sel-cliente" class="input-big"></select>
        </div>
        <div>
          <label class="lbl">Descrição (opcional)</label>
          <textarea id="sale-desc" class="input-big" rows="3" placeholder="Ex.: cliente João / entrega bairro centro"></textarea>
        </div>
        <button class="btn-primary" type="submit">Registrar Venda</button>
        <button class="btn-secondary" type="button" id="btn-nao-comprou" style="margin-top:12px;background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;">Não Comprou</button>
      </form>
      <div id="venda-msg" class="stack" style="margin-top:12px;"></div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Últimas Vendas</h3>
      <div id="venda-historico" class="stack"></div>
    </div>
  `);

  const sel = byId('sel-prod');
  produtos.forEach(p=> {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.nome} (${Number(p.quantidade||0)} disponíveis)`;
    sel.appendChild(opt);
  });
  const updatePreco = ()=> {
    const p = produtos.find(x=>x.id===sel.value);
    if(p) byId('preco-venda').value = Number(p.precoUnitario||0).toFixed(2);
  };
  sel.onchange = updatePreco;
  updatePreco();

  byId('qtd-menos').onclick = ()=> {
    const q = byId('qtd-venda');
    if(Number(q.value)>1) q.value = Number(q.value)-1;
  };
  byId('qtd-mais').onclick = ()=> byId('qtd-venda').value = Number(byId('qtd-venda').value)+1;

  const paySel = byId('pay-method');
  
  // === v8.5.2 ALTERAÇÃO === Carregar clientes sempre e ordenar alfabeticamente
  const loadClientes = async () => {
    // Filtrar apenas clientes ativos para venda, mas manter ordem alfabética
    const todos = await idbGetAll('clientes');
    const clientes = todos
      .filter(c => (c.situacao||'Ativo') === 'Ativo')
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    
    byId('sel-cliente').innerHTML = `<option value="">Selecione o cliente</option>` + clientes.map(c=>`<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
  };
  loadClientes();

  paySel.onchange = async ()=> {
    if(normPay(paySel.value)==='vale') {
      byId('cliente-box').classList.remove('hidden');
    } else {
      // Manter visível conforme solicitação da V8.5 anterior, mas com lógica estável
      byId('cliente-box').classList.remove('hidden');
    }
  };

  byId('form-venda').onsubmit = async (e)=> {
    e.preventDefault();
    // === v4.9.1 CORREÇÃO === Bug 2: bloqueia venda se o dia já foi fechado
    if (await dijaFoiFechado()) {
      alert('Dia já fechado. Não é possível realizar vendas.');
      return;
    }
    const pid = sel.value;
    const qtd = parseInt(byId('qtd-venda').value, 10);
    const preco = Number(byId('preco-venda').value||0);
    const pay = normPay(paySel.value);
    const descricao = (byId('sale-desc').value||'').trim();
    const p = produtos.find(x=>x.id===pid);
    if(!p) return alert('Selecione um produto.');
    if(!(qtd>0)) return alert('Quantidade deve ser positiva.');
    if(!(preco>0)) return alert('Preço deve ser maior que zero.');
    // === v5.5 ALTERAÇÃO === Descrição agora é opcional
    if(Number(p.quantidade||0) < qtd) return alert('Estoque insuficiente.');

    // === v8.5.2 ALTERAÇÃO === Cliente obrigatório para todas as vendas
    const clienteId = byId('sel-cliente').value;
    if(!clienteId) return alert('Selecione o cliente para registrar a venda.');
    const cliente = await idbGet('clientes', clienteId);
    if(!cliente) return alert('Cliente não encontrado.');

    const total = qtd * preco;
    const prev = Number(p.quantidade||0);
    p.quantidade = prev - qtd;
    // === v7.0.1 AJUSTE === Gerar ID único para a venda para vincular ao ponto de rota
    const vendaId = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    movimentos.push({
      id: vendaId,
      type:'sale',
      productId:pid,
      qty:qtd,
      price:preco,
      total,
      payMethod:pay,
      descricao,
      clientId: cliente ? cliente.id : null,
      clientName: cliente ? cliente.nome : '',
      ts:new Date().toISOString(),
      prevQty:prev,
      newQty:p.quantidade
    });
    salvarDados();
    // === v4.7 ALTERAÇÃO === Snapshot crítico após venda finalizada
    if (typeof gerarSnapshotCritico === 'function') gerarSnapshotCritico('venda');

    if(pay === 'vale') {
      const atualizado = {
        ...cliente,
        id: cliente.id,
        debitoTotal: Number(cliente.debitoTotal||0) + total
      };
      await idbPut('clientes', atualizado);
      await idbAddValePendente({
        id: String(Date.now()),
        idCliente: cliente.id,
        nomeCliente: cliente.nome,
        valor: total,
        data: new Date().toISOString(),
        status: 'pendente'
      });
    }

    byId('venda-msg').innerHTML = `<div class="card-alert">Venda registrada: <strong>${escapeHtml(p.nome)}</strong> — ${qtd} un — Total ${fmtMoney(total)}${cliente ? `<br>Cliente: <strong>${escapeHtml(cliente.nome)}</strong>` : ''}</div>`;
    
    // === v8.8.3 ALTERAÇÃO === Removido fluxo de perguntas pós-venda
    // O cliente já é obrigatório e selecionado antes da venda.
    renderHistoricoVendas();
    showVenda();
  };

  // === v8.9.4 ALTERAÇÃO === Lógica do botão "Não Comprou"
  const btnNaoComprou = byId('btn-nao-comprou');
  if (btnNaoComprou) {
    btnNaoComprou.onclick = async () => {
      const clienteId = byId('sel-cliente').value;
      if(!clienteId) return alert('Selecione um cliente para registrar a visita.');
      
      const cliente = await idbGet('clientes', clienteId);
      if(!cliente) return alert('Cliente não encontrado.');

      const motivos = [
        'Estoque cheio',
        'Cliente sem dinheiro',
        'Cliente não estava',
        'Comprou da concorrência',
        'Estabelecimento fechado',
        'Outro'
      ];

      openModal('Motivo da Não Compra', `
        <div class="stack">
          ${motivos.map(m => `<button class="btn-secondary btn-motivo-opcao" style="width:100%;margin-bottom:8px;text-align:left;padding:12px;" data-motivo="${m}">${m}</button>`).join('')}
          <div id="box-outro-motivo" class="hidden" style="margin-top:8px;">
            <label class="lbl">Especifique o motivo / Observação</label>
            <textarea id="obs-nao-comprou" class="input-big" rows="2" placeholder="Digite aqui..."></textarea>
          </div>
        </div>
      `, async () => {
        const selectedBtn = document.querySelector('.btn-motivo-opcao.selected');
        if(!selectedBtn) { alert('Selecione um motivo.'); return false; }
        
        const motivo = selectedBtn.dataset.motivo;
        const observacao = (byId('obs-nao-comprou')?.value || '').trim();
        
        // === v9.0 CORREÇÃO === Definir distribuidoraNome no escopo correto
        const distribuidoraNome = localStorage.getItem('aguaLirios_distribuidora_nome') || 'Distribuidora nao informada';
        
        const acao = {
          id: String(Date.now()) + '-' + Math.random().toString(16).slice(2),
          pontoId: 'cliente-' + cliente.id,
          distribuidora: distribuidoraNome,
          // === v9.0 AJUSTE === Garantir nomes de campos solicitados e manter compatibilidade
          lat: cliente.latitude || null,
          lng: cliente.longitude || null,
          latitude: cliente.latitude || null,
          longitude: cliente.longitude || null,
          tipo: cliente.tipo || 'Não informado',
          status: 'visitado',
          motivo: motivo,
          observacao: observacao,
          vendaId: null,
          clientId: cliente.id,
          clientName: cliente.nome,
          ts: new Date().toISOString()
        };

        await idbPut('acoes_ponto', acao);
        toast('Visita registrada com sucesso!');
        showVenda();
        return true;
      });

      document.querySelectorAll('.btn-motivo-opcao').forEach(btn => {
        btn.onclick = () => {
          document.querySelectorAll('.btn-motivo-opcao').forEach(b => {
            b.classList.remove('selected');
            b.style.background = '';
            b.style.borderColor = '';
          });
          btn.classList.add('selected');
          btn.style.background = '#dcfce7';
          btn.style.borderColor = '#22c55e';
          byId('box-outro-motivo').classList.remove('hidden');
        };
      });
    };
  }

  renderHistoricoVendas();
}

// === v8.2 ALTERAÇÃO === Modal para tipo de ponto (Comércio/Residência)
function abrirModalTipoPonto(lat, lng, vendaId, pontoExistente) {
  openModal('Tipo de Ponto', `
    <p>Esse ponto eh:</p>
    <div style="display:flex;gap:8px;margin-top:12px;">
      <button class="btn-primary" id="btn-comercio" style="flex:1;">Comercio</button>
      <button class="btn-primary" id="btn-residencia" style="flex:1;">Residencia</button>
    </div>
  `, ()=>false);
  
  byId('btn-comercio').onclick = async ()=>{
    byId('modal').classList.add('hidden');
    if (pontoExistente) {
      await registrarAcaoPonto(pontoExistente.id, 'positivo', vendaId);
    } else {
      await registrarPontoRota(lat, lng, 'comercio', vendaId);
    }
    renderHistoricoVendas();
    showVenda();
  };
  byId('btn-residencia').onclick = async ()=>{
    byId('modal').classList.add('hidden');
    if (pontoExistente) {
      await registrarAcaoPonto(pontoExistente.id, 'positivo', vendaId);
    } else {
      await registrarPontoRota(lat, lng, 'residencia', vendaId);
    }
    renderHistoricoVendas();
    showVenda();
  };
}

// === v8.2 ALTERAÇÃO === Modal com sugestões de pontos antigos
function abrirModalSugestoesPontos(sugestoes, lat, lng, vendaId) {
  let html = `<p style="margin-bottom:12px;"><strong>Possíveis clientes próximos:</strong></p><div style="max-height:300px;overflow-y:auto;margin-bottom:12px;">`;
  
  sugestoes.forEach((s, idx) => {
    const tipo = s.ponto.tipo === 'comercio' ? 'Comércio' : 'Residência';
    const nome = s.ponto.nome || '(sem nome)';
    html += `<button class="btn-secondary" id="btn-sugestao-${idx}" style="width:100%;text-align:left;margin-bottom:6px;padding:8px;">${escapeHtml(nome)} — ${tipo} (${s.distancia}m)</button>`;
  });
  
  html += `</div><button class="btn-secondary" id="btn-nenhum" style="width:100%;">Nenhum desses</button>`;
  
  openModal('Selecione o Cliente', html, ()=>false);
  
  sugestoes.forEach((s, idx) => {
    byId(`btn-sugestao-${idx}`).onclick = async ()=>{
      byId('modal').classList.add('hidden');
      abrirModalTipoPonto(lat, lng, vendaId, s.ponto);
    };
  });
  
  byId('btn-nenhum').onclick = ()=>{
    byId('modal').classList.add('hidden');
    abrirModalTipoPonto(lat, lng, vendaId, null);
  };
}

// === v8.2 ALTERAÇÃO === Registrar ação em ponto existente
async function registrarAcaoPonto(pontoId, status, vendaId) {
  const ponto = await idbGet('pontos_cadastrados', pontoId);
  if (!ponto) return;
  
  const acao = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    pontoId: pontoId,
    distribuidora: ponto.distribuidora,
    lat: ponto.lat,
    lng: ponto.lng,
    tipo: ponto.tipo,
    status: status,
    motivo: null,
    observacao: null,
    vendaId: vendaId || null,
    ts: new Date().toISOString()
  };
  
  await idbPut('acoes_ponto', acao);
  ponto.atualizadoEm = new Date().toISOString();
  await idbPut('pontos_cadastrados', ponto);
}
// === v4.8 ALTERAÇÃO === renderHistoricoVendas: últimas 15 vendas do dia, status e botão Estornar
function renderHistoricoVendas(){
  const box = byId('venda-historico');
  if(!box) return;
  const hoje = new Date().toISOString();
  // Mostra últimas 15 vendas do dia (mais recentes primeiro)
  const ult = movimentos
    .filter(m => m.type === 'sale' && sameDayISO(m.ts, hoje))
    .slice().reverse()
    .slice(0, 15);
  if(!ult.length) { box.innerHTML = '<div class="report-empty">— nenhuma venda hoje —</div>'; return; }
  box.innerHTML = ult.map(v => {
    const p = produtos.find(x => x.id === v.productId) || {nome: '-'};
    const total = v.total || ((v.qty||0) * (v.price||0));
    const estornada = !!v.estornada;
    const statusBadge = estornada
      ? `<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:12px;font-size:0.78em;font-weight:700;margin-left:6px;">ESTORNADA</span>`
      : `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:12px;font-size:0.78em;font-weight:700;margin-left:6px;">NORMAL</span>`;
    const btnEstorno = estornada
      ? `<button class="btn-danger" disabled style="opacity:0.45;cursor:not-allowed;">Já estornada</button>`
      : `<button class="btn-danger" data-estornar="${escapeHtml(v.ts)}">Estornar</button>`;
    // === v8.5.2 ALTERAÇÃO === Cliente sempre visível no histórico
    const clientInfo = `<div class="li-meta">Cliente: <strong>${escapeHtml(v.clientName || 'Não informado')}</strong></div>`;
    return `
      <div class="list-item" style="flex-direction:column;align-items:flex-start;gap:4px;${estornada ? 'opacity:0.6;' : ''}">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;width:100%;">
          <strong>${escapeHtml(p.nome)}</strong>${statusBadge}
        </div>
        <div class="li-meta">${new Date(v.ts).toLocaleString()} &mdash; ${v.qty} un &mdash; ${fmtMoney(total)} <span class="muted">(${payLabel(v.payMethod)})</span></div>
        ${clientInfo}
        ${v.descricao ? `<div class="li-meta">Descrição: ${escapeHtml(v.descricao)}</div>` : ''}
        <div style="margin-top:4px;">${btnEstorno}</div>
      </div>`;
  }).join('');
  // Bind dos botões de estorno
  box.querySelectorAll('[data-estornar]').forEach(btn => {
    btn.onclick = () => abrirEstorno(btn.dataset.estornar);
  });
}

// === v4.8 ALTERAÇÃO === abrirEstorno: abre modal com campo de motivo obrigatório
// === v4.9.1 CORREÇÃO === Bug 3: bloqueia estorno se o dia já foi fechado
async function abrirEstorno(vendaTs) {
  // Verifica fechamento antes de qualquer ação
  if (await dijaFoiFechado()) {
    alert('Dia já fechado. Estorno não permitido.');
    return;
  }
  // Localiza a venda pelo timestamp (identificador único)
  const venda = movimentos.find(m => m.type === 'sale' && m.ts === vendaTs);
  if (!venda) { alert('Venda não encontrada.'); return; }
  if (venda.estornada) { alert('Esta venda já foi estornada.'); return; }
  const p = produtos.find(x => x.id === venda.productId) || { nome: '-' };
  const total = venda.total || ((venda.qty||0) * (venda.price||0));
  openModal(
    'Estornar Venda',
    `<div style="margin-bottom:10px;">
      <strong>${escapeHtml(p.nome)}</strong> &mdash; ${venda.qty} un &mdash; ${fmtMoney(total)}
      <span class="muted">(${payLabel(venda.payMethod)})</span>
      ${venda.clientName ? `<br>Cliente: <strong>${escapeHtml(venda.clientName)}</strong>` : ''}
    </div>
    <label class="lbl">Motivo do estorno (obrigatório)</label>
    <textarea id="estorno-motivo" class="input-big" rows="3" placeholder="Informe o motivo do estorno..."></textarea>`,
    async () => {
      const motivo = (byId('estorno-motivo').value || '').trim();
      if (!motivo) { alert('Informe o motivo do estorno.'); return false; }
      await executarEstorno(venda, motivo);
      return true;
    }
  );
}

// === v4.8 ALTERAÇÃO === executarEstorno: lógica completa de estorno
async function executarEstorno(venda, motivo) {
  const p = produtos.find(x => x.id === venda.productId);
  const total = venda.total || ((venda.qty||0) * (venda.price||0));

  // 1. Marcar venda original como estornada (NÃO apaga)
  venda.estornada = true;
  venda.estornoMotivo = motivo;
  venda.estornoTs = new Date().toISOString();

  // 2. Criar movimento de estorno
  movimentos.push({
    type: 'estorno',
    productId: venda.productId,
    qty: venda.qty,
    price: venda.price || 0,
    total,
    payMethod: venda.payMethod,
    motivo,
    refId: venda.ts,
    clientId: venda.clientId || null,
    clientName: venda.clientName || '',
    ts: new Date().toISOString()
  });

  // 3. Devolver estoque
  if (p) {
    p.quantidade = Number(p.quantidade || 0) + Number(venda.qty || 0);
  }

  // 4. Ajustar débito do cliente (se Vale)
  if (venda.payMethod === 'vale' && venda.clientId) {
    try {
      const cliente = await idbGet('clientes', venda.clientId);
      if (cliente) {
        const novoDebito = Math.max(0, Number(cliente.debitoTotal || 0) - total);
        await idbPut('clientes', { ...cliente, id: cliente.id, debitoTotal: novoDebito });
      }
    } catch (e) {
      console.warn('[v4.8] Falha ao ajustar débito do cliente no estorno:', e);
    }
  }

  // 5. Salvar tudo
  salvarDados();

  // 6. Snapshot de backup
  if (typeof gerarSnapshotCritico === 'function') gerarSnapshotCritico('estorno');

  // 7. Notificar via Telegram (silencioso)
  // const nomeProd = p ? p.nome : (venda.productId || '-');
  // telegramSilentDispatch(
  //   `⚠️ Estorno realizado:\n${venda.qty}x ${nomeProd}\nMotivo: ${motivo}`
  // ); // Desativado na v8.4.1

  // 8. Atualizar tela
  toast('Estorno realizado com sucesso!');
  renderHistoricoVendas();
  // Atualiza estoque se a tela estiver visível
  if (byId('lista-produtos')) renderEstoque();
}

function statusClass(qtd, min){ if(qtd<=0) return 'status-zero'; if(qtd<=min) return 'status-low'; return 'status-ok'; }

// === v6.0 ALTERACAO === showRegistroVisita: novo fluxo para registrar visita sem venda
async function showRegistroVisita(){
  if (await dijaFoiFechado()) {
    renderScreen('Registro de Visita', 'Registrar visita sem venda', `
      <div class="card">
        <div class="card-alert" style="background:#fef9c3;border-color:#fde047;color:#713f12;font-size:1.05em;">
          \u26a0\ufe0f <strong>Dia ja fechado!</strong> O fechamento do dia foi realizado. Novas visitas so serao possiveis a partir de amanha.
        </div>
      </div>
    `);
    return;
  }
  try {
    const geo = await obterGeolocalizacao();
    const tipo = await new Promise((resolve) => {
      renderScreen('Registro de Visita', 'Qual e o tipo de ponto?', `
        <div class="card">
          <div class="stack">
            <button class="btn-secondary" style="padding:12px;font-size:1.1em;" id="btn-tipo-comercio">Comercio</button>
            <button class="btn-secondary" style="padding:12px;font-size:1.1em;" id="btn-tipo-residencia">Residencia</button>
          </div>
        </div>
      `);
      byId('btn-tipo-comercio').onclick = () => resolve('comercio');
      byId('btn-tipo-residencia').onclick = () => resolve('residencia');
    });
    const motivo = await new Promise((resolve) => {
      renderScreen('Registro de Visita', 'Qual foi o motivo da nao compra?', `
        <div class="card">
          <div class="stack">
            <button class="btn-secondary" style="padding:12px;font-size:1.1em;" id="btn-motivo-nao-quis">Nao quis comprar</button>
            <button class="btn-secondary" style="padding:12px;font-size:1.1em;" id="btn-motivo-estoque">Ja tem estoque</button>
            <button class="btn-secondary" style="padding:12px;font-size:1.1em;" id="btn-motivo-preco">Preco</button>
            <button class="btn-secondary" style="padding:12px;font-size:1.1em;" id="btn-motivo-outro">Outro</button>
          </div>
        </div>
      `);
      byId('btn-motivo-nao-quis').onclick = () => resolve('Nao quis comprar');
      byId('btn-motivo-estoque').onclick = () => resolve('Ja tem estoque');
      byId('btn-motivo-preco').onclick = () => resolve('Preco');
      byId('btn-motivo-outro').onclick = () => resolve('Outro');
    });
    renderScreen('Registro de Visita', 'Observacao (opcional)', `
      <div class="card">
        <div class="form-grid">
          <textarea id="obs-visita" class="input-big" placeholder="Digite uma observacao opcional..." style="height:100px;resize:vertical;"></textarea>
        </div>
        <div class="form-grid" style="margin-top:12px;">
          <button id="btn-confirmar-visita" class="btn-primary" style="width:100%;">Confirmar Visita</button>
        </div>
      </div>
    `);
    byId('btn-confirmar-visita').onclick = async () => {
      const observacao = byId('obs-visita').value.trim() || null;
      await registrarVisita(geo.lat, geo.lng, tipo, motivo, observacao);
      toast('Visita registrada com sucesso!');
      showHome();
    };
  } catch(e) {
    toast('Erro ao obter geolocalizacao: ' + (e.message || 'Desconhecido'));
    console.warn('[v6.0] Erro em showRegistroVisita:', e);
  }
}

function showEstoque(){
  renderScreen('Estoque', 'Entrada, saída e atualização de preço.', `
    <div class="card"><div id="lista-produtos" class="stack"></div></div>
  `);
  renderEstoque();
}
function renderEstoque(){
  const box = byId('lista-produtos');
  box.innerHTML = produtos.map(p=>`
    <div class="produto-card">
      <div class="produto-info">
        <h3 class="${statusClass(Number(p.quantidade||0), Number(p.estoqueMinimo||0))}">${escapeHtml(p.nome)}</h3>
        <p><strong>Estoque:</strong> ${Number(p.quantidade||0)} un</p>
        <p><strong>Preço:</strong> ${fmtMoney(p.precoUnitario||0)}</p>
      </div>
      <div class="produto-acoes">
        <button class="btn-small" data-entrada="${p.id}">Entrada</button>
        <button class="btn-small" data-saida="${p.id}">Saída</button>
        <button class="btn-small" data-preco="${p.id}">Preço</button>
      </div>
    </div>
  `).join('');
  box.querySelectorAll('[data-entrada]').forEach(b=>b.onclick=()=>abrirEntrada(b.dataset.entrada));
  box.querySelectorAll('[data-saida]').forEach(b=>b.onclick=()=>abrirSaida(b.dataset.saida));
  box.querySelectorAll('[data-preco]').forEach(b=>b.onclick=()=>abrirPreco(b.dataset.preco));
}
function abrirEntrada(id){
  const p = produtos.find(x=>x.id===id);
  openModal('Entrada — ' + p.nome, `
    <label>Quantidade recebida</label>
    <input type="number" id="in-qtd" min="1" value="1">
    <label>Observação</label>
    <textarea id="in-obs" rows="3" placeholder="Ex.: recebimento"></textarea>
  `, ()=> {
    const qtd = parseInt(byId('in-qtd').value, 10);
    if(!(qtd>0)) return alert('Quantidade deve ser positiva.'), false;
    const prev = Number(p.quantidade||0);
    p.quantidade = prev + qtd;
    movimentos.push({ type:'entry', productId:id, qty:qtd, obs:(byId('in-obs').value||'').trim(), ts:new Date().toISOString(), prevQty:prev, newQty:p.quantidade });
    salvarDados();
    // === v4.7 ALTERAÇÃO === Snapshot crítico após entrada de estoque
    if (typeof gerarSnapshotCritico === 'function') gerarSnapshotCritico('estoque_entrada');
    // === v8.4 ALTERAÇÃO === Desativar envio individual de Telegram
    // telegramSilentDispatch(`📦 Entrada: ${p.nome} - Qtd: ${qtd}.`);
    renderEstoque();
    return true;
  });
}
function abrirSaida(id){
  const p = produtos.find(x=>x.id===id);
  openModal('Saída — ' + p.nome, `
    <label>Quantidade da saída</label>
    <input type="number" id="out-qtd" min="1" value="1">
    <label>Descrição</label>
    <textarea id="out-obs" rows="3" placeholder="Ex.: quebra, uso interno, troca cliente"></textarea>
  `, ()=> {
    const qtd = parseInt(byId('out-qtd').value, 10);
    const desc = (byId('out-obs').value||'').trim();
    if(!(qtd>0)) return alert('Quantidade deve ser positiva.'), false;
    if(!desc) return alert('Informe a descrição.'), false;
    if(Number(p.quantidade||0) < qtd) return alert('Estoque insuficiente.'), false;
    const prev = Number(p.quantidade||0);
    p.quantidade = prev - qtd;
    movimentos.push({ type:'out', productId:id, qty:qtd, obs:desc, ts:new Date().toISOString(), prevQty:prev, newQty:p.quantidade });
    salvarDados();
    // === v4.7 ALTERAÇÃO === Snapshot crítico após saída de estoque
    if (typeof gerarSnapshotCritico === 'function') gerarSnapshotCritico('estoque_saida');
    renderEstoque();
    return true;
  });
}
function abrirPreco(id){
  const p = produtos.find(x=>x.id===id);
  openModal('Preço — ' + p.nome, `
    <label>Novo preço unitário (R$)</label>
    <input type="number" id="pr-novo" min="0" step="0.01" value="${Number(p.precoUnitario||0).toFixed(2)}">
  `, ()=> {
    const novo = Number(byId('pr-novo').value||0);
    if(novo < 0) return alert('Preço inválido.'), false;
    p.precoUnitario = novo;
    salvarDados();
    renderEstoque();
    return true;
  });
}

function showCustos(){
  renderScreen('Custos', 'Registro de despesas do dia.', `
    <div class="card">
      <form id="form-custo" class="form-grid">
        <div><label class="lbl">Valor (R$)</label><input id="custo-valor" type="number" min="0" step="0.01" class="input-big" required></div>
        <div><label class="lbl">Descrição</label><textarea id="custo-desc" class="input-big" rows="3" required></textarea></div>
        <button class="btn-primary" type="submit">Registrar Custo</button>
      </form>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Custos de hoje</h3>
      <div id="custos-dia" class="stack"></div>
    </div>
  `);
  byId('form-custo').onsubmit = (e)=> {
    e.preventDefault();
    const valor = Number(byId('custo-valor').value||0);
    const descricao = (byId('custo-desc').value||'').trim();
    if(!(valor>0)) return alert('Informe um valor maior que zero.');
    if(!descricao) return alert('Informe a descrição.');
    custos.unshift({id:String(Date.now()), valor, descricao, ts:new Date().toISOString()});
    salvarDados();
    // === v4.7 ALTERAÇÃO === Snapshot crítico após lançamento de custo
    if (typeof gerarSnapshotCritico === 'function') gerarSnapshotCritico('custo');
    // === v8.4 ALTERAÇÃO === Desativar envio individual de Telegram
    // telegramSilentDispatch(`💸 Custo: ${descricao} - ${fmtMoney(valor)}.`);
    byId('custo-valor').value=''; byId('custo-desc').value='';
    renderCustosDia();
  };
  renderCustosDia();
}
function renderCustosDia(){
  const box = byId('custos-dia');
  const hoje = new Date().toISOString();
  const lista = custos.filter(c=>sameDayISO(c.ts, hoje));
  box.innerHTML = !lista.length ? '<div class="report-empty">— nenhum registro —</div>' : lista.map(c=>`
    <div class="list-item">
      <div class="li-main">
        <div class="li-desc">${escapeHtml(c.descricao)}</div>
        <div class="li-meta">${new Date(c.ts).toLocaleString()}</div>
      </div>
      <div class="li-actions">
        <div class="badge-money">${fmtMoney(c.valor)}</div>
        <button class="btn-danger" data-del="${c.id}">Excluir</button>
      </div>
    </div>
  `).join('');
  box.querySelectorAll('[data-del]').forEach(btn=> btn.onclick = ()=> {
    if(!confirm('Excluir este custo?')) return;
    custos = custos.filter(c=>c.id!==btn.dataset.del);
    salvarDados();
    renderCustosDia();
  });
}


async function exportData(){
  if (typeof window.exportarBackupCompleto === 'function') {
    await window.exportarBackupCompleto();
    toast('Backup exportado.');
  } else {
    toast('Erro: Módulo de backup não inicializado.');
  }
}

async function importData(){
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async (e)=>{
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    try{
      const text = await file.text();
      const data = JSON.parse(text);
      
      // Validação básica de estrutura
      const metadata = data.metadata || {};
      const resumo = `
        Distribuidora: ${metadata.distribuidora || 'Desconhecida'}
        Data do Backup: ${metadata.geradoEm ? new Date(metadata.geradoEm).toLocaleString() : 'Desconhecida'}
        Versão do Banco: ${metadata.dbVersion || '?'}
        
        Itens a restaurar:
        - Clientes: ${Array.isArray(data.clientes || (data.indexedDB && data.indexedDB.clientes)) ? 'Sim' : 'Não'}
        - Vendas/Movimentos: ${Array.isArray(data.movimentos || (data.localStorage && data.localStorage.aguaLirios_movs)) ? 'Sim' : 'Não'}
        - Configurações: Sim
      `;

      if(!confirm(`Deseja restaurar este backup?\n${resumo}\n\nATENÇÃO: Isso sobrescreverá os dados atuais!`)) return;
      
      if (typeof window.restaurarBackupIntegral !== 'function') {
        throw new Error('Módulo de backup não disponível.');
      }

      const resultado = await window.restaurarBackupIntegral(data);
      
      let msg = 'Restauração concluída!\n\n';
      msg += `- LocalStorage: ${resultado.localStorage.restaurados}/${resultado.localStorage.total} chaves\n`;
      msg += `- IndexedDB: ${resultado.indexedDB.restaurados}/${resultado.indexedDB.total} stores\n\n`;
      if (resultado.detalhes.length > 0) {
        msg += 'Detalhes:\n' + resultado.detalhes.join('\n');
      }

      alert(msg);
      window.location.reload(); // Recarrega para aplicar mudanças no LocalStorage
    }catch(err){
      console.error(err);
      alert('Falha ao importar o arquivo: ' + err.message);
    }
  };
  input.click();
}

// === v8.9.6 ALTERAÇÃO === Mapa Inteligente baseado em Clientes com GPS
async function showMapa(){
  renderScreen('Mapa / Prospecção', 'Visualize a rota baseada nos clientes cadastrados.', `
    <div class="card">
      <div id="mapa-stats" style="display:flex;justify-content:space-around;text-align:center;font-size:0.9em;font-weight:bold;color:#475569;margin-bottom:12px;">
        <div>Com GPS: <span id="map-stat-gps">0</span></div>
        <div>Sem GPS: <span id="map-stat-nogps">0</span></div>
      </div>
      
      <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;">
        <button id="btn-map-periodo-hoje" class="btn-primary" style="flex:1;min-width:80px;font-size:0.85em;">Hoje</button>
        <button id="btn-map-periodo-7dias" class="btn-secondary" style="flex:1;min-width:80px;font-size:0.85em;">7 Dias</button>
        <button id="btn-map-periodo-todos" class="btn-secondary" style="flex:1;min-width:80px;font-size:0.85em;">Todos</button>
      </div>

      <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;">
        <button id="btn-map-filtro-todos" class="btn-secondary" style="flex:1;min-width:80px;background:#f1f5f9;font-size:0.85em;">Todos Status</button>
        <button id="btn-map-filtro-azul" class="btn-secondary" style="flex:1;min-width:80px;color:#1d4ed8;font-size:0.85em;">Não Atendidos</button>
        <button id="btn-map-filtro-verde" class="btn-secondary" style="flex:1;min-width:80px;color:#15803d;font-size:0.85em;">Compraram</button>
        <button id="btn-map-filtro-vermelho" class="btn-secondary" style="flex:1;min-width:80px;color:#b91c1c;font-size:0.85em;">Não Compraram</button>
      </div>

      <div id="mapa-legenda" style="margin-bottom:12px;font-size:0.85em;display:flex;flex-wrap:wrap;gap:10px;justify-content:center;background:#f8fafc;padding:8px;border-radius:6px;">
        <div style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:10px;height:10px;background:#3b82f6;border-radius:50%;"></span> Não Atendido</div>
        <div style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:10px;height:10px;background:#22c55e;border-radius:50%;"></span> Comprou</div>
        <div style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:10px;height:10px;background:#ef4444;border-radius:50%;"></span> Não Comprou</div>
      </div>

      <div id="mapa-container" style="width:100%;height:450px;border:1px solid #ddd;border-radius:8px;background:#f5f5f5;display:flex;align-items:center;justify-content:center;color:#999;">
        Carregando mapa...
      </div>
      
      <div id="lista-sem-gps" class="hidden" style="margin-top:12px;padding:10px;background:#fff1f2;border-radius:8px;border:1px solid #fecaca;">
        <h4 style="margin:0 0 8px 0;color:#991b1b;font-size:0.9em;">Clientes Ativos Sem GPS:</h4>
        <div id="cli-nogps-list" style="font-size:0.85em;color:#7f1d1d;max-height:100px;overflow-y:auto;"></div>
      </div>
    </div>
  `);

  if (typeof L === 'undefined') {
    console.warn('[v8.9.6] Leaflet nao disponivel, aguardando...');
    setTimeout(showMapa, 500);
    return;
  }

  const todosClientes = await idbGetAll('clientes');
  const acoesPonto = await idbGetAll('acoes_ponto');
  const hojeStr = new Date().toISOString().slice(0, 10);
  
  // Clientes ativos
  const ativos = todosClientes.filter(c => (c.situacao||'Ativo') === 'Ativo');
  const comGps = ativos.filter(c => c.latitude && c.longitude);
  const semGps = ativos.filter(c => !c.latitude || !c.longitude);

  // Atualizar stats
  byId('map-stat-gps').textContent = comGps.length;
  byId('map-stat-nogps').textContent = semGps.length;

  // Lista de sem GPS
  if(semGps.length > 0) {
    byId('lista-sem-gps').classList.remove('hidden');
    semGps.sort((a,b) => (a.nome||'').localeCompare(b.nome||'', 'pt-BR'));
    byId('cli-nogps-list').innerHTML = semGps.map(c => escapeHtml(c.nome)).join(', ');
  }

  let filtroCor = 'todos'; // todos, azul, verde, vermelho
  let filtroPeriodo = 'hoje'; // hoje, 7dias, todos

  function renderizarMapa() {
    const container = byId('mapa-container');
    if(!container) return;
    container.innerHTML = '';
    
    const agora = new Date();
    const hojeInicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
    const seteDiasInicio = hojeInicio - (7 * 24 * 60 * 60 * 1000);

    // Filtro por cor e período
    let paraExibir = comGps.map(c => {
      let vendas = movimentos.filter(m => m.type === 'sale' && m.clientId === c.id && !m.estornada);
      let visitas = acoesPonto.filter(a => a.status === 'visitado' && a.clientId === c.id);

      if (filtroPeriodo === 'hoje') {
        vendas = vendas.filter(m => new Date(m.ts).getTime() >= hojeInicio);
        visitas = visitas.filter(a => new Date(a.ts).getTime() >= hojeInicio);
      } else if (filtroPeriodo === '7dias') {
        vendas = vendas.filter(m => new Date(m.ts).getTime() >= seteDiasInicio);
        visitas = visitas.filter(a => new Date(a.ts).getTime() >= seteDiasInicio);
      }

      let cor = '#3b82f6'; // Azul padrão
      let status = filtroPeriodo === 'hoje' ? 'Ainda não atendido hoje' : 'Sem ação no período';
      let infoExtra = '';

      if (vendas.length > 0) {
        cor = '#22c55e'; // Verde
        status = 'Comprou no período';
        const totalQtd = vendas.reduce((acc, v) => acc + (v.qty || 0), 0);
        const ultimaData = new Date(vendas[vendas.length-1].ts).toLocaleString('pt-BR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
        infoExtra = `<br>Última venda: ${ultimaData}<br>Total itens: ${totalQtd}`;
      } else if (visitas.length > 0) {
        cor = '#ef4444'; // Vermelho
        status = 'Visitado — Não comprou';
        const ultima = visitas[visitas.length-1];
        const data = new Date(ultima.ts).toLocaleString('pt-BR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
        infoExtra = `<br>Motivo: ${ultima.motivo || 'Não informado'}<br>Data: ${data}`;
        if(ultima.observacao) infoExtra += `<br>Obs: ${ultima.observacao}`;
      }

      return { ...c, cor, status, infoExtra };
    });

    if (filtroCor === 'azul') paraExibir = paraExibir.filter(c => c.cor === '#3b82f6');
    else if (filtroCor === 'verde') paraExibir = paraExibir.filter(c => c.cor === '#22c55e');
    else if (filtroCor === 'vermelho') paraExibir = paraExibir.filter(c => c.cor === '#ef4444');

    if (paraExibir.length === 0) {
      container.innerHTML = '<div style="color:#999; text-align:center; padding-top:200px;">Nenhum cliente para exibir com este filtro</div>';
      return;
    }

    const mapa = L.map(container).setView([-15.7975, -47.8919], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(mapa);

    paraExibir.forEach(c => {
      const marker = L.circleMarker([c.latitude, c.longitude], {
        radius: 9, 
        fillColor: c.cor, 
        color: '#fff', 
        weight: 2, 
        opacity: 1, 
        fillOpacity: 0.9
      }).addTo(mapa);

      let popupContent = `
        <div style="font-family:sans-serif; min-width:150px;">
          <strong style="font-size:1.1em;">${escapeHtml(c.nome)}</strong><br>
          <span style="color:#64748b;font-size:0.9em;">${escapeHtml(c.tipo || 'Residência')} • ${escapeHtml(c.cidade || '')}</span><br>
          <hr style="margin:8px 0; border:0; border-top:1px solid #eee;">
          <strong style="color:${c.cor}">${c.status}</strong>
          ${c.infoExtra}
        </div>
      `;
      marker.bindPopup(popupContent);
    });

    if (paraExibir.length > 0) {
      const bounds = L.latLngBounds(paraExibir.map(c => [c.latitude, c.longitude]));
      mapa.fitBounds(bounds, { padding: [40, 40] });
    }
  }

  const updatePeriodBtns = () => {
    ['hoje', '7dias', 'todos'].forEach(p => {
      const btn = byId('btn-map-periodo-' + p);
      if(btn) {
        btn.className = filtroPeriodo === p ? 'btn-primary' : 'btn-secondary';
        btn.style.flex = '1';
        btn.style.minWidth = '80px';
        btn.style.fontSize = '0.85em';
      }
    });
  };

  byId('btn-map-periodo-hoje').onclick = () => { filtroPeriodo = 'hoje'; updatePeriodBtns(); renderizarMapa(); };
  byId('btn-map-periodo-7dias').onclick = () => { filtroPeriodo = '7dias'; updatePeriodBtns(); renderizarMapa(); };
  byId('btn-map-periodo-todos').onclick = () => { filtroPeriodo = 'todos'; updatePeriodBtns(); renderizarMapa(); };

  byId('btn-map-filtro-todos').onclick = () => { filtroCor = 'todos'; renderizarMapa(); };
  byId('btn-map-filtro-azul').onclick = () => { filtroCor = 'azul'; renderizarMapa(); };
  byId('btn-map-filtro-verde').onclick = () => { filtroCor = 'verde'; renderizarMapa(); };
  byId('btn-map-filtro-vermelho').onclick = () => { filtroCor = 'vermelho'; renderizarMapa(); };

  updatePeriodBtns();
  renderizarMapa();
}

function showConfiguracoes(){
  const distribuidoraNome = localStorage.getItem('aguaLirios_distribuidora_nome') || 'Distribuidora nao informada';
  renderScreen('Configurações', 'Telegram, backup e restauração de dados.', `
    <!-- === v7.0 ALTERACAO === Campo de Nome da Distribuidora -->
    <div class="card">
      <div class="form-grid">
        <label style="font-weight:600;margin-bottom:4px;display:block;">Nome da Distribuidora / Rota</label>
        <input id="input-distribuidora" type="text" class="input-big" placeholder="Ex: Distribuidora Marco" value="${escapeHtml(distribuidoraNome)}" style="margin-bottom:8px;">
        <button id="btn-salvar-distribuidora" class="btn-primary" style="width:100%;">Salvar Nome da Distribuidora</button>
      </div>
    </div>
    <div class="card">
      <div class="stack">
        <button id="btn-open-tg" class="btn-secondary">Config. Telegram</button>
        
        <!-- === v9.3 ADIÇÃO === Transferência de Clientes -->
        <hr style="margin:8px 0;border-color:#e5e7eb;">
        <div style="font-weight:bold; color:#1e293b; margin-bottom:4px;">TRANSFERÊNCIA DE CLIENTES</div>
        <div class="grid-2">
          <button id="btn-transfer-export" class="btn-primary" style="font-size:0.9em;">Exportar Cliente</button>
          <button id="btn-transfer-import" class="btn-primary" style="font-size:0.9em;">Importar Cliente</button>
        </div>
        <div class="card-alert" style="font-size:0.85em;">Use para mover cadastros entre rotas (preserva GPS).</div>
        
        <hr style="margin:8px 0;border-color:#e5e7eb;">
        <button id="btn-export-data" class="btn-primary">Exportar Dados (Backup)</button>
        <button id="btn-import-data" class="btn-primary">Importar Dados (Restaurar)</button>
        <div class="card-alert">O backup inclui produtos, movimentos, custos, configurações, clientes e vales pendentes.</div>
        <!-- === v4.7 ALTERAÇÃO === Botões de AutoBackup Inteligente -->
        <hr style="margin:8px 0;border-color:#e5e7eb;">
        <div class="card-alert" style="background:#eff6ff;border-color:#bfdbfe;"><strong>🛡️ AutoBackup v4.7</strong> — Backups automáticos ativos</div>
        <button id="btn-backup-agora" class="btn-secondary">Gerar Backup Completo Agora</button>
        <button id="btn-export-backup" class="btn-secondary">Exportar Backup Completo (.json)</button>
        <button id="btn-listar-backups" class="btn-secondary">Ver Backups Salvos</button>
      </div>
    </div>
    <div id="area-backups" class="card" style="display:none;">
      <h3 style="margin-top:0">Backups Disponíveis</h3>
      <div id="lista-backups" class="stack"></div>
    </div>
  `);
  // === v7.0 ALTERACAO === Handler para salvar nome da distribuidora
  byId('btn-salvar-distribuidora').onclick = () => {
    const nome = byId('input-distribuidora').value.trim() || 'Distribuidora nao informada';
    localStorage.setItem('aguaLirios_distribuidora_nome', nome);
    toast('Nome da distribuidora salvo com sucesso!');
  };
  byId('btn-open-tg').onclick = openTelegramConfigProtected;
  // === v9.3 ADIÇÃO === Handlers de Transferência
  byId('btn-transfer-export').onclick = showExportarClientesTransferencia;
  byId('btn-transfer-import').onclick = showImportarClientesTransferencia;
  
  byId('btn-export-data').onclick = exportData;
  byId('btn-import-data').onclick = importData;
  // === v4.7 ALTERAÇÃO === Handlers dos botões de AutoBackup
  byId('btn-backup-agora').onclick = async ()=> {
    if (typeof gerarBackupCompletoDia === 'function') {
      await gerarBackupCompletoDia();
      toast('Backup completo gerado!');
    }
  };
  byId('btn-export-backup').onclick = async ()=> {
    if (typeof exportarBackupCompleto === 'function') {
      await exportarBackupCompleto();
      toast('Backup exportado!');
    }
  };
  byId('btn-listar-backups').onclick = async ()=> {
    const area = byId('area-backups');
    const lista = byId('lista-backups');
    area.style.display = 'block';
    if (typeof listarBackups === 'function') {
      const { snapshots, diarios } = await listarBackups();
      const todos = [
        ...diarios.map(b=>({...b, label:`📅 Diário: ${b.data}`, tipo:'diario'})),
        ...snapshots.slice(0,10).map(b=>({...b, label:`⚡ ${b.tipo==='automatico'?'Auto':'Crítico'}: ${b.origem} — ${new Date(b.ts).toLocaleString()}`, tipo:'snapshot'}))
      ];
      if(!todos.length) { lista.innerHTML = '<div class="report-empty">— nenhum backup salvo —</div>'; return; }
      lista.innerHTML = todos.map(b=>`
        <div class="list-item">
          <div class="li-main"><div class="li-desc">${escapeHtml(b.label)}</div></div>
          <div class="li-actions"><button class="btn-small" data-restore="${escapeHtml(b.id)}">Restaurar</button></div>
        </div>
      `).join('');
      lista.querySelectorAll('[data-restore]').forEach(btn=>btn.onclick=async()=>{
        if(!confirm('Restaurar este backup? Os dados atuais serão sobrescritos.')) return;
        const ok = await restaurarBackup(btn.dataset.restore);
        if(ok) { toast('Backup restaurado! Recarregue a página.'); location.reload(); }
        else toast('Falha ao restaurar backup.');
      });
    }
  };
}

// === v8.4.1 ALTERAÇÃO === showModalComodato: gestão de comodato (garrafões)
async function showModalComodato(clientId) {
  const c = await idbGet('clientes', clientId);
  if(!c) return;
  
  // Se o cliente estiver inativo, avisar mas permitir comodato (para devoluções)
  if((c.situacao||'Ativo') === 'Inativo') toast('Atenção: Cliente Inativo.');

  openModal(`Comodato — ${escapeHtml(c.nome)}`, `
    <div class="stack">
      <div class="card-alert" style="background:#f0f9ff;border-color:#bae6fd;color:#0369a1;">
        Saldo Atual: <strong>${Number(c.garrafoesEmprestados || 0)}</strong> garrafões emprestados.
      </div>
      
      <div class="form-grid">
        <label>Operação</label>
        <select id="comodato-operacao" class="input-big">
          <option value="emprestimo">Empréstimo (Sair do Caminhão)</option>
          <option value="devolucao">Devolução (Voltar para o Caminhão)</option>
        </select>
        
        <label>Tipo de Garrafão</label>
        <select id="comodato-tipo" class="input-big">
          <option value="p8">PP 20L (Vazio)</option>
          <option value="p9">PET 20L (Vazio)</option>
          <option value="p10">PET 10L (Vazio)</option>
        </select>
        
        <label>Quantidade</label>
        <input type="number" id="comodato-qtd" class="input-big" min="1" value="1">
      </div>
    </div>
  `, async () => {
    const operacao = byId('comodato-operacao').value;
    const tipoId = byId('comodato-tipo').value;
    const qtd = Number(byId('comodato-qtd').value || 0);
    
    if(!(qtd > 0)) return alert('Informe uma quantidade válida.'), false;
    
    const p = produtos.find(x => x.id === tipoId);
    if(!p) return alert('Tipo de garrafão não encontrado no estoque.'), false;
    
    if(operacao === 'emprestimo') {
      if(Number(p.quantidade || 0) < qtd) {
        if(!confirm(`Estoque insuficiente (${p.quantidade} un). Continuar mesmo assim?`)) return false;
      }
      p.quantidade = Number(p.quantidade || 0) - qtd;
      c.garrafoesEmprestados = Number(c.garrafoesEmprestados || 0) + qtd;
    } else {
      p.quantidade = Number(p.quantidade || 0) + qtd;
      c.garrafoesEmprestados = Math.max(0, Number(c.garrafoesEmprestados || 0) - qtd);
    }
    
    await idbPut('clientes', c);
    
    const mov = {
      id: String(Date.now()),
      clientId: c.id,
      clientName: c.nome,
      type: operacao,
      productId: p.id,
      productName: p.nome,
      qty: qtd,
      ts: new Date().toISOString()
    };
    
    await idbPut('comodato_movimentos', mov);
    salvarDados();
    
    // Snapshot crítico após comodato
    if (typeof gerarSnapshotCritico === 'function') gerarSnapshotCritico('comodato');
    
    await renderListaClientes();
    toast(`${operacao === 'emprestimo' ? 'Empréstimo' : 'Devolução'} registrado.`);
    return true;
  });
}

// === v9.6 ALTERAÇÃO === Posição atual de comodatos, compartilhada pelos relatórios
async function obterPosicaoAtualComodatos() {
  const [clientes, comodatoMovimentos] = await Promise.all([
    idbGetAll('clientes'),
    idbGetAll('comodato_movimentos')
  ]);
  const porCliente = new Map();

  comodatoMovimentos.forEach(m => {
    const clienteId = String(m.clientId);
    const produtoId = String(m.productId || 'sem-produto');
    const produtoNome = m.productName || getProdutoNome(m.productId) || 'Garrafões sem tipo registrado';
    if (!porCliente.has(clienteId)) porCliente.set(clienteId, new Map());
    const porProduto = porCliente.get(clienteId);
    if (!porProduto.has(produtoId)) porProduto.set(produtoId, { produtoId, produtoNome, quantidade: 0 });
    const item = porProduto.get(produtoId);
    item.quantidade += m.type === 'devolucao' ? -Number(m.qty || 0) : Number(m.qty || 0);
  });

  const clientesComodato = clientes.map(cliente => {
    const saldoAtual = Math.max(0, Number(cliente.garrafoesEmprestados || 0));
    if (saldoAtual <= 0) return null;

    const itensMovimentados = Array.from(porCliente.get(String(cliente.id))?.values() || [])
      .filter(item => item.quantidade > 0)
      .sort((a, b) => a.produtoNome.localeCompare(b.produtoNome, 'pt-BR'));
    const totalDiscriminado = itensMovimentados.reduce((total, item) => total + item.quantidade, 0);
    const itens = itensMovimentados.length > 0 && totalDiscriminado <= saldoAtual
      ? itensMovimentados
      : [{ produtoId: 'sem-produto', produtoNome: 'Garrafões sem tipo registrado', quantidade: saldoAtual }];

    // O saldo total do cliente continua vindo do campo validado da V9.5.
    // Se registros legados não tiverem produto, o saldo permanece visível.
    if (itensMovimentados.length > 0 && totalDiscriminado > 0 && totalDiscriminado < saldoAtual) {
      itens.push({
        produtoId: 'sem-produto',
        produtoNome: 'Garrafões sem tipo registrado',
        quantidade: saldoAtual - totalDiscriminado
      });
    }

    return {
      clienteId: cliente.id,
      clienteNome: cliente.nome || 'Cliente sem nome',
      saldoAtual,
      itens
    };
  }).filter(Boolean).sort((a, b) => a.clienteNome.localeCompare(b.clienteNome, 'pt-BR'));

  const totaisPorProduto = new Map();
  clientesComodato.forEach(cliente => cliente.itens.forEach(item => {
    totaisPorProduto.set(item.produtoNome, (totaisPorProduto.get(item.produtoNome) || 0) + item.quantidade);
  }));

  return {
    clientes: clientesComodato,
    totaisPorProduto: Array.from(totaisPorProduto.entries())
      .map(([produtoNome, quantidade]) => ({ produtoNome, quantidade }))
      .sort((a, b) => a.produtoNome.localeCompare(b.produtoNome, 'pt-BR')),
    totalGeral: clientesComodato.reduce((total, cliente) => total + cliente.saldoAtual, 0)
  };
}

// === v4.9 ALTERAÇÃO === showRelatorios: adiciona botão Fechar Dia e status de fechamento
async function showRelatorios(){
  const fechado = await dijaFoiFechado();
  const statusFechamento = fechado
    ? `<div class="card-alert" style="background:#dcfce7;border-color:#86efac;color:#166534;margin-bottom:8px;">✅ <strong>Dia já fechado!</strong> Fechamento realizado hoje.</div>`
    : `<div class="card-alert" style="background:#fef9c3;border-color:#fde047;color:#713f12;margin-bottom:8px;">⏳ Dia ainda não fechado.</div>`;
  // === v4.9.1 CORREÇÃO === Botões de ação do dia: Fechar Dia ou Iniciar Novo Dia
  const btnAcaoDia = fechado
    ? `<div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="btn-fechar-dia" class="btn-secondary" disabled style="opacity:0.5;cursor:not-allowed;flex:1;">🔒 Dia já fechado</button>
        <button id="btn-novo-dia" style="background:#16a34a;color:#fff;border:none;border-radius:8px;padding:12px 20px;font-size:1em;font-weight:700;cursor:pointer;flex:1;">🔓 Iniciar Novo Dia</button>
      </div>`
    : `<button id="btn-fechar-dia" style="background:#dc2626;color:#fff;border:none;border-radius:8px;padding:12px 20px;font-size:1em;font-weight:700;cursor:pointer;width:100%;">🔒 FECHAR DIA</button>`;
  renderScreen('Relatórios', 'Diário, mensal e conferência de caixa.', `
    <div class="card">
      ${statusFechamento}
      <div class="btn-row">
        <button id="btn-rel-dia" class="btn-primary">Relatório do Dia</button>
        <button id="btn-rel-mes" class="btn-primary">Resumo do Mês</button>
        <button id="btn-rel-caixa" class="btn-primary">Conferência de Caixa</button>
        <button id="btn-rel-comodatos" class="btn-primary">Relatório de Comodatos</button>
        <button id="btn-tg-config" class="btn-secondary">Config. Telegram</button>
        <button id="btn-export-data-rel" class="btn-secondary">Exportar Dados (Backup)</button>
        <button id="btn-import-data-rel" class="btn-secondary">Importar Dados (Restaurar)</button>
      </div>
      <div style="margin-top:12px;">${btnAcaoDia}</div>
      <div id="rel-area" class="stack" style="margin-top:12px;"></div>
    </div>
  `);
  byId('btn-rel-dia').onclick = gerarRelatorioDia;
  byId('btn-rel-mes').onclick = gerarResumoMes;
  byId('btn-rel-caixa').onclick = gerarRelatorioCaixa;
  byId('btn-rel-comodatos').onclick = gerarRelatorioComodatos;
  byId('btn-tg-config').onclick = openTelegramConfigProtected;
  byId('btn-export-data-rel').onclick = exportData;
  byId('btn-import-data-rel').onclick = importData;
  if (!fechado) byId('btn-fechar-dia').onclick = iniciarFechamentoDia;
  if (fechado && byId('btn-novo-dia')) byId('btn-novo-dia').onclick = iniciarNovoDia;
}

async function gerarRelatorioComodatos() {
  const area = byId('rel-area');
  try {
    const posicao = await obterPosicaoAtualComodatos();
    const clientesHtml = posicao.clientes.length > 0
      ? posicao.clientes.map(cliente => `
          <div class="report-section">
            <h4>${escapeHtml(cliente.clienteNome)} — ${cliente.saldoAtual} unidade(s)</h4>
            <div class="report-table-wrap"><table class="report-table"><tbody>
              ${cliente.itens.map(item => `<tr><td>${escapeHtml(item.produtoNome)}</td><td class="right">${item.quantidade} un</td></tr>`).join('')}
            </tbody></table></div>
          </div>
        `).join('')
      : '<div class="report-empty">Nenhum comodato em aberto.</div>';
    const totaisHtml = posicao.totaisPorProduto.length > 0
      ? posicao.totaisPorProduto.map(item => `<div class="kpi-line"><span>${escapeHtml(item.produtoNome)}</span><strong>${item.quantidade} un</strong></div>`).join('')
      : '<div class="report-empty">Nenhum comodato em aberto.</div>';

    area.innerHTML = `
      <div id="report-card" class="report-wrap card">
        <div class="report-header">
          <img src="${LOGO_SRC}" class="report-logo" alt="Água Lírios">
          <p class="report-title">Relatório de Comodatos</p>
          <div class="muted">Posição atual • ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</div>
        </div>
        ${clientesHtml}
        <div class="report-section">
          <h4>Totais em Comodato</h4>
          <div class="report-kpi">
            ${totaisHtml}
            <div class="kpi-line"><span>Total Geral</span><strong>${posicao.totalGeral} un</strong></div>
          </div>
        </div>
      </div>
    `;
  } catch (e) {
    console.warn('[v9.6] Falha ao gerar relatório de comodatos:', e);
    area.innerHTML = '<div class="report-empty">Não foi possível carregar o relatório de comodatos.</div>';
  }
}

// === v4.9 ALTERAÇÃO === Verifica se o dia atual já foi fechado
async function dijaFoiFechado() {
  if (!appDb || !appDb.objectStoreNames.contains('fechamentos')) return false;
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const id = `fechamento_${hoje}`;
    const reg = await idbGet('fechamentos', id);
    return !!reg;
  } catch (e) {
    return false;
  }
}

// === v4.9.1 CORREÇÃO === Iniciar Novo Dia: remove bloqueio sem apagar histórico
async function iniciarNovoDia() {
  // O sistema já é baseado na data atual (new Date())
  // Basta remover o registro de fechamento do dia atual do IDB
  // O histórico, clientes e estoque são preservados integralmente
  if (!confirm('Iniciar novo dia? As vendas serão liberadas novamente.\nO histórico do dia anterior será preservado.')) return;
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const id = `fechamento_${hoje}`;
    // Remove apenas o registro de fechamento de hoje
    await new Promise((resolve) => {
      if (!appDb || !appDb.objectStoreNames.contains('fechamentos')) { resolve(); return; }
      const tx = appDb.transaction('fechamentos', 'readwrite');
      tx.objectStore('fechamentos').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    toast('🔓 Novo dia iniciado! Vendas liberadas.');
    // Recarrega a tela de relatórios para atualizar status
    setTimeout(() => showRelatorios(), 300);
  } catch (e) {
    console.warn('[v4.9.1] Falha ao iniciar novo dia:', e);
    alert('Erro ao iniciar novo dia. Tente novamente.');
  }
}

// === v4.9 ALTERAÇÃO === Inicia o fluxo de fechamento: exibe resumo e pede confirmação
async function iniciarFechamentoDia() {
  // === v5.1 ALTERAÇÃO === Novo fluxo: 2 confirms nativos, sem resumo/modal antes do fechamento
  // Passo 1: confirmação de que já conferiu os relatórios
  if (!confirm('Você já conferiu todos os relatórios do dia?')) return;

  // Passo 2: confirmação final do fechamento
  if (!confirm('Deseja realmente fechar o caixa do dia? Esta ação não pode ser desfeita.')) return;

  // Passo 3: executar fechamento normalmente (igual v5.0.1)
  const hoje = new Date().toISOString();
  const f = buildFinancial(ts => sameDayISO(ts, hoje));
  const totalEstornos = f.estornos ? f.estornos.reduce((a, e) => a + Number(e.total || 0), 0) : 0;

  let clientesDebito = [];
  let totalValesNaRua = 0;
  try {
    const clientes = await idbGetAll('clientes');
    clientesDebito = clientes.filter(c => Number(c.debitoTotal || 0) > 0);
    totalValesNaRua = clientesDebito.reduce((a, c) => a + Number(c.debitoTotal || 0), 0);
  } catch (e) {
    console.warn('[v4.9] Falha ao buscar clientes para fechamento:', e);
  }

  await executarFechamentoDia(f, clientesDebito, totalValesNaRua, totalEstornos);
}

// === v4.9 ALTERAÇÃO === Executa o fechamento: backup, export, salva IDB, Telegram, limpa custos
async function executarFechamentoDia(f, clientesDebito, totalValesNaRua, totalEstornos) {
  const hoje = new Date().toISOString().slice(0, 10);
  const agora = new Date().toISOString();

  // === v7.0 ALTERACAO === Obter nome da distribuidora para usar em backups
  const distribuidoraBackup = localStorage.getItem('aguaLirios_distribuidora_nome') || 'Distribuidora nao informada';

  // 1. Gerar backup completo
  if (typeof gerarBackupCompletoDia === 'function') {
    await gerarBackupCompletoDia();
  }

  // 2. Exportar backup automaticamente
  if (typeof exportarBackupCompleto === 'function') {
    await exportarBackupCompleto();
  }

  // 3. Salvar fechamento no IndexedDB
  const resumo = {
    totalDinheiro: f.totalDinheiro,
    totalPix: f.totalPix,
    totalVales: f.totalVales,
    totalCustos: f.totalCustos,
    totalEstornos,
    valorDeposito: f.valorDeposito,
    totalValesNaRua,
    clientesDebito: clientesDebito.map(c => ({ id: c.id, nome: c.nome, debito: c.debitoTotal }))
  };
  try {
    await idbPut('fechamentos', {
      id: `fechamento_${hoje}`,
      data: hoje,
      ts: agora,
      resumo
    });
  } catch (e) {
    console.warn('[v4.9] Falha ao salvar fechamento no IDB:', e);
  }

  // 4. Snapshot de backup
  if (typeof gerarSnapshotCritico === 'function') gerarSnapshotCritico('fechamento');

  // 5. Enviar Telegram (silencioso) — preserva o fluxo e altera somente o conteúdo textual
  let customerSummary = null;
  try {
    customerSummary = await getCustomerSummary(agora);
  } catch (e) {
    console.warn('[v9.4] Falha ao montar resumo de atendimento para o Telegram:', e);
  }
  const linhasRecebimentosVale = f.receipts.length > 0
    ? f.receipts.map(r => `• ${r.clientName || 'Cliente não informado'} — ${fmtMoney(r.value || 0)} — ${payLabel(r.payMethod)}`)
    : ['• Nenhum recebimento de vale registrado'];
  const linhasMovimentosManuais = [...f.entradas, ...f.saidas]
    .sort((a, b) => new Date(a.ts) - new Date(b.ts))
    .map(m => `${new Date(m.ts).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})} — ${m.type === 'entry' ? 'ENTRADA' : 'SAÍDA'} — ${getProdutoNome(m.productId)} — ${m.type === 'entry' ? '+' : '-'}${m.qty} un${m.obs ? ` — ${m.obs}` : ''}`);
  // === v5.2 ALTERAÇÃO === Ajuste 2: adicionado estoque atual no final da mensagem de fechamento
  let posicaoComodatos = { clientes: [], totaisPorProduto: [], totalGeral: 0 };
  try {
    posicaoComodatos = await obterPosicaoAtualComodatos();
  } catch (e) {
    console.warn('[v9.6] Falha ao montar posição atual de comodatos para o Telegram:', e);
  }
  const linhasComodatosAbertos = posicaoComodatos.clientes.length > 0
    ? [
        ...posicaoComodatos.clientes.flatMap(cliente =>
          cliente.itens.map(item => `• ${cliente.clienteNome} — ${item.quantidade}x ${item.produtoNome}`)
        ),
        'TOTAIS POR TIPO:',
        ...posicaoComodatos.totaisPorProduto.map(item => `${item.produtoNome}: ${item.quantidade} un`),
        `TOTAL GERAL EM COMODATO: ${posicaoComodatos.totalGeral} un`
      ]
    : ['Nenhum comodato em aberto.'];
  const vendasPorProduto = new Map();
  f.sales.forEach(s => {
    const nome = getProdutoNome(s.productId);
    const quantidade = Number(s.qty || 0);
    const total = Number(s.total || (quantidade * Number(s.price || 0)));
    if (!vendasPorProduto.has(nome)) vendasPorProduto.set(nome, { quantidade: 0, total: 0 });
    const item = vendasPorProduto.get(nome);
    item.quantidade += quantidade;
    item.total += total;
  });
  const linhasVendasPorProduto = Array.from(vendasPorProduto.entries())
    .filter(([, item]) => item.quantidade > 0 || Math.abs(item.total) > 0.005)
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
    .map(([nome, item]) => `• ${nome} — ${item.quantidade} un — ${fmtMoney(item.total)}`);
  const totalVendasDetalhadas = Array.from(vendasPorProduto.values()).reduce((total, item) => total + item.total, 0);
  const alertaVendas = Math.abs(totalVendasDetalhadas - Number(f.totalVendas || 0)) > 0.005
    ? `⚠️ Divergência detectada: vendas detalhadas ${fmtMoney(totalVendasDetalhadas)} | total calculado ${fmtMoney(f.totalVendas)}`
    : null;

  const resumoEntradasManuais = new Map();
  const resumoSaidasManuais = new Map();
  const registrarResumoManual = (mapa, movimento) => {
    const nome = getProdutoNome(movimento.productId);
    mapa.set(nome, (mapa.get(nome) || 0) + Number(movimento.qty || 0));
  };
  f.entradas.forEach(m => registrarResumoManual(resumoEntradasManuais, m));
  f.saidas.forEach(m => registrarResumoManual(resumoSaidasManuais, m));
  const nomesResumoManual = new Set([...resumoEntradasManuais.keys(), ...resumoSaidasManuais.keys()]);
  const linhasResumoManuais = Array.from(nomesResumoManual)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .flatMap(nome => [
      `${nome}:`,
      `Entradas manuais: ${resumoEntradasManuais.get(nome) || 0}`,
      `Saídas manuais: ${resumoSaidasManuais.get(nome) || 0}`
    ]);

  const comodatoMovimentos = await idbGetAll('comodato_movimentos');
  const comodatoMovimentosHoje = comodatoMovimentos
    .filter(m => sameDayISO(m.ts, new Date().toISOString()))
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const comodatoEmprestimosHoje = comodatoMovimentosHoje.filter(m => m.type === 'emprestimo');
  const comodatoDevolucoesHoje = comodatoMovimentosHoje.filter(m => m.type === 'devolucao');
  const saldoLiquidoComodatoDisponivel = comodatoMovimentosHoje.every(m => m.type === 'emprestimo' || m.type === 'devolucao');
  const totalComodatoEmprestadoHoje = comodatoEmprestimosHoje.reduce((total, m) => total + Number(m.qty || 0), 0);
  const totalComodatoDevolvidoHoje = comodatoDevolucoesHoje.reduce((total, m) => total + Number(m.qty || 0), 0);
  const saldoLiquidoComodatoHoje = totalComodatoEmprestadoHoje - totalComodatoDevolvidoHoje;
  const linhasComodatoMovimento = movimento => {
    const hora = new Date(movimento.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const produto = movimento.productName || getProdutoNome(movimento.productId);
    return `${hora} — ${movimento.clientName || 'Cliente não informado'} — ${movimento.qty} ${produto}`;
  };
  const linhasEmprestimosComodato = comodatoEmprestimosHoje.map(linhasComodatoMovimento);
  const linhasDevolucoesComodato = comodatoDevolucoesHoje.map(linhasComodatoMovimento);
  const linhasClientesFechamento = clientesDebito.length > 0
    ? clientesDebito.map(c => `• ${c.nome} — ${fmtMoney(c.debitoTotal)}`)
    : ['Nenhum cliente em débito'];
  const linhasEstoqueFechamento = produtos
    .filter(p => Number(p.quantidade || 0) > 0)
    .map(p => `• ${p.nome}: ${p.quantidade} un`);
  const linhasRotaFechamento = customerSummary
    ? [
        `Clientes ativos: ${customerSummary.totalAtivos}`,
        `Compraram hoje: ${customerSummary.totalCompraram}`,
        `Visitados sem compra: ${customerSummary.totalVisitadosSemCompra}`,
        `Não atendidos: ${customerSummary.totalNaoAtendidos}`,
        `Cobertura: ${customerSummary.cobertura}%`
      ]
    : ['Resumo de atendimento indisponível'];
  // === v9.7 ALTERAÇÃO === Fechamento como prestação de contas + posição atual + resumo da rota
  const distribuidoraNome = localStorage.getItem('aguaLirios_distribuidora_nome') || 'Distribuidora nao informada';
  const fechamentoDia = [
    '═══════════════════════════════════════════════════════════════',
    '📋 FECHAMENTO DO DIA',
    `📍 ${distribuidoraNome}`,
    `📅 ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
    '═══════════════════════════════════════════════════════════════',
    '',
    '💰 VENDAS DO DIA',
    '───────────────────────────────────────────────────────────────',
    `Total vendido: ${fmtMoney(f.totalVendas)}`,
    `Dinheiro: ${fmtMoney(f.totalVendasDinheiro)}`,
    `Pix: ${fmtMoney(f.totalVendasPix)}`,
    `Vale: ${fmtMoney(f.totalVendasVale)}`,
    '',
    '📦 VENDAS POR PRODUTO',
    '───────────────────────────────────────────────────────────────',
    ...(linhasVendasPorProduto.length > 0 ? linhasVendasPorProduto : ['Nenhuma venda registrada']),
    `TOTAL VENDIDO: ${fmtMoney(totalVendasDetalhadas)}`,
    ...(alertaVendas ? [alertaVendas] : []),
    '',
    '↩️ RECEBIMENTOS DE VALES',
    '───────────────────────────────────────────────────────────────',
    `Total recebido: ${fmtMoney(f.totalRecebimentosVale)}`,
    `Dinheiro: ${fmtMoney(f.totalRecebimentosValeDinheiro)}`,
    `Pix: ${fmtMoney(f.totalRecebimentosValePix)}`,
    ...(linhasRecebimentosVale.length > 0 ? linhasRecebimentosVale : ['Nenhum recebimento de vale registrado']),
    '',
    '💵 PRESTAÇÃO DE CONTAS',
    '───────────────────────────────────────────────────────────────',
    `Dinheiro das vendas: ${fmtMoney(f.totalVendasDinheiro)}`,
    `Dinheiro recebido de vales: ${fmtMoney(f.totalRecebimentosValeDinheiro)}`,
    `Custos: ${fmtMoney(f.totalCustos)}`,
    `Estornos: ${fmtMoney(totalEstornos)}`,
    `Valor para depósito/prestação: ${fmtMoney(f.valorDeposito)}`,
    '',
    '📱 MOVIMENTO PIX',
    '───────────────────────────────────────────────────────────────',
    `Pix das vendas: ${fmtMoney(f.totalVendasPix)}`,
    `Pix recebido de vales: ${fmtMoney(f.totalRecebimentosValePix)}`,
    `Total movimentado em Pix: ${fmtMoney(f.totalVendasPix + f.totalRecebimentosValePix)}`,
    '',
    '💳 POSIÇÃO DE VALES',
    '───────────────────────────────────────────────────────────────',
    `TOTAL DE VALES NA RUA: ${fmtMoney(totalValesNaRua)}`,
    ...linhasClientesFechamento,
    '',
    '📦 MOVIMENTAÇÕES MANUAIS DE ESTOQUE',
    '───────────────────────────────────────────────────────────────',
    ...(linhasMovimentosManuais.length > 0 ? linhasMovimentosManuais : ['Nenhuma movimentação manual registrada']),
    ...(linhasResumoManuais.length > 0 ? ['', 'RESUMO POR PRODUTO:', ...linhasResumoManuais] : []),
    '',
    '🧴 MOVIMENTAÇÃO DE COMODATO DO DIA',
    '───────────────────────────────────────────────────────────────',
    `Emprestados hoje: ${totalComodatoEmprestadoHoje}`,
    ...(linhasEmprestimosComodato.length > 0 ? linhasEmprestimosComodato.map(linha => `• ${linha}`) : ['Nenhum empréstimo de comodato hoje']),
    `Devolvidos/recolhidos de comodato hoje: ${totalComodatoDevolvidoHoje}`,
    ...(linhasDevolucoesComodato.length > 0 ? linhasDevolucoesComodato.map(linha => `• ${linha}`) : ['Nenhuma devolução de comodato hoje']),
    ...(saldoLiquidoComodatoDisponivel
      ? [`Saldo líquido da movimentação: ${saldoLiquidoComodatoHoje >= 0 ? '+' : ''}${saldoLiquidoComodatoHoje} garrafões na rua`]
      : ['Saldo líquido da movimentação: não calculado — tipo de registro não reconhecido']),
    '',
    '🧴 COMODATOS EM ABERTO — POSIÇÃO ATUAL',
    '───────────────────────────────────────────────────────────────',
    ...linhasComodatosAbertos,
    '',
    '📦 ESTOQUE FINAL',
    '───────────────────────────────────────────────────────────────',
    ...(linhasEstoqueFechamento.length > 0 ? linhasEstoqueFechamento : ['Nenhum produto em estoque']),
    '',
    '👥 ROTA DO DIA',
    '───────────────────────────────────────────────────────────────',
    ...linhasRotaFechamento,
    '═══════════════════════════════════════════════════════════════'
  ].join('\n');
  const fechamentoEnviado = await enviarFechamentoDiaTelegram(fechamentoDia);
  if (!fechamentoEnviado) console.warn('[v9.7] Fechamento do Dia não foi completamente enviado.');

  // === v9.4 ALTERACAO === Exportar arquivo de geolocalizacao_rota.json com base COMPLETA de clientes
  try {
    const acoesPonto = await idbGetAll('acoes_ponto');
    const todosClientes = await idbGetAll('clientes');
    const acoesDoDia = acoesPonto.filter(a => sameDayISO(a.ts, new Date().toISOString()));
    const vendasDoDiaGeo = movimentos.filter(m => m.type === 'sale' && !m.estornada && sameDayISO(m.ts, new Date().toISOString()));
    const distribuidoraNomeGeo = localStorage.getItem('aguaLirios_distribuidora_nome') || 'Distribuidora nao informada';
    
    const clientesAtivos = todosClientes.filter(c => (c.situacao || 'Ativo') === 'Ativo');
    const clientesComGps = clientesAtivos.filter(c => c.latitude && c.longitude);
    const clientesSemGpsCount = clientesAtivos.length - clientesComGps.length;

    let compraramCount = 0;
    let naoCompraramCount = 0;
    let naoAtendidosCount = 0;

    const pontos = [];

    // 1. Mapear Clientes Ativos com GPS
    clientesComGps.forEach(c => {
      // Prioridade 1: Venda (Verde)
      const venda = vendasDoDiaGeo.find(v => String(v.clientId) === String(c.id));
      // Prioridade 2: Não Comprou (Vermelho)
      const acao = acoesDoDia.find(a => String(a.clientId) === String(c.id));

      let status = 'nao_atendido';
      let motivo = null;
      let observacao = null;
      let vendaId = null;
      let hora = null;

      if (venda) {
        status = 'comprou';
        vendaId = venda.id;
        hora = new Date(venda.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        observacao = venda.descricao || null;
        compraramCount++;
      } else if (acao) {
        status = 'nao_comprou';
        motivo = acao.motivo || null;
        observacao = acao.observacao || null;
        hora = new Date(acao.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        naoCompraramCount++;
      } else {
        naoAtendidosCount++;
      }

      pontos.push({
        pontoId: `cliente-${c.id}`,
        clientId: c.id,
        clientName: c.nome,
        distribuidora: distribuidoraNomeGeo,
        lat: c.latitude,
        lng: c.longitude,
        tipo: c.tipo || 'Residência',
        status: status,
        statusDia: status,
        motivo: motivo,
        observacao: observacao,
        vendaId: vendaId,
        hora: hora
      });
    });

    // 2. Adicionar pontos avulsos de acoes_ponto que não possuem clientId
    acoesDoDia.forEach(a => {
      if (!a.clientId) {
        pontos.push({
          pontoId: a.id || `ponto-${Date.now()}`,
          clientId: null,
          clientName: a.clientName || 'Ponto Avulso',
          distribuidora: a.distribuidora || distribuidoraNomeGeo,
          lat: a.lat,
          lng: a.lng,
          tipo: a.tipo || 'Ponto',
          status: a.status || 'visitado',
          statusDia: a.status || 'visitado',
          motivo: a.motivo || null,
          observacao: a.observacao || null,
          vendaId: null,
          hora: new Date(a.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        });
      }
    });

    const geoData = {
      distribuidora: distribuidoraNomeGeo,
      data: hoje,
      geradoEm: agora,
      resumo: {
        clientesAtivos: clientesAtivos.length,
        clientesComGPS: clientesComGps.length,
        clientesSemGPS: clientesSemGpsCount,
        compraram: compraramCount,
        naoCompraram: naoCompraramCount,
        naoAtendidos: naoAtendidosCount,
        pontosExportados: pontos.length
      },
      pontos: pontos
    };

    const geoJson = JSON.stringify(geoData, null, 2);
    const distribuidoraSlugGeo = slugifyDistribuidoraNome(distribuidoraNomeGeo);
    const geoFilename = `geolocalizacao_rota_${distribuidoraSlugGeo}_${hoje}.json`;
    telegramSendDocument(geoJson, geoFilename, `🗺️ Rota de Prospeccao do dia ${hoje}`, 'application/json');
    
    console.log(`[v9.4] Geolocalização gerada: ${geoData.pontos.length} pontos. Clientes sem GPS: ${clientesSemGpsCount}`);
  } catch (e) {
    console.warn('[v9.4] Erro ao exportar geolocalizacao_rota:', e);
  }

  // === v9.5 ALTERAÇÃO === Gerar o mesmo extrato e enviá-lo como mensagem(ns) Telegram
  try {
    const customerSummary = await getCustomerSummary(hoje);
    const extratoTxt = await gerarExtratoOperacional(f, clientesDebito, totalValesNaRua, totalEstornos, customerSummary);
    const extratoEnviado = await enviarExtratoOperacionalTelegram(extratoTxt);
    if (!extratoEnviado) console.warn('[v9.5] Extrato Operacional não foi completamente enviado.');
  } catch (e) {
    console.warn('[v9.5] Erro ao enviar extrato operacional como mensagem:', e);
  }

  // === v9.1 ALTERACAO === Enviar backup INTEGRAL do dia como documento no Telegram
  try {
    const backupData = await window.gerarBackupCompleto();
    const backupJson = JSON.stringify(backupData, null, 2);
    const distribuidoraSlug = slugifyDistribuidoraNome(distribuidoraBackup);
    const backupFilename = `backup_completo_${distribuidoraSlug}_${hoje}.json`;
    telegramSendDocument(backupJson, backupFilename, `💾 Backup INTEGRAL do dia ${hoje}`, 'application/json');
  } catch (e) {
    console.warn('[v9.1] Erro ao preparar backup integral para Telegram:', e);
  }

  // 6. Limpar custos do dia (zera apenas os do dia atual)
  const ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);
  custos = custos.filter(c => !sameDayISO(c.ts, new Date().toISOString()));
  salvarDados();

  // 7. Feedback ao usuário
  toast('🔒 Dia fechado com sucesso! Backup gerado.');
  // Recarrega a tela de relatórios para mostrar status atualizado
  setTimeout(() => showRelatorios(), 300);
}

function getProdutoNome(id){ return (produtos.find(x=>x.id===id)||{nome:'-'}).nome; }
function sum(arr){ return arr.reduce((a,b)=>a+Number(b||0),0); }

// === v9.4 ALTERAÇÃO === Extrato TXT focado em auditoria, usando somente registros existentes
async function gerarExtratoOperacional(f, clientesDebito, totalValesNaRua, totalEstornos, customerSummary) {
  const hoje = new Date().toISOString().slice(0, 10);
  const distribuidoraNome = localStorage.getItem('aguaLirios_distribuidora_nome') || 'Distribuidora nao informada';
  const linhas = [];
  const separador = '───────────────────────────────────────────────────────────────';
  const horaRegistro = ts => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  linhas.push('═══════════════════════════════════════════════════════════════');
  linhas.push(`EXTRATO OPERACIONAL - ${hoje}`);
  linhas.push(`Distribuidora: ${distribuidoraNome}`);
  linhas.push(`Gerado em: ${new Date().toLocaleString()}`);
  linhas.push('═══════════════════════════════════════════════════════════════');
  linhas.push('');

  linhas.push('VENDAS DO DIA');
  linhas.push(separador);
  if (f.sales.length === 0) {
    linhas.push('Nenhuma venda registrada');
  } else {
    f.sales.forEach(s => {
      const nome = getProdutoNome(s.productId);
      const total = Number(s.total || (Number(s.qty || 0) * Number(s.price || 0)));
      const cliente = s.clientName ? ` | Cliente: ${s.clientName}` : '';
      const forma = s.payMethod ? ` | Forma: ${payLabel(s.payMethod)}` : '';
      linhas.push(`• ${nome} - ${s.qty}x @ ${fmtMoney(s.price)} = ${fmtMoney(total)}${cliente}${forma}`);
    });
  }
  linhas.push('');

  linhas.push('RECEBIMENTOS DE VALE');
  linhas.push(separador);
  if (f.receipts.length === 0) {
    linhas.push('Nenhum recebimento de vale registrado');
  } else {
    f.receipts.forEach(r => {
      linhas.push(`• ${r.clientName || 'Cliente não informado'} — ${fmtMoney(r.value || 0)} — ${payLabel(r.payMethod)}`);
    });
    linhas.push(separador);
    linhas.push(`TOTAL RECEBIDO: ${fmtMoney(f.totalRecebimentosVale)}`);
    linhas.push(`Dinheiro: ${fmtMoney(f.totalRecebimentosValeDinheiro)}`);
    linhas.push(`Pix:      ${fmtMoney(f.totalRecebimentosValePix)}`);
  }
  linhas.push('');

  linhas.push('CUSTOS DO DIA');
  linhas.push(separador);
  if (f.custosFil.length === 0) {
    linhas.push('Nenhum custo registrado');
  } else {
    f.custosFil.forEach(c => linhas.push(`• ${c.descricao} — ${fmtMoney(c.valor)}`));
  }
  linhas.push('');

  linhas.push('ESTORNOS');
  linhas.push(separador);
  if (f.estornos.length === 0) {
    linhas.push('Nenhum estorno registrado');
  } else {
    f.estornos.forEach(e => {
      const produto = getProdutoNome(e.productId);
      linhas.push(`• Cliente: ${e.clientName || 'Não informado'}`);
      linhas.push(`  Produto: ${produto}`);
      linhas.push(`  Quantidade: ${e.qty || 0} | Preço: ${fmtMoney(e.price)} | Valor: ${fmtMoney(e.total)}`);
      linhas.push(`  Forma de pagamento: ${payLabel(e.payMethod)} | Hora: ${horaRegistro(e.ts)}`);
      linhas.push(`  Motivo: ${e.motivo || 'Não informado'}`);
    });
  }
  linhas.push('');

  linhas.push('MOVIMENTAÇÕES DE ESTOQUE DO DIA');
  linhas.push(separador);
  const movimentosManuais = [...f.entradas, ...f.saidas].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  if (movimentosManuais.length === 0) {
    linhas.push('Nenhuma entrada, saída manual ou ajuste registrado');
  } else {
    movimentosManuais.forEach(m => {
      const tipo = m.type === 'entry' ? 'ENTRADA' : 'SAÍDA';
      const sinal = m.type === 'entry' ? '+' : '-';
      const observacao = m.obs ? ` — ${m.obs}` : '';
      linhas.push(`${horaRegistro(m.ts)} — ${tipo} — ${getProdutoNome(m.productId)} — ${sinal}${m.qty} un${observacao}`);
    });
  }
  linhas.push('');

  const comodatoMovs = await idbGetAll('comodato_movimentos');
  const movsHoje = comodatoMovs.filter(m => sameDayISO(m.ts, new Date().toISOString()));
  if (movsHoje.length > 0) {
    linhas.push('MOVIMENTAÇÃO DE COMODATO (GARRAFÕES)');
    linhas.push(separador);
    movsHoje.forEach(m => {
      const icon = m.type === 'emprestimo' ? '📤' : '📥';
      linhas.push(`${icon} ${m.clientName}: ${m.qty}x ${m.productName} (${m.type})`);
    });
    linhas.push('');
  }

  linhas.push('ESTOQUE FINAL');
  linhas.push(separador);
  const produtosComEstoque = produtos.filter(p => Number(p.quantidade || 0) > 0);
  if (produtosComEstoque.length === 0) {
    linhas.push('Nenhum produto em estoque');
  } else {
    produtosComEstoque.forEach(p => linhas.push(`• ${p.nome}: ${Number(p.quantidade)} un`));
  }
  linhas.push('');
  linhas.push('═══════════════════════════════════════════════════════════════');
  linhas.push('FIM DO EXTRATO');
  linhas.push('═══════════════════════════════════════════════════════════════');

  return linhas.join('\n');
}
// === v8.6 ALTERAÇÃO === buildFinancial: exclui vendas estornadas dos totais; inclui estornos
// === v4.8 ALTERAÇÃO === buildFinancial: exclui vendas estornadas dos totais; inclui estornos
function buildFinancial(todayFilter){
  // Vendas válidas: type=sale E não estornadas
  const sales = movimentos.filter(m => m.type === 'sale' && !m.estornada && todayFilter(m.ts));
  // Vendas estornadas (para exibição no relatório)
  const salesEstornadas = movimentos.filter(m => m.type === 'sale' && m.estornada && todayFilter(m.ts));
  // Movimentos de estorno registrados
  const estornos = movimentos.filter(m => m.type === 'estorno' && todayFilter(m.ts));
  const entradas = movimentos.filter(m=>m.type==='entry' && todayFilter(m.ts));
  const saidas = movimentos.filter(m=>m.type==='out' && todayFilter(m.ts));
  const receipts = movimentos.filter(m=>m.type==='vale_receipt' && todayFilter(m.ts));
  const custosFil = custos.filter(c=>todayFilter(c.ts));

  let salesDin=0, salesPix=0, salesVale=0;
  sales.forEach(s=> {
    const total = Number(s.total || (Number(s.qty||0)*Number(s.price||0)));
    const pm = normPay(s.payMethod);
    if(pm==='dinheiro') salesDin += total;
    else if(pm==='pix') salesPix += total;
    else salesVale += total;
  });

  const recDin = sum(receipts.filter(r=>normPay(r.payMethod)==='dinheiro').map(r=>r.value));
  const recPix = sum(receipts.filter(r=>normPay(r.payMethod)==='pix').map(r=>r.value));
  const totalCustos = sum(custosFil.map(c=>c.valor));
  const totalEstornos = sum(estornos.map(e=>e.total));
  return {
    sales, salesEstornadas, estornos, entradas, saidas, receipts, custosFil,
    totalEntradas: sum(entradas.map(m=>m.qty)),
    totalSaidas: sum(saidas.map(m=>m.qty)),
    totalVendidas: sum(sales.map(m=>m.qty)),
    totalVendasDinheiro: salesDin,
    totalVendasPix: salesPix,
    totalVendasVale: salesVale,
    totalDinheiro: salesDin + recDin,
    totalPix: salesPix + recPix,
    totalVales: salesVale,
    totalRecebimentosVale: recDin + recPix,
    totalRecebimentosValeDinheiro: recDin,
    totalRecebimentosValePix: recPix,
    totalVendas: salesDin + salesPix + salesVale,
    totalCustos,
    totalEstornos,
    valorDeposito: (salesDin + recDin) - totalCustos
  };
}
function renderEmpty(){ return '<div class="report-empty">— nenhum registro —</div>'; }
function renderSectionResumo(k){
  return `
    <div class="report-section">
      <h4>Resumo Financeiro</h4>
      <div class="report-kpi">
        <div class="kpi-line"><span>Entradas</span><strong>${Number(k.totalEntradas||0)}</strong></div>
        <div class="kpi-line"><span>Vendidas</span><strong>${Number(k.totalVendidas||0)}</strong></div>
        <div class="kpi-line"><span>Saídas</span><strong>${Number(k.totalSaidas||0)}</strong></div>
        <hr class="sep">
        <div class="kpi-line"><span>Total de Vendas</span><strong>${fmtMoney(k.totalVendas||0)}</strong></div>
        <div class="kpi-line"><span>💰 Vendas em Dinheiro</span><strong>${fmtMoney(k.totalVendasDinheiro||0)}</strong></div>
        <div class="kpi-line"><span>📲 Vendas em Pix</span><strong>${fmtMoney(k.totalVendasPix||0)}</strong></div>
        <div class="kpi-line"><span>📄 Vendas lançadas em Vale</span><strong>${fmtMoney(k.totalVendasVale||0)}</strong></div>
        <div class="kpi-line"><span>↩️ Recebimentos de Vale</span><strong>${fmtMoney(k.totalRecebimentosVale||0)}</strong></div>
        <div class="kpi-line"><span>↩️ Recebimento de Vale (Dinheiro)</span><strong>${fmtMoney(k.totalRecebimentosValeDinheiro||0)}</strong></div>
        <div class="kpi-line"><span>↩️ Recebimento de Vale (Pix)</span><strong>${fmtMoney(k.totalRecebimentosValePix||0)}</strong></div>
        <hr class="sep">
        <div class="kpi-line"><span>💸 Custos</span><strong>${fmtMoney(k.totalCustos||0)}</strong></div>
        <div class="kpi-line"><span>↩️ Estornos</span><strong>${fmtMoney(k.totalEstornos||0)}</strong></div>
        <div class="kpi-line"><span>🏦 Valor para Depósito</span><strong>${fmtMoney(k.valorDeposito||0)}</strong></div>
      </div>
    </div>
  `;
}
// === v9.0 ADIÇÃO === Seção de resumo de atendimento no relatório
function renderSectionAtendimento(k){
  return `
    <div class="report-section">
      <h4>Resumo de Atendimento</h4>
      <div class="report-kpi">
        <div class="kpi-line"><span>Clientes ativos cadastrados</span><strong>${k.totalAtivos}</strong></div>
        <div class="kpi-line"><span>Clientes que compraram hoje</span><strong>${k.totalCompraram}</strong></div>
        <div class="kpi-line"><span>Visitados sem compra</span><strong>${k.totalVisitadosSemCompra}</strong></div>
        <div class="kpi-line"><span>Clientes ainda não atendidos</span><strong>${k.totalNaoAtendidos}</strong></div>
        <hr class="sep">
        <div class="kpi-line"><span>Cobertura do dia</span><strong>${k.cobertura}%</strong></div>
      </div>
    </div>
  `;
}
function renderTableSection(title, headers, rows){
  return `
    <div class="report-section">
      <h4>${title}</h4>
      ${
        !rows.length ? renderEmpty() : `
          <table class="report-table">
            <thead><tr>${headers.map(h=>`<th class="${h.right?'report-right':''}">${h.label}</th>`).join('')}</tr></thead>
            <tbody>
              ${rows.map(r=>`<tr>${r.map((c,i)=>`<td class="${headers[i].right?'report-right':''}">${c}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>
        `
      }
    </div>
  `;
}
function renderInventorySection(){
  const lista = produtos.filter(p=>Number(p.quantidade||0)>0);
  return renderTableSection('Inventário Atual', [{label:'Produto'}, {label:'Qtd', right:true}], lista.map(p=>[escapeHtml(p.nome), String(p.quantidade)]));
}
async function getCustomerSummary(hoje) {
  const todosClientes = await idbGetAll("clientes");
  const acoesPonto = await idbGetAll("acoes_ponto");
  
  // === v9.0 ALTERAÇÃO === Filtrar apenas clientes ativos para indicadores operacionais
  const ativos = todosClientes.filter(c => (c.situacao || 'Ativo') === 'Ativo');
  const totalAtivos = ativos.length;

  const vendasDoDia = movimentos.filter(m => m.type === 'sale' && !m.estornada && sameDayISO(m.ts, hoje));
  const clientesQueCompraramHojeIds = new Set(vendasDoDia.map(m => m.clientId).filter(id => id));
  
  // Apenas clientes ativos que compraram
  const ativosQueCompraram = ativos.filter(c => clientesQueCompraramHojeIds.has(c.id));
  const totalCompraram = ativosQueCompraram.length;

  // Visitas sem compra hoje
  const visitasHoje = acoesPonto.filter(a => a.status === 'visitado' && sameDayISO(a.ts, hoje));
  
  // Clientes ativos visitados que NÃO compraram hoje (venda tem prioridade)
  const visitadosSemCompra = ativos.filter(c => {
    if (clientesQueCompraramHojeIds.has(c.id)) return false;
    return visitasHoje.some(v => v.clientId === c.id);
  });
  
  const totalVisitadosSemCompra = visitadosSemCompra.length;

  // Clientes ativos ainda não atendidos
  const naoAtendidos = ativos.filter(c => {
    return !clientesQueCompraramHojeIds.has(c.id) && !visitasHoje.some(v => v.clientId === c.id);
  });
  
  const totalNaoAtendidos = naoAtendidos.length;

  // Cobertura
  const cobertura = totalAtivos > 0 ? Math.round(((totalCompraram + totalVisitadosSemCompra) / totalAtivos) * 100) : 0;

  return {
    totalAtivos,
    totalCompraram,
    totalVisitadosSemCompra,
    totalNaoAtendidos,
    cobertura,
    visitadosSemCompraLista: visitadosSemCompra.map(c => {
      const v = visitasHoje.find(vh => vh.clientId === c.id);
      return {
        nome: c.nome,
        motivo: v.motivo || 'Não informado',
        observacao: v.observacao || '',
        hora: new Date(v.ts).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})
      };
    }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    naoAtendidosLista: naoAtendidos.map(c => c.nome).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  };
}

function buildDayShareText(f, title){
  return [
    title,
    `Data: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
    '',
    `Total de Vendas: ${fmtMoney(f.totalVendas)}`,
    `Vendas em Dinheiro: ${fmtMoney(f.totalVendasDinheiro)}`,
    `Vendas em Pix: ${fmtMoney(f.totalVendasPix)}`,
    `Vendas lançadas em Vale: ${fmtMoney(f.totalVendasVale)}`,
    `Recebimentos de Vale: ${fmtMoney(f.totalRecebimentosVale)}`,
    `Recebimentos de Vale em Dinheiro: ${fmtMoney(f.totalRecebimentosValeDinheiro)}`,
    `Recebimentos de Vale em Pix: ${fmtMoney(f.totalRecebimentosValePix)}`,
    `Custos: ${fmtMoney(f.totalCustos)}`,
    `Estornos: ${fmtMoney(f.totalEstornos)}`,
    `🏦 Valor para Depósito: ${fmtMoney(f.valorDeposito)}`
  ].join('\n');
}

async function shareRelatorioTexto(title, f){
  const texto = buildDayShareText(f, title);
  await shareTextFallback(title, texto);
}
function injectShareButton(containerId, title, f){
  const area = byId(containerId);
  if(!area) return;
  const wrap = document.createElement('div');
  wrap.className = 'report-actions';
  wrap.innerHTML = `<button class="btn-primary" id="btn-share-native">Compartilhar</button>`;
  area.appendChild(wrap);
  byId('btn-share-native').onclick = ()=> shareRelatorioTexto(title, f);
}

async function gerarRelatorioDia(){
  const area = byId("rel-area");
  const hoje = new Date().toISOString();
  const f = buildFinancial(ts=>sameDayISO(ts, hoje));
  const cs = await getCustomerSummary(hoje);
  const clientes = await idbGetAll('clientes');
  const clientesDebito = clientes.filter(c => Number(c.debitoTotal || 0) > 0);
  const totalValesNaRua = clientesDebito.reduce((a, c) => a + Number(c.debitoTotal || 0), 0);
  
  // === v9.4 ALTERAÇÃO === Visitados continuam nominais; não atendidos aparecem somente nos totais
  const listVisitadosHtml = renderTableSection('Visitados Sem Compra', [{label:'Cliente / Motivo'}, {label:'Hora', right:true}], cs.visitadosSemCompraLista.map(v => [
    `<strong>${escapeHtml(v.nome)}</strong><div class="muted">Motivo: ${escapeHtml(v.motivo)}${v.observacao ? ` | Obs: ${escapeHtml(v.observacao)}` : ''}</div>`,
    v.hora
  ]));
  const movimentosManuais = [...f.entradas, ...f.saidas].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const linhasMovimentosManuais = movimentosManuais.map(m => [
    `${new Date(m.ts).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})} — ${m.type === 'entry' ? 'ENTRADA' : 'SAÍDA'}<div class="muted">${escapeHtml(m.obs || '')}</div>`,
    escapeHtml(getProdutoNome(m.productId)),
    `${m.type === 'entry' ? '+' : '-'}${m.qty}`
  ]);

  area.innerHTML = `
    <div id="report-card" class="report-wrap card">
      <div class="report-header">
        <img src="${LOGO_SRC}" class="report-logo" alt="Água Lírios">
        <p class="report-title">Relatório Diário</p>
        <div class="muted">${new Date().toLocaleDateString()} • ${new Date().toLocaleTimeString()}</div>
      </div>
      
      ${renderSectionAtendimento(cs)}

      ${cs.visitadosSemCompraLista.length > 0 ? listVisitadosHtml : '<div class="report-section"><h4>Visitados Sem Compra</h4><div class="report-empty">Nenhum cliente visitado sem compra.</div></div>'}

      ${renderSectionResumo(f)}

      ${renderTableSection('Vendas (do dia)', [{label:'Produto / Descrição'},{label:'Qtd',right:true},{label:'Total',right:true}], f.sales.map(s=>[
        escapeHtml(getProdutoNome(s.productId)) + (s.clientName ? '<div class="muted">Cliente: '+escapeHtml(s.clientName)+'</div>' : '') + (s.descricao ? '<div class="muted">'+escapeHtml(s.descricao)+'</div>' : '') + `<div class="muted">Preço unitário: ${fmtMoney(s.price)}</div>`,
        String(s.qty),
        fmtMoney(s.total || (s.qty*s.price))
      ]))}
      
      ${renderTableSection('Recebimentos de Vale', [{label:'Cliente'},{label:'Forma'},{label:'Valor',right:true}], f.receipts.map(r=>[
        escapeHtml(r.clientName||'-'),
        escapeHtml(payLabel(r.payMethod)),
        fmtMoney(r.value)
      ]))}
      ${renderTableSection('Custos (do dia)', [{label:'Descrição'},{label:'Valor',right:true}], f.custosFil.map(c=>[
        escapeHtml(c.descricao),
        fmtMoney(c.valor)
      ]))}
      ${/* === v4.8 ALTERAÇÃO === Seção de estornos no relatório diário */
        (f.estornos && f.estornos.length)
          ? renderTableSection('Estornos (do dia)', [{label:'Cliente / Produto / Detalhes'},{label:'Qtd',right:true},{label:'Valor',right:true}], f.estornos.map(e=>[
              `<strong>Cliente: ${escapeHtml(e.clientName || 'Não informado')}</strong><div class="muted">Produto: ${escapeHtml(getProdutoNome(e.productId))}</div><div class="muted">Preço: ${fmtMoney(e.price)} | Forma: ${escapeHtml(payLabel(e.payMethod))} | Hora: ${new Date(e.ts).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</div><div class="muted">Motivo: ${escapeHtml(e.motivo || 'Não informado')}</div>`,
              String(e.qty),
              fmtMoney(e.total)
            ]))
          : ''
      }

      ${renderTableSection('Movimentações Manuais de Estoque', [{label:'Hora / Tipo'},{label:'Produto'},{label:'Quantidade',right:true}], linhasMovimentosManuais)}

      ${renderTableSection('Clientes em Débito', [{label:'Cliente'},{label:'Débito',right:true}], clientesDebito.map(c=>[
        escapeHtml(c.nome),
        fmtMoney(c.debitoTotal)
      ]))}
      <div class="report-section"><h4>Total de Vales na Rua</h4><div class="report-kpi"><div class="kpi-line"><span>Total de Vales na Rua</span><strong>${fmtMoney(totalValesNaRua)}</strong></div></div></div>
      ${renderInventorySection()}
    </div>
  `;
  injectShareButton("rel-area", "Relatório Diário", f);
}
function gerarResumoMes(){
  const area = byId('rel-area');
  const agora = new Date();
  const f = buildFinancial(ts=>sameMonth(ts, agora));
  area.innerHTML = `
    <div id="report-card" class="report-wrap card">
      <div class="report-header">
        <img src="${LOGO_SRC}" class="report-logo" alt="Água Lírios">
        <p class="report-title">Relatório Mensal</p>
        <div class="muted">${agora.toLocaleDateString('pt-BR',{month:'long', year:'numeric'})}</div>
      </div>
      ${renderTableSection('Vendas (do mês)', [{label:'Produto / Descrição'},{label:'Qtd',right:true},{label:'Total',right:true}], f.sales.map(s=>[
        escapeHtml(getProdutoNome(s.productId)) + (s.clientName ? '<div class="muted">Cliente: '+escapeHtml(s.clientName)+'</div>' : '') + (s.descricao ? '<div class="muted">'+escapeHtml(s.descricao)+'</div>' : ''),
        String(s.qty),
        fmtMoney(s.total || (s.qty*s.price))
      ]))}
      ${renderTableSection('Recebimentos de Vale', [{label:'Cliente'},{label:'Forma'},{label:'Valor',right:true}], f.receipts.map(r=>[
        escapeHtml(r.clientName||'-'),
        escapeHtml(payLabel(r.payMethod)),
        fmtMoney(r.value)
      ]))}
      ${renderTableSection('Custos (do mês)', [{label:'Descrição'},{label:'Valor',right:true}], f.custosFil.map(c=>[
        escapeHtml(c.descricao),
        fmtMoney(c.valor)
      ]))}
      ${renderSectionResumo(f)}
      ${renderInventorySection()}
    </div>
  `;
  injectShareButton('rel-area', 'Resumo do Mês', f);
}
// === v5.0.1 CORREÇÃO === gerarRelatorioCaixa: busca custos do fechamento salvo no IDB quando dia já foi fechado
async function gerarRelatorioCaixa(){
  const area = byId('rel-area');
  const hoje = new Date().toISOString();
  const f = buildFinancial(ts=>sameDayISO(ts, hoje));

  // Se o dia já foi fechado, os custos foram removidos da memória.
  // Buscar o totalCustos e valorDeposito do registro de fechamento salvo no IDB.
  const fechadoHoje = await dijaFoiFechado();
  if (fechadoHoje) {
    try {
      const idFechamento = `fechamento_${hoje.slice(0, 10)}`;
      const regFechamento = await idbGet('fechamentos', idFechamento);
      if (regFechamento && regFechamento.resumo) {
        // Sobrescreve apenas os campos financeiros com os valores do fechamento
        f.totalCustos = Number(regFechamento.resumo.totalCustos || 0);
        f.valorDeposito = Number(regFechamento.resumo.valorDeposito || 0);
      }
    } catch (e) {
      console.warn('[v5.0.1] Falha ao buscar custos do fechamento:', e);
    }
  }

  const grupo = (pay)=> [
    ...f.sales.filter(s=>normPay(s.payMethod)===pay).map(s=>({nome:getProdutoNome(s.productId), desc:(s.clientName? 'Cliente: '+s.clientName+' • ':'') + (s.descricao||''), qty:s.qty, total:s.total}))
  ];
  const din = grupo('dinheiro'), pix = grupo('pix'), val = grupo('vale');
  area.innerHTML = `
    <div id="report-card" class="report-wrap card">
      <div class="report-header">
        <img src="${LOGO_SRC}" class="report-logo" alt="Água Lírios">
        <p class="report-title">Conferência de Caixa</p>
        <div class="muted">${new Date().toLocaleDateString()} • ${new Date().toLocaleTimeString()}</div>
      </div>
      ${renderTableSection('Dinheiro', [{label:'Item / Descrição'},{label:'Qtd',right:true},{label:'Valor',right:true}], din.map(r=>[
        escapeHtml(r.nome) + (r.desc ? '<div class="muted">'+escapeHtml(r.desc)+'</div>' : ''),
        String(r.qty),
        fmtMoney(r.total)
      ]))}
      ${renderTableSection('Pix', [{label:'Item / Descrição'},{label:'Qtd',right:true},{label:'Valor',right:true}], pix.map(r=>[
        escapeHtml(r.nome) + (r.desc ? '<div class="muted">'+escapeHtml(r.desc)+'</div>' : ''),
        String(r.qty),
        fmtMoney(r.total)
      ]))}
      ${renderTableSection('Vale', [{label:'Item / Descrição'},{label:'Qtd',right:true},{label:'Valor',right:true}], val.map(r=>[
        escapeHtml(r.nome) + (r.desc ? '<div class="muted">'+escapeHtml(r.desc)+'</div>' : ''),
        String(r.qty),
        fmtMoney(r.total)
      ]))}
      ${renderTableSection('Recebimentos de Vale', [{label:'Cliente'},{label:'Forma'},{label:'Valor',right:true}], f.receipts.map(r=>[
        escapeHtml(r.clientName || '-'),
        escapeHtml(payLabel(r.payMethod)),
        fmtMoney(r.value)
      ]))}
      ${renderSectionResumo(f)}
      ${renderInventorySection()}
    </div>
  `;
  injectShareButton('rel-area', 'Conferência de Caixa', f);
  // === v4.7 ALTERAÇÃO === Snapshot crítico + backup completo no fechamento de caixa
  if (typeof gerarSnapshotCritico === 'function') gerarSnapshotCritico('fechamento');
  if (typeof gerarBackupCompletoDia === 'function') gerarBackupCompletoDia();
  // === v5.2 ALTERAÇÃO === Ajuste 1: removido envio de Telegram na Conferência de Caixa
}

// === v9.3 ADIÇÃO === Módulo de Transferência de Clientes (Exportação/Importação)

async function showExportarClientesTransferencia() {
  const todos = await idbGetAll('clientes');
  todos.sort((a, b) => (a.nome || '').localeCompare((b.nome || ''), 'pt-BR'));

  const modalBody = `
    <div class="stack">
      <input type="text" id="export-cli-busca" class="input-big" placeholder="Buscar cliente por nome..." style="margin-bottom:8px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <label style="font-size:0.9em; color:#64748b;">
          <input type="checkbox" id="export-cli-select-all"> Selecionar todos
        </label>
        <span id="export-cli-count" style="font-size:0.85em; font-weight:bold; color:#2146d0;">0 selecionados</span>
      </div>
      <div id="export-cli-lista" class="stack" style="max-height:300px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:8px; padding:4px;">
        <!-- Lista será renderizada aqui -->
      </div>
    </div>
  `;

  openModal('Exportar Clientes para Transferência', modalBody, async () => {
    const selecionados = Array.from(document.querySelectorAll('.export-cli-check:checked')).map(cb => cb.value);
    if (selecionados.length === 0) {
      alert('Selecione pelo menos um cliente para exportar.');
      return false;
    }
    await executarExportacaoClientes(selecionados);
    return true;
  });

  const renderLista = () => {
    const busca = (byId('export-cli-busca').value || '').toLowerCase().trim();
    const filtrados = todos.filter(c => (c.nome || '').toLowerCase().includes(busca));
    const lista = byId('export-cli-lista');
    
    if (filtrados.length === 0) {
      lista.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8;">Nenhum cliente encontrado.</div>';
      return;
    }

    lista.innerHTML = filtrados.map(c => `
      <label class="list-item" style="cursor:pointer; padding:8px; margin-bottom:4px; border-bottom:1px solid #f1f5f9;">
        <div style="display:flex; align-items:center; width:100%;">
          <input type="checkbox" class="export-cli-check" value="${c.id}" style="margin-right:12px; width:20px; height:20px;">
          <div style="flex:1;">
            <div style="font-weight:600; font-size:0.95em;">${escapeHtml(c.nome)}</div>
            <div style="font-size:0.8em; color:#64748b;">
              ${escapeHtml(c.cidade || 'Sem cidade')} • ${escapeHtml(c.tipo || 'Residência')}
              ${c.latitude && c.longitude ? ' • <span style="color:#22c55e;">🟢 GPS</span>' : ' • <span style="color:#ef4444;">🔴 Sem GPS</span>'}
            </div>
          </div>
        </div>
      </label>
    `).join('');

    // Atualizar contador e checkboxes
    const checks = document.querySelectorAll('.export-cli-check');
    const updateCount = () => {
      const count = document.querySelectorAll('.export-cli-check:checked').length;
      byId('export-cli-count').textContent = `${count} selecionado(s)`;
      byId('modal-confirm').textContent = count > 1 ? `Exportar ${count} Clientes` : 'Exportar Cliente';
    };

    checks.forEach(cb => cb.onchange = updateCount);
    updateCount();
  };

  byId('export-cli-busca').oninput = renderLista;
  byId('export-cli-select-all').onchange = (e) => {
    document.querySelectorAll('.export-cli-check').forEach(cb => cb.checked = e.target.checked);
    const count = document.querySelectorAll('.export-cli-check:checked').length;
    byId('export-cli-count').textContent = `${count} selecionado(s)`;
    byId('modal-confirm').textContent = count > 1 ? `Exportar ${count} Clientes` : 'Exportar Cliente';
  };

  renderLista();
}

async function executarExportacaoClientes(ids) {
  try {
    const todos = await idbGetAll('clientes');
    const selecionados = todos.filter(c => ids.includes(c.id));
    const distribuidora = localStorage.getItem('aguaLirios_distribuidora_nome') || 'Rota Nao Informada';
    
    // Limpar dados financeiros/sensíveis conforme regra absoluta
    const clientesLimpos = selecionados.map(c => {
      const { debitoTotal, garrafoesEmprestados, ...cadastral } = c;
      return {
        ...cadastral,
        debitoTotal: 0,
        garrafoesEmprestados: 0
      };
    });

    const payload = {
      tipoArquivo: "distagua_transferencia_clientes",
      versaoFormato: 1,
      sistema: "DistAgua Geo",
      distribuidoraOrigem: distribuidora,
      exportadoEm: new Date().toISOString(),
      quantidadeClientes: clientesLimpos.length,
      clientes: clientesLimpos
    };

    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    const hoje = new Date().toISOString().slice(0, 10);
    let filename = '';
    if (clientesLimpos.length === 1) {
      const nomeSlug = (clientesLimpos[0].nome || 'cliente').toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
      filename = `cliente_${nomeSlug}_${hoje}.json`;
    } else {
      const distSlug = distribuidora.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
      filename = `clientes_transferencia_${distSlug}_${hoje}.json`;
    }

    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    toast('Exportação concluída com sucesso!');
    setTimeout(() => {
      alert('Cliente(s) exportado(s) com sucesso.\n\nDepois de confirmar a importação na nova rota, você poderá desativá-lo(s) nesta rota manualmente.');
    }, 500);
  } catch (e) {
    console.error('Erro na exportação:', e);
    alert('Erro ao exportar clientes.');
  }
}

function showImportarClientesTransferencia() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await processarArquivoImportacaoClientes(file);
  };
  input.click();
}

async function processarArquivoImportacaoClientes(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (data.tipoArquivo !== "distagua_transferencia_clientes") {
      return alert('Arquivo incompatível com a Transferência de Clientes do DistAgua Geo.');
    }

    if (!data.clientes || !Array.isArray(data.clientes) || data.clientes.length === 0) {
      return alert('Nenhum cliente válido encontrado no arquivo.');
    }

    const modalBody = `
      <div class="stack">
        <div class="card-alert" style="background:#f8fafc; border-color:#e2e8f0; color:#475569;">
          Origem: <strong>${escapeHtml(data.distribuidoraOrigem || 'Desconhecida')}</strong><br>
          Clientes encontrados: <strong>${data.clientes.length}</strong>
        </div>
        <div style="max-height:250px; overflow-y:auto; font-size:0.9em;">
          <ul style="padding-left:20px; margin:8px 0;">
            ${data.clientes.map(c => `
              <li style="margin-bottom:4px;">
                ${escapeHtml(c.nome)} 
                ${c.latitude && c.longitude ? '<span style="color:#22c55e; font-weight:bold;">[Com GPS]</span>' : '<span style="color:#94a3b8;">[Sem GPS]</span>'}
              </li>
            `).join('')}
          </ul>
        </div>
        <div class="card-alert" style="background:#fff7ed; border-color:#fed7aa; color:#9a3412; font-size:0.85em;">
          <strong>Aviso:</strong> Clientes serão importados como "Ativos". Débitos e Comodatos serão zerados conforme regra de segurança.
        </div>
      </div>
    `;

    openModal('Confirmar Importação de Clientes', modalBody, async () => {
      await confirmarImportacaoClientes(data);
      return true;
    });

  } catch (e) {
    console.error('Erro ao processar arquivo:', e);
    alert('Erro ao ler o arquivo JSON. Verifique se o formato está correto.');
  }
}

async function confirmarImportacaoClientes(data) {
  const todosExistentes = await idbGetAll('clientes');
  let importados = 0;
  let atualizados = 0;
  let ignorados = 0;

  for (const c of data.clientes) {
    // Garantir campos obrigatórios e sanitização
    const clienteParaImportar = {
      ...c,
      situacao: 'Ativo', // Regra: entra como ativo
      debitoTotal: 0,     // Regra: zera financeiro
      garrafoesEmprestados: 0 // Regra: zera comodato
    };

    // 1. Verificar por ID exato
    const existentePorId = todosExistentes.find(x => x.id === c.id);
    if (existentePorId) {
      const acao = confirm(`O cliente "${c.nome}" (ID: ${c.id}) já existe nesta rota.\n\nDeseja ATUALIZAR o cadastro existente com os dados do arquivo (incluindo GPS)?\n\n[OK] para Atualizar / [Cancelar] para Manter atual.`);
      if (acao) {
        await idbPut('clientes', clienteParaImportar);
        atualizados++;
      } else {
        ignorados++;
      }
      continue;
    }

    // 2. Verificar duplicidade por nome ou telefone
    const nomeNormal = (c.nome || '').toLowerCase().trim();
    const telNormal = (c.telefone || '').replace(/\D/g, '');
    
    const duplicado = todosExistentes.find(x => {
      const xNome = (x.nome || '').toLowerCase().trim();
      const xTel = (x.telefone || '').replace(/\D/g, '');
      return xNome === nomeNormal || (telNormal && xTel === telNormal);
    });

    if (duplicado) {
      const confirmDupe = confirm(`Possível duplicidade detectada!\n\nArquivo: ${c.nome} (${c.telefone || 'sem tel'})\nExistente: ${duplicado.nome} (${duplicado.telefone || 'sem tel'})\n\nDeseja importar mesmo assim como um NOVO cadastro?`);
      if (!confirmDupe) {
        ignorados++;
        continue;
      }
    }

    // 3. Importar novo
    await idbPut('clientes', clienteParaImportar);
    importados++;
  }

  toast('Processo de importação finalizado!');
  setTimeout(() => {
    alert(`Resumo da Importação:\n\n- Novos clientes: ${importados}\n- Clientes atualizados: ${atualizados}\n- Ignorados/Mantidos: ${ignorados}\n\nTotal processado: ${data.clientes.length}`);
    showConfiguracoes(); // Atualiza a tela
  }, 500);
}
