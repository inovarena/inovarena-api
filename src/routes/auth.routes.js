// ─── Patch node_modules (roda do %TEMP%, node_modules ficam no projeto) ─────
const _Mod = require('module');
const _fs3 = require('fs'); const _path3 = require('path');
const _pdir = (() => {
  if (process.argv[1]) { const p = _path3.dirname(process.argv[1]); if (_fs3.existsSync(_path3.join(p,'node_modules'))) return p; }
  if (process.resourcesPath && _fs3.existsSync(_path3.join(process.resourcesPath,'node_modules'))) return process.resourcesPath;
  return process.cwd();
})();
module.paths.unshift(..._Mod._nodeModulePaths(_pdir));
// ─────────────────────────────────────────────────────────────────────────────

// =============================================================================
// auth-routes.js — Rotas de autenticação Firebase e watchdog de sessão
// Recebe: { app, io, firebase }
// =============================================================================

function setupAuthRoutes({ app, io, firebase }) {
  const {
    login, logout, getLoginContext, loginUltimoAcessoOffline, getDadosUsuario, resetSenha, atualizarNome,
    verificarEmailCadastrado, iniciarWatchdogDispositivo, pararWatchdogDispositivo,
    getDispositivosFirestore, removerDispositivoPorId, db
  } = firebase;

  // Torna pararWatchdogDispositivo acessível dentro das rotas
  const _pararWatchdog = pararWatchdogDispositivo;
  const ROUTE_TIMEOUT_MS = 8000;

  function timeoutSignal(ms) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    timer.unref?.();
    return controller.signal;
  }

  function withTimeout(promise, ms, label = 'Operacao') {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} excedeu o tempo limite.`)), ms);
      timer.unref?.();
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  app.use(require('express').json());

  // ─── Login ────────────────────────────────────────────────────────────────────
  app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;
    if (!email)
      return res.status(400).json({ sucesso: false, erro: 'Email obrigatorio.' });
    try {
      const usuario = await login(email, senha);
      iniciarWatchdogDispositivo(usuario.uid, async (motivo) => {
        console.log('Watchdog callback disparado:', motivo);
        try { await logout(); } catch (e) { console.warn('Erro no logout do watchdog:', e.message); }
        io.emit('forcarLogout', { motivo });
      });
      res.json({ sucesso: true, usuario });
    } catch (err) {
      res.status(401).json({ sucesso: false, erro: err.message });
    }
  });

  // ─── Logout ───────────────────────────────────────────────────────────────────
  app.get('/api/login-context', async (req, res) => {
    try {
      const contexto = await getLoginContext();
      res.json({ sucesso: true, ...contexto });
    } catch (err) {
      res.status(500).json({ sucesso: false, erro: err.message });
    }
  });

  app.post('/api/login-ultimo-offline', async (req, res) => {
    try {
      const contexto = await getLoginContext();
      if (contexto.online) {
        return res.status(400).json({ sucesso: false, erro: 'Esse acesso rápido só funciona sem internet.' });
      }
      if (!contexto.podeEntrarOffline) {
        return res.status(401).json({ sucesso: false, erro: contexto.motivoOffline || 'Último acesso offline indisponível.' });
      }

      const usuario = await loginUltimoAcessoOffline();
      iniciarWatchdogDispositivo(usuario.uid, async (motivo) => {
        console.log('Watchdog callback disparado:', motivo);
        try { await logout(); } catch (e) { console.warn('Erro no logout do watchdog:', e.message); }
        io.emit('forcarLogout', { motivo });
      });
      res.json({ sucesso: true, usuario });
    } catch (err) {
      console.error('Falha no login:', err.message);
      res.status(401).json({ sucesso: false, erro: err.message });
    }
  });

  app.post('/api/logout', async (req, res) => {
    try {
      pararWatchdogDispositivo();
      await logout();
      res.json({ sucesso: true });
    } catch (err) {
      res.status(500).json({ sucesso: false, erro: err.message });
    }
  });

  // ─── Reset de senha ───────────────────────────────────────────────────────────
  app.post('/api/reset-senha', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.json({ sucesso: false, erro: 'E-mail obrigatorio.' });
    try {
      const cadastrado = await verificarEmailCadastrado(email);
      if (!cadastrado)
        return res.json({ sucesso: false, erro: 'E-mail nao encontrado em nossa base.' });
      await resetSenha(email);
      res.json({ sucesso: true });
    } catch (err) {
      console.warn('Reset de senha falhou:', err.message);
      res.json({ sucesso: false, erro: 'Nao foi possivel enviar o e-mail.' });
    }
  });

  // ─── Sessão ───────────────────────────────────────────────────────────────────
  app.get('/api/sessao', (req, res) => {
    const dados = getDadosUsuario();
    if (dados.uid) {
      const licenca = dados.licenca || {};
      res.json({
        logado: true, email: dados.email, nome: dados.nome || null, plano: licenca.plano || null,
        licenca: {
          licenca_ativa:           licenca.licenca_ativa           ?? null,
          validade:                licenca.validade                ?? null,
          plano:                   licenca.plano                   ?? null,
          dias_offline_permitidos: licenca.dias_offline_permitidos ?? 7,
          max_dispositivos:        licenca.max_dispositivos        ?? 1,
          dispositivos:            licenca.dispositivos            ?? [],
        }
      });
    } else {
      res.json({ logado: false });
    }
  });

  // ─── Atualizar nome ───────────────────────────────────────────────────────────
  app.post('/api/atualizar-nome', async (req, res) => {
    const { nome } = req.body;
    if (!nome || !nome.trim()) return res.json({ sucesso: false, erro: 'Nome invalido.' });
    const dados = getDadosUsuario();
    if (!dados.uid) return res.json({ sucesso: false, erro: 'Sessao invalida.' });
    try {
      await atualizarNome(dados.uid, nome.trim());
      res.json({ sucesso: true });
    } catch (err) {
      res.json({ sucesso: false, erro: 'Erro ao salvar nome.' });
    }
  });

  // ─── Dispositivos ─────────────────────────────────────────────────────────────
  app.get('/api/dispositivos', async (req, res) => {
    const dados = getDadosUsuario();
    if (!dados.uid) return res.status(401).json({ sucesso: false, erro: 'Nao autenticado.' });
    try {
      const resultado = await getDispositivosFirestore(dados.uid);
      res.json({ sucesso: true, ...resultado });
    } catch (err) {
      res.status(500).json({ sucesso: false, erro: err.message });
    }
  });

  // ─── Plano ────────────────────────────────────────────────────────────────────
  app.get('/api/plano', (req, res) => {
    const dados = getDadosUsuario();
    const plano = (dados.licenca && dados.licenca.plano) ? dados.licenca.plano.toLowerCase() : null;
    res.json({ plano });
  });

  // ─── Alterar e-mail ───────────────────────────────────────────────────────────
  app.post('/api/alterar-email', async (req, res) => {
    const { novoEmail, senha } = req.body;
    if (!novoEmail || !senha)
      return res.status(400).json({ sucesso: false, erro: 'Dados incompletos.' });
    try {
      const { auth } = firebase;
      const { updateEmail, reauthenticateWithCredential, EmailAuthProvider } = require('firebase/auth');
      const usuario = auth.currentUser;
      if (!usuario) return res.status(401).json({ sucesso: false, erro: 'Nao autenticado.' });
      const credencial = EmailAuthProvider.credential(usuario.email, senha);
      await withTimeout(reauthenticateWithCredential(usuario, credencial), ROUTE_TIMEOUT_MS, 'Reautenticacao');
      await withTimeout(updateEmail(usuario, novoEmail), ROUTE_TIMEOUT_MS, 'Atualizacao de email');
      res.json({ sucesso: true });
    } catch (err) {
      const msgs = {
        'auth/wrong-password':        'Senha incorreta.',
        'auth/email-already-in-use':  'Este e-mail ja esta em uso.',
        'auth/invalid-email':         'E-mail invalido.',
        'auth/requires-recent-login': 'Faca login novamente antes de alterar o e-mail.',
      };
      res.status(400).json({ sucesso: false, erro: msgs[err.code] || err.message });
    }
  });

  // ─── Remover dispositivo ──────────────────────────────────────────────────────
  app.post('/api/remover-dispositivo', async (req, res) => {
    const { fingerprintId } = req.body;
    if (!fingerprintId)
      return res.status(400).json({ sucesso: false, erro: 'ID nao informado.' });
    try {
      const dados = getDadosUsuario();
      if (!dados.uid) return res.status(401).json({ sucesso: false, erro: 'Nao autenticado.' });

      const licenca         = dados.licenca || {};
      const meuFingerprint  = licenca.fingerprint || null;
      const esteDispositivo = meuFingerprint !== null && meuFingerprint === fingerprintId;

      console.log('Removendo dispositivo:', fingerprintId, '| meu fingerprint:', meuFingerprint, '| esteDispositivo:', esteDispositivo);

      await removerDispositivoPorId(dados.uid, fingerprintId);

      if (esteDispositivo) {
        _pararWatchdog();
        await logout();
        return res.json({ sucesso: true, deslogar: true });
      }
      return res.json({ sucesso: true, deslogar: false });
    } catch (err) {
      console.error('Erro ao remover dispositivo:', err.message);
      return res.status(500).json({ sucesso: false, erro: err.message });
    }
  });

  // ─── Watchdog por polling (backup — 5 min) ────────────────────────────────────
  async function verificarSessaoAtiva() {
    try {
      const dados = getDadosUsuario();
      if (!dados.uid) return;
      const licenca     = dados.licenca || {};
      const fingerprint = licenca.fingerprint;

      try { await fetch('https://www.google.com', { method: 'HEAD', cache: 'no-store', signal: timeoutSignal(1500) }); }
      catch { return; }

      const docSnap = await db.collection('users').doc(dados.uid).get();
      if (!docSnap.exists) {
        await logout();
        io.emit('forcarLogout', { motivo: 'Usuario nao encontrado. Faca login novamente.' });
        return;
      }

      const d = docSnap.data();
      if (!d.licenca_ativa) {
        await logout();
        io.emit('forcarLogout', { motivo: 'Sua licenca foi desativada. Entre em contato com o suporte.' });
        return;
      }

      if (d.validade) {
        const [ano, mes, dia] = d.validade.split('-').map(Number);
        const validade = new Date(ano, mes - 1, dia);
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        if (validade < hoje) {
          await logout();
          io.emit('forcarLogout', { motivo: 'Sua licenca expirou. Renove para continuar.' });
          return;
        }
      }

      if (fingerprint) {
        const dispositivos = d.dispositivos || [];
        if (!dispositivos.some(x => x.id === fingerprint)) {
          await logout();
          io.emit('forcarLogout', { motivo: 'Este dispositivo foi removido da conta.' });
        }
      }
    } catch (err) {
      console.warn('Watchdog erro:', err.message);
    }
  }

  setTimeout(verificarSessaoAtiva, 5000);
  setInterval(verificarSessaoAtiva, 20 * 1000);
}

module.exports = { setupAuthRoutes };
