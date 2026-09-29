// ============================================================
// backup.js — AutoBackup Inteligente v9.4
// Módulo independente de segurança de dados
// Carregado ANTES do app.js
// Comentários em português |// Marcado com // === v4.8 ALTERAÇÃO ===/ ============================================================

// === v4.7 ALTERAÇÃO ===
(function () {
  'use strict';

  // ─────────────────────────────────────────────
  // CONSTANTES DE CONFIGURAÇÃO
  // ─────────────────────────────────────────────

  /** Nome do banco IndexedDB compartilhado com o app principal */
  const DB_NAME = 'aguaLirios_clientes_db';

  /** Versão do banco — v9.0 SINCRONIZAÇÃO: atualizado para 6 para igualar ao app.js */
  const DB_VERSION = 6;

  /** Máximo de dias de backup diário a manter (rotação automática) */
  const MAX_DIAS_BACKUP = 10;

  /** Máximo de snapshots críticos a manter na store backup_snapshots */
  const MAX_SNAPSHOTS = 50;

  /** Horários (horas) para snapshots automáticos ao longo do dia */
  const HORARIOS_AUTO = [9, 12, 15, 18];

  /** Referência ao banco IndexedDB após abertura */
  let backupDb = null;

  /** Flag para evitar múltiplos backups simultâneos */
  let _backupEmAndamento = false;

  // ─────────────────────────────────────────────
  // ABERTURA / UPGRADE DO BANCO
  // ─────────────────────────────────────────────

  /**
   * Abre o banco IndexedDB compartilhado e adiciona as stores de backup
   * sem remover as stores existentes (clientes, vales_pendentes).
   * @returns {Promise<IDBDatabase>}
   */
  function abrirBancoBackup() {
    return new Promise((resolve, reject) => {
      // Solicita abertura na versão 2 para acionar onupgradeneeded
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (event) => {
        const db = event.target.result;

        // === v9.0 SINCRONIZAÇÃO === Criar todas as stores do app.js e do backup.js
        if (!db.objectStoreNames.contains('clientes')) db.createObjectStore('clientes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('vales_pendentes')) db.createObjectStore('vales_pendentes', { keyPath: 'id' });
        
        if (!db.objectStoreNames.contains('fechamentos')) {
          const fStore = db.createObjectStore('fechamentos', { keyPath: 'id' });
          fStore.createIndex('por_data', 'data', { unique: true });
        }
        
        if (!db.objectStoreNames.contains('pontos_rota')) {
          const pStore = db.createObjectStore('pontos_rota', { keyPath: 'id' });
          pStore.createIndex('por_data', 'ts', { unique: false });
        }
        
        if (!db.objectStoreNames.contains('pontos_cadastrados')) {
          const pcStore = db.createObjectStore('pontos_cadastrados', { keyPath: 'id' });
          pcStore.createIndex('por_distribuidora', 'distribuidora', { unique: false });
          pcStore.createIndex('por_ativo', 'ativo', { unique: false });
        }
        
        if (!db.objectStoreNames.contains('acoes_ponto')) {
          const apStore = db.createObjectStore('acoes_ponto', { keyPath: 'id' });
          apStore.createIndex('por_ponto', 'pontoId', { unique: false });
          apStore.createIndex('por_data', 'ts', { unique: false });
        }
        
        if (!db.objectStoreNames.contains('comodato_movimentos')) {
          const cmStore = db.createObjectStore('comodato_movimentos', { keyPath: 'id' });
          cmStore.createIndex('por_cliente', 'clientId', { unique: false });
          cmStore.createIndex('por_data', 'ts', { unique: false });
        }

        // Stores exclusivas do módulo de backup
        if (!db.objectStoreNames.contains('backup_snapshots')) {
          const snapStore = db.createObjectStore('backup_snapshots', { keyPath: 'id' });
          snapStore.createIndex('por_data', 'ts', { unique: false });
        }
        if (!db.objectStoreNames.contains('backup_diarios')) {
          const diariosStore = db.createObjectStore('backup_diarios', { keyPath: 'id' });
          diariosStore.createIndex('por_data', 'data', { unique: false });
        }
      };

      req.onsuccess = (event) => {
        backupDb = event.target.result;
        resolve(backupDb);
      };

      req.onerror = () => reject(req.error);
    });
  }

  // ─────────────────────────────────────────────
  // HELPERS INTERNOS
  // ─────────────────────────────────────────────

  /**
   * Retorna a data atual no formato YYYY-MM-DD
   * @returns {string}
   */
  function dataHoje() {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Retorna a hora atual no formato HH-MM
   * @returns {string}
   */
  function horaAgora() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}-${mm}`;
  }

  /**
   * Coleta todos os dados do localStorage que começam com o prefixo do app
   * @returns {Object}
   */
  function coletarLocalStorage() {
    const dados = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('aguaLirios_')) {
        try {
          const raw = localStorage.getItem(key);
          dados[key] = JSON.parse(raw);
        } catch (e) {
          dados[key] = localStorage.getItem(key);
        }
      }
    }
    return dados;
  }

  /**
   * Coleta todos os registros de uma store do IndexedDB
   * @param {string} storeName
   * @returns {Promise<Array>}
   */
  function idbGetAllBackup(storeName) {
    return new Promise((resolve) => {
      if (!backupDb || !backupDb.objectStoreNames.contains(storeName)) {
        resolve([]);
        return;
      }
      try {
        const tx = backupDb.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  /**
   * Insere ou atualiza um registro em uma store do IndexedDB
   * @param {string} storeName
   * @param {Object} value
   * @returns {Promise<void>}
   */
  function idbPutBackup(storeName, value) {
    return new Promise((resolve, reject) => {
      if (!backupDb) { resolve(); return; }
      try {
        const tx = backupDb.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).put(value);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Exclui um registro de uma store pelo id
   * @param {string} storeName
   * @param {string} id
   * @returns {Promise<void>}
   */
  function idbDeleteBackup(storeName, id) {
    return new Promise((resolve) => {
      if (!backupDb) { resolve(); return; }
      try {
        const tx = backupDb.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  }

  /**
   * Coleta backup integral de todos os dados (localStorage + TODAS as stores do IndexedDB)
   * @returns {Promise<Object>}
   */
  async function coletarSnapshotCompleto() {
    const ls = coletarLocalStorage();
    const distribuidora = localStorage.getItem('aguaLirios_distribuidora_nome') || 'Distribuidora nao informada';
    
    const stores = Array.from(backupDb.objectStoreNames);
    const idbData = {};
    
    for (const storeName of stores) {
      idbData[storeName] = await idbGetAllBackup(storeName);
    }
    
    return {
      metadata: {
        sistema: "DistAgua Geo",
        versao: "V9.6",
        distribuidora: distribuidora,
        geradoEm: new Date().toISOString(),
        dbName: DB_NAME,
        dbVersion: DB_VERSION
      },
      localStorage: ls,
      indexedDB: idbData,
      // Legado para compatibilidade com versões que esperam root keys
      clientes: idbData['clientes'] || [],
      vales_pendentes: idbData['vales_pendentes'] || [],
      acoes_ponto: idbData['acoes_ponto'] || [],
      comodato_movimentos: idbData['comodato_movimentos'] || []
    };
  }

  // ─────────────────────────────────────────────
  // FUNÇÕES PÚBLICAS OBRIGATÓRIAS
  // ─────────────────────────────────────────────

  /**
   * === v4.7 ALTERAÇÃO ===
   * Inicializa o módulo de AutoBackup:
   * - Abre/atualiza o banco IndexedDB com as novas stores
   * - Agenda snapshots automáticos ao longo do dia
   * - Registra o evento beforeunload para snapshot de saída
   */
  async function initAutoBackup() {
    try {
      await abrirBancoBackup();
      console.log('[Backup v4.8] Banco inicializado com sucesso.');

      // Agenda snapshots automáticos nos horários configurados
      _agendarSnapshotsAutomaticos();

      // Snapshot ao sair da página
      window.addEventListener('beforeunload', () => {
        gerarSnapshotSaida();
      });

      console.log('[Backup v4.8] AutoBackup inicializado.');
    } catch (e) {
      console.warn('[Backup v4.8] Falha ao inicializar backup:', e);
    }
  }

  /**
   * === v4.7 ALTERAÇÃO ===
   * Gera um snapshot leve disparado por evento crítico do sistema.
   * Não bloqueia a UI — executa em background via setTimeout.
   * @param {string} origem - Identificador do evento (ex: "venda", "estoque")
   */
  function gerarSnapshotCritico(origem) {
    // Executa de forma assíncrona para não bloquear a UI
    setTimeout(async () => {
      if (!backupDb) return;
      try {
        const dados = await coletarSnapshotCompleto();
        const id = `critico_${origem}_${Date.now()}`;
        const snapshot = {
          id,
          tipo: 'critico',
          origem,
          ts: dados.ts,
          data: dataHoje(),
          dados
        };
        await idbPutBackup('backup_snapshots', snapshot);
        await _limitarSnapshots();
        console.log(`[Backup v4.8] Snapshot crítico salvo: ${id}`);
      } catch (e) {
        console.warn('[Backup v4.8] Falha no snapshot crítico:', e);
      }
    }, 0);
  }

  /**
   * === v4.7 ALTERAÇÃO ===
   * Gera snapshot ao sair da página (beforeunload).
   * Usa abordagem síncrona/leve para garantir execução antes do fechamento.
   */
  function gerarSnapshotSaida() {
    // Tenta salvar snapshot leve de saída (apenas localStorage, sem async IDB)
    try {
      const ls = coletarLocalStorage();
      const id = `saida_${Date.now()}`;
      const snapshot = {
        id,
        tipo: 'saida',
        origem: 'beforeunload',
        ts: new Date().toISOString(),
        data: dataHoje(),
        dados: { versao: 'v4.8', ts: new Date().toISOString(), localStorage: ls }
      };
      // Tenta salvar via IDB (pode não completar, mas é a melhor tentativa)
      if (backupDb) {
        const tx = backupDb.transaction('backup_snapshots', 'readwrite');
        tx.objectStore('backup_snapshots').put(snapshot);
      }
    } catch (e) {
      // Silencia erros no beforeunload para não impedir o fechamento
    }
  }

  /**
   * === v4.7 ALTERAÇÃO ===
   * Gera backup completo do dia e salva na store backup_diarios.
   * Deve ser chamado no fechamento do dia / conferência de caixa.
   * @returns {Promise<void>}
   */
  async function gerarBackupCompletoDia() {
    if (_backupEmAndamento) {
      console.log('[Backup v4.8] Backup já em andamento, aguardando...');
      return;
    }
    _backupEmAndamento = true;
    try {
      const dados = await coletarSnapshotCompleto();
      const hoje = dataHoje();
      const id = `backup_completo_${hoje}`;

      const backup = {
        id,
        tipo: 'diario',
        nome: `backup_completo_${hoje}.json`,
        data: hoje,
        ts: new Date().toISOString(),
        dados
      };

      await idbPutBackup('backup_diarios', backup);
      await aplicarRotacaoBackups();
      console.log(`[Backup v4.8] Backup diário salvo: ${id}`);
    } catch (e) {
      console.warn('[Backup v4.8] Falha no backup diário:', e);
    } finally {
      _backupEmAndamento = false;
    }
  }

  /**
   * === v4.7 ALTERAÇÃO ===
   * Aplica rotação automática: mantém apenas os últimos MAX_DIAS_BACKUP dias.
   * Remove os backups diários mais antigos automaticamente.
   * @returns {Promise<void>}
   */
  async function aplicarRotacaoBackups() {
    try {
      const todos = await idbGetAllBackup('backup_diarios');
      if (todos.length <= MAX_DIAS_BACKUP) return;

      // Ordena por data (mais antigo primeiro)
      todos.sort((a, b) => (a.data < b.data ? -1 : 1));

      // Remove os mais antigos além do limite
      const paraRemover = todos.slice(0, todos.length - MAX_DIAS_BACKUP);
      for (const item of paraRemover) {
        await idbDeleteBackup('backup_diarios', item.id);
        console.log(`[Backup v4.8] Backup antigo removido: ${item.id}`);
      }
    } catch (e) {
      console.warn('[Backup v4.8] Falha na rotação de backups:', e);
    }
  }

  /**
   * === v4.7 ALTERAÇÃO ===
   * Lista todos os backups disponíveis (snapshots + diários).
   * @returns {Promise<{snapshots: Array, diarios: Array}>}
   */
  async function listarBackups() {
    try {
      const snapshots = await idbGetAllBackup('backup_snapshots');
      const diarios = await idbGetAllBackup('backup_diarios');

      // Ordena por data decrescente (mais recente primeiro)
      snapshots.sort((a, b) => (a.ts > b.ts ? -1 : 1));
      diarios.sort((a, b) => (a.data > b.data ? -1 : 1));

      return { snapshots, diarios };
    } catch (e) {
      console.warn('[Backup v4.8] Falha ao listar backups:', e);
      return { snapshots: [], diarios: [] };
    }
  }

  /**
   * === v9.1 ALTERAÇÃO ===
   * Restaura dados a partir de um objeto de backup completo (JSON).
   * @param {Object} payload - Objeto de backup completo
   * @returns {Promise<Object>} - Resultado da restauração
   */
  async function restaurarBackupIntegral(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Formato de backup inválido.');
    }

    const resultado = {
      localStorage: { total: 0, restaurados: 0, falhas: [] },
      indexedDB: { total: 0, restaurados: 0, falhas: [] },
      detalhes: []
    };

    try {
      // 1. Snapshot de segurança antes de restaurar
      await gerarSnapshotCritico('antes_restauracao');

      // 2. Restaurar LocalStorage
      const dadosLS = payload.localStorage || {};
      Object.keys(dadosLS).forEach(key => {
        resultado.localStorage.total++;
        try {
          const val = dadosLS[key];
          localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
          resultado.localStorage.restaurados++;
        } catch (e) {
          resultado.localStorage.falhas.push(key);
        }
      });

      // 3. Restaurar IndexedDB
      const dadosIDB = payload.indexedDB || {};
      
      // Mapear também root keys para compatibilidade com backups v8/v9.0.1
      const rootKeys = ['clientes', 'vales_pendentes', 'fechamentos', 'acoes_ponto', 'comodato_movimentos', 'pontos_cadastrados', 'pontos_rota'];
      rootKeys.forEach(k => {
        if (payload[k] && !dadosIDB[k]) dadosIDB[k] = payload[k];
      });

      const storesExistentes = Array.from(backupDb.objectStoreNames);
      for (const storeName of Object.keys(dadosIDB)) {
        if (!storesExistentes.includes(storeName)) {
          resultado.detalhes.push(`Store '${storeName}' ignorada (não existe no banco atual).`);
          continue;
        }

        const registros = dadosIDB[storeName];
        if (!Array.isArray(registros)) continue;

        resultado.indexedDB.total++;
        try {
          await new Promise((resolve, reject) => {
            const tx = backupDb.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            store.clear();
            registros.forEach(item => store.put(item));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
          resultado.indexedDB.restaurados++;
          resultado.detalhes.push(`Store '${storeName}': ${registros.length} registros restaurados.`);
        } catch (e) {
          resultado.indexedDB.falhas.push(storeName);
          resultado.detalhes.push(`Erro na store '${storeName}': ${e.message}`);
        }
      }

      return resultado;
    } catch (e) {
      console.error('[Backup v9.1] Falha catastrófica na restauração:', e);
      throw e;
    }
  }

  /**
   * Restaura dados a partir de um snapshot ou backup diário pelo id.
   */
  async function restaurarBackup(id) {
    try {
      const snapshots = await idbGetAllBackup('backup_snapshots');
      const diarios = await idbGetAllBackup('backup_diarios');
      const todos = [...snapshots, ...diarios];
      const backup = todos.find((b) => b.id === id);

      if (!backup || !backup.dados) return false;
      const res = await restaurarBackupIntegral(backup.dados);
      return res.indexedDB.falhas.length === 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * === v4.7 ALTERAÇÃO ===
   * Exporta o backup mais recente como arquivo .json para download.
   * Se não houver backup diário, gera um completo na hora.
   * @returns {Promise<void>}
   */
  async function exportarBackupCompleto() {
    try {
      // Tenta pegar o backup diário mais recente
      const diarios = await idbGetAllBackup('backup_diarios');
      diarios.sort((a, b) => (a.data > b.data ? -1 : 1));

      let payload;
      let nomeArquivo;

      if (diarios.length > 0) {
        payload = diarios[0].dados;
        nomeArquivo = diarios[0].nome || `backup_completo_${dataHoje()}.json`;
      } else {
        // Gera snapshot completo na hora
        payload = await coletarSnapshotCompleto();
        nomeArquivo = `backup_completo_${dataHoje()}.json`;
      }

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nomeArquivo;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);

      console.log(`[Backup v4.8] Backup exportado: ${nomeArquivo}`);
    } catch (e) {
      console.warn('[Backup v4.8] Falha ao exportar backup:', e);
    }
  }

  // ─────────────────────────────────────────────
  // FUNÇÕES INTERNAS AUXILIARES
  // ─────────────────────────────────────────────

  /**
   * Limita o número de snapshots críticos/automáticos a MAX_SNAPSHOTS.
   * Remove os mais antigos quando o limite é atingido.
   * @returns {Promise<void>}
   */
  async function _limitarSnapshots() {
    try {
      const todos = await idbGetAllBackup('backup_snapshots');
      if (todos.length <= MAX_SNAPSHOTS) return;

      todos.sort((a, b) => (a.ts < b.ts ? -1 : 1));
      const paraRemover = todos.slice(0, todos.length - MAX_SNAPSHOTS);
      for (const item of paraRemover) {
        await idbDeleteBackup('backup_snapshots', item.id);
      }
    } catch (e) {
      // Silencia erros internos de limpeza
    }
  }

  /**
   * Agenda snapshots automáticos nos horários definidos em HORARIOS_AUTO.
   * Verifica a cada minuto se é hora de gerar um snapshot.
   * Exemplo de id gerado: auto_bkp_2026-04-13_09-00
   */
  function _agendarSnapshotsAutomaticos() {
    // Verifica imediatamente e depois a cada minuto
    _verificarHorarioAuto();
    setInterval(_verificarHorarioAuto, 60 * 1000);
  }

  /**
   * Verifica se o horário atual corresponde a um dos horários automáticos
   * e gera o snapshot se ainda não foi gerado nesta hora.
   */
  async function _verificarHorarioAuto() {
    if (!backupDb) return;
    const agora = new Date();
    const hora = agora.getHours();
    const minuto = agora.getMinutes();

    // Só dispara no minuto 0 de cada hora configurada
    if (minuto !== 0) return;
    if (!HORARIOS_AUTO.includes(hora)) return;

    const horaFormatada = String(hora).padStart(2, '0') + '-00';
    const id = `auto_bkp_${dataHoje()}_${horaFormatada}`;

    // Verifica se já existe snapshot para este horário
    const existentes = await idbGetAllBackup('backup_snapshots');
    if (existentes.find((s) => s.id === id)) return;

    try {
      const dados = await coletarSnapshotCompleto();
      const snapshot = {
        id,
        tipo: 'automatico',
        origem: `auto_${horaFormatada}`,
        ts: dados.ts,
        data: dataHoje(),
        dados
      };
      await idbPutBackup('backup_snapshots', snapshot);
      await _limitarSnapshots();
      console.log(`[Backup v4.8] Snapshot automático salvo: ${id}`);
    } catch (e) {
      console.warn('[Backup v4.8] Falha no snapshot automático:', e);
    }
  }

  // ─────────────────────────────────────────────
  // EXPOSIÇÃO GLOBAL
  // Todas as funções são expostas no objeto window.AutoBackup
  // para uso pelo app.js e pela interface de configurações
  // ─────────────────────────────────────────────

  // === v4.7 ALTERAÇÃO ===
  window.AutoBackup = {
    initAutoBackup,
    gerarSnapshotCritico,
    gerarSnapshotSaida,
    gerarBackupCompletoDia,
    aplicarRotacaoBackups,
    listarBackups,
    restaurarBackup,
    restaurarBackupIntegral,
    exportarBackupCompleto
  };

  // Atalhos globais para chamada direta no app.js
  window.gerarSnapshotCritico = gerarSnapshotCritico;
  window.gerarSnapshotSaida = gerarSnapshotSaida;
  window.gerarBackupCompletoDia = gerarBackupCompletoDia;
  window.exportarBackupCompleto = exportarBackupCompleto;
  window.listarBackups = listarBackups;
  window.restaurarBackup = restaurarBackup;
  window.restaurarBackupIntegral = restaurarBackupIntegral;
  window.gerarBackupCompleto = coletarSnapshotCompleto;

  console.log('[Backup v4.8] backup.js carregado.');
})();
