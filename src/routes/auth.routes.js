const express = require('express');
const { auth, db } = require('../firebase-admin');
const { gerarLicencaOffline } = require('../services/license.service');

const router = express.Router();

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function adicionarDias(dias) {
  const data = new Date();
  data.setDate(data.getDate() + dias);
  return data.toISOString().split('T')[0];
}

router.get('/test-user/:uid', async (req, res) => {
  try {
    const { uid } = req.params;

    if (!uid) {
      return res.status(400).json({ success: false, message: 'UID é obrigatório' });
    }

    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado no Firestore' });
    }

    return res.json({ success: true, uid, data: userDoc.data() });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao buscar usuário no Firestore', error: error.message });
  }
});

router.post('/session', async (req, res) => {
  try {
    const { idToken, fingerprint, nomeMaquina } = req.body;

    if (!idToken) {
      return res.status(400).json({ success: false, message: 'idToken é obrigatório' });
    }

    if (!fingerprint || !String(fingerprint).trim()) {
      return res.status(400).json({ success: false, message: 'fingerprint é obrigatório' });
    }

    const decodedToken = await auth.verifyIdToken(idToken);
    const uid = decodedToken.uid;

    const userRecord = await auth.getUser(uid);
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado no Firestore' });
    }

    const userData = userDoc.data();

    const licencaAtiva        = userData.licenca_ativa         ?? false;
    const plano               = userData.plano                  ?? null;
    const diasOfflinePermitidos = userData.dias_offline_permitidos ?? 7;
    const maxDispositivos     = userData.max_dispositivos       ?? 1;
    const cliente             = userData.cliente                ?? 'default';
    const nome                = userData.nome                   ?? '';

    // ─── Licença inativa ─────────────────────────────────────────────────────
    if (!licencaAtiva) {
      return res.status(403).json({ success: false, message: 'Licença inativa' });
    }

    // ─── Validade automática ──────────────────────────────────────────────────
    // Se não tem validade → primeiro login → define hoje + dias_offline_permitidos
    // Se já tem validade → respeita o que está no Firestore (contrato fechado)
    let validade = userData.validade ?? null;
    const atualizacoes = {};

    if (!validade) {
      validade = adicionarDias(diasOfflinePermitidos);
      atualizacoes.validade = validade;
      console.log(`[${uid}] Validade definida automaticamente: ${validade}`);
    }

    // ─── Verifica se expirou ──────────────────────────────────────────────────
    const hoje = getToday();
    if (new Date(validade) < new Date(hoje)) {
      // Desativa automaticamente a licença expirada
      await userRef.update({ licenca_ativa: false });
      console.log(`[${uid}] Licença expirada em ${validade} — licenca_ativa setada para false`);
      return res.status(403).json({
        success: false,
        message: 'Licença expirada',
        validade
      });
    }

    // ─── Dispositivos ─────────────────────────────────────────────────────────
    const dispositivos = Array.isArray(userData.dispositivos)
      ? userData.dispositivos.filter((item) => item && typeof item === 'object' && item.id)
      : [];

    let dispositivoAtual = dispositivos.find((item) => item.id === fingerprint);

    if (dispositivoAtual) {
      dispositivoAtual.ultimo_acesso = hoje;
      if (nomeMaquina) dispositivoAtual.nome = nomeMaquina;
    } else {
      if (dispositivos.length >= maxDispositivos) {
        return res.status(403).json({
          success: false,
          message: `Limite de dispositivos atingido (${maxDispositivos})`
        });
      }

      dispositivoAtual = {
        id: fingerprint,
        nome: nomeMaquina || `Dispositivo ${dispositivos.length + 1}`,
        registrado_em: hoje,
        ultimo_acesso: hoje
      };

      dispositivos.push(dispositivoAtual);
    }

    atualizacoes.dispositivos = dispositivos;
    await userRef.update(atualizacoes);

    const licencaOffline = gerarLicencaOffline({
      uid,
      email: userRecord.email || null,
      plano,
      validade,
      fingerprint,
      diasOfflinePermitidos,
      cliente,
      nome
    });

    return res.json({
      success: true,
      user: {
        uid: userRecord.uid,
        email: userRecord.email || null,
        displayName: userRecord.displayName || null
      },
      license: {
        licenca_ativa: licencaAtiva,
        validade,
        plano,
        dias_offline_permitidos: diasOfflinePermitidos,
        max_dispositivos: maxDispositivos,
        dispositivos,
        cliente,
        nome
      },
      offline_license: licencaOffline
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao validar sessão', error: error.message });
  }
});

// ─── /auth/check — verificação periódica ─────────────────────────────────────
router.post('/check', async (req, res) => {
  try {
    const { idToken, fingerprint } = req.body;

    if (!idToken) return res.status(400).json({ success: false, message: 'idToken é obrigatório' });
    if (!fingerprint) return res.status(400).json({ success: false, message: 'fingerprint é obrigatório' });

    const decodedToken = await auth.verifyIdToken(idToken);
    const uid = decodedToken.uid;

    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) return res.status(404).json({ success: false, message: 'Usuário não encontrado' });

    const userData = userDoc.data();

    const licencaAtiva        = userData.licenca_ativa         ?? false;
    const validade            = userData.validade               ?? null;
    const plano               = userData.plano                  ?? null;
    const diasOfflinePermitidos = userData.dias_offline_permitidos ?? 7;
    const maxDispositivos     = userData.max_dispositivos       ?? 1;
    const cliente             = userData.cliente                ?? 'default';
    const nome                = userData.nome                   ?? '';
    const dispositivos        = Array.isArray(userData.dispositivos)
      ? userData.dispositivos.filter(d => d && d.id)
      : [];

    if (!licencaAtiva) return res.status(403).json({ success: false, message: 'Licença inativa' });

    if (validade) {
      const hoje = getToday();
      if (new Date(validade) < new Date(hoje)) {
        // Desativa automaticamente a licença expirada
        await userRef.update({ licenca_ativa: false });
        console.log(`[${uid}] Licença expirada em ${validade} — licenca_ativa setada para false`);
        return res.status(403).json({ success: false, message: 'Licença expirada', validade });
      }
    }

    const dispositivoAutorizado = dispositivos.some(d => d.id === fingerprint);
    if (!dispositivoAutorizado) {
      return res.status(403).json({ success: false, message: 'Dispositivo não autorizado para esta licença' });
    }

    const hoje = getToday();
    const dispositivosAtualizados = dispositivos.map(d =>
      d.id === fingerprint ? { ...d, ultimo_acesso: hoje } : d
    );
    await userRef.update({ dispositivos: dispositivosAtualizados });

    return res.json({
      success: true,
      license: {
        licenca_ativa: licencaAtiva,
        validade,
        plano,
        dias_offline_permitidos: diasOfflinePermitidos,
        max_dispositivos: maxDispositivos,
        dispositivos: dispositivosAtualizados,
        cliente,
        nome
      }
    });

  } catch (error) {
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ success: false, message: 'Token expirado — faça login novamente' });
    }
    return res.status(500).json({ success: false, message: 'Erro ao verificar licença', error: error.message });
  }
});

// ─── /auth/update-name ────────────────────────────────────────────────────────
const { verifyToken } = require('../middleware/auth');

router.post('/update-name', verifyToken, async (req, res) => {
  try {
    const uid = req.uid;
    const { nome } = req.body;

    if (!nome || !nome.trim()) {
      return res.status(400).json({ success: false, message: 'Nome inválido' });
    }

    await db.collection('users').doc(uid).update({ nome: nome.trim() });
    return res.json({ success: true, nome: nome.trim() });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao atualizar nome', error: error.message });
  }
});

module.exports = router;
