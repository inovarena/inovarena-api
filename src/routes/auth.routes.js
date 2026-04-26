const express = require('express');
const { auth, db } = require('../firebase-admin');

const router = express.Router();

function getToday() {
  return new Date().toISOString().split('T')[0];
}

router.get('/test-user/:uid', async (req, res) => {
  try {
    const { uid } = req.params;

    if (!uid) {
      return res.status(400).json({
        success: false,
        message: 'UID é obrigatório'
      });
    }

    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado no Firestore'
      });
    }

    return res.json({
      success: true,
      uid,
      data: userDoc.data()
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar usuário no Firestore',
      error: error.message
    });
  }
});

router.post('/session', async (req, res) => {
  try {
    const { idToken, fingerprint } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: 'idToken é obrigatório'
      });
    }

    if (!fingerprint || !String(fingerprint).trim()) {
      return res.status(400).json({
        success: false,
        message: 'fingerprint é obrigatório'
      });
    }

    const decodedToken = await auth.verifyIdToken(idToken);
    const uid = decodedToken.uid;

    const userRecord = await auth.getUser(uid);
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado no Firestore'
      });
    }

    const userData = userDoc.data();

    const licencaAtiva = userData.licenca_ativa ?? false;
    const plano = userData.plano ?? null;
    const validade = userData.validade ?? null;
    const diasOfflinePermitidos = userData.dias_offline_permitidos ?? 7;
    const maxDispositivos = userData.max_dispositivos ?? 1;
    const cliente = userData.cliente ?? 'default';
    const nome = userData.nome ?? '';

    if (!licencaAtiva) {
      return res.status(403).json({
        success: false,
        message: 'Licença inativa'
      });
    }

    const dispositivos = Array.isArray(userData.dispositivos)
      ? userData.dispositivos.filter((item) => item && typeof item === 'object' && item.id)
      : [];

    const hoje = getToday();

    let dispositivoAtual = dispositivos.find((item) => item.id === fingerprint);

    if (dispositivoAtual) {
      dispositivoAtual.ultimo_acesso = hoje;
    } else {
      if (dispositivos.length >= maxDispositivos) {
        return res.status(403).json({
          success: false,
          message: `Limite de dispositivos atingido (${maxDispositivos})`
        });
      }

      dispositivoAtual = {
        id: fingerprint,
        nome: `Dispositivo ${dispositivos.length + 1}`,
        registrado_em: hoje,
        ultimo_acesso: hoje
      };

      dispositivos.push(dispositivoAtual);
    }

    await userRef.update({ dispositivos });

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
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao validar sessão',
      error: error.message
    });
  }
});


// ─── /auth/check — verifica se a licença ainda é válida ──────────────────────
// Recebe: { idToken, fingerprint }
// Retorna: status da licença sem re-registrar dispositivo
router.post('/check', async (req, res) => {
  try {
    const { idToken, fingerprint } = req.body;

    if (!idToken) {
      return res.status(400).json({ success: false, message: 'idToken é obrigatório' });
    }
    if (!fingerprint) {
      return res.status(400).json({ success: false, message: 'fingerprint é obrigatório' });
    }

    // Verifica o token com o Firebase
    const decodedToken = await auth.verifyIdToken(idToken);
    const uid = decodedToken.uid;

    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    }

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

    // Licença inativa
    if (!licencaAtiva) {
      return res.status(403).json({ success: false, message: 'Licença inativa' });
    }

    // Validade expirada
    if (validade) {
      const hoje     = new Date().toISOString().split('T')[0];
      const validadeDate = new Date(validade);
      const hojeDate    = new Date(hoje);
      if (validadeDate < hojeDate) {
        return res.status(403).json({ success: false, message: 'Licença expirada', validade });
      }
    }

    // Dispositivo autorizado
    const dispositivoAutorizado = dispositivos.some(d => d.id === fingerprint);
    if (!dispositivoAutorizado) {
      return res.status(403).json({
        success: false,
        message: 'Dispositivo não autorizado para esta licença'
      });
    }

    // Atualiza o último acesso do dispositivo
    const hoje = new Date().toISOString().split('T')[0];
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
    // Token expirado ou inválido
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ success: false, message: 'Token expirado — faça login novamente' });
    }
    return res.status(500).json({ success: false, message: 'Erro ao verificar licença', error: error.message });
  }
});

module.exports = router;
