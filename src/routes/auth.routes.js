const express = require('express');
const { auth, db } = require('../firebase-admin');
const { gerarLicencaOffline } = require('../services/license.service');

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
    const { idToken, fingerprint, nomeMaquina } = req.body;

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

    await userRef.update({ dispositivos });

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
    return res.status(500).json({
      success: false,
      message: 'Erro ao validar sessão',
      error: error.message
    });
  }
});

// ─── Atualizar nome do usuário ────────────────────────────────────────────────
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
    return res.status(500).json({
      success: false,
      message: 'Erro ao atualizar nome',
      error: error.message
    });
  }
});

module.exports = router;
