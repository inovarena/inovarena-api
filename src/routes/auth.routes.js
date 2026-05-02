const express = require('express');
const { auth, db } = require('../firebase-admin');
const { gerarLicencaOffline } = require('../services/license.service');

const router = express.Router();

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function montarRespostaLicenca({
  uid,
  email,
  fingerprint,
  licencaAtiva,
  validade,
  plano,
  diasOfflinePermitidos,
  maxDispositivos,
  dispositivos,
  cliente,
  nome,
}) {
  let signedLicense = null;

  try {
    signedLicense = gerarLicencaOffline({
      uid,
      email,
      plano,
      validade,
      fingerprint,
      diasOfflinePermitidos,
      cliente,
      nome,
      licencaAtiva,
      maxDispositivos,
    });
  } catch (error) {
    console.error('[auth] assinatura offline indisponivel:', error && error.message ? error.message : error);
  }

  return {
    licenca_ativa: licencaAtiva,
    validade,
    plano,
    dias_offline_permitidos: diasOfflinePermitidos,
    max_dispositivos: maxDispositivos,
    dispositivos,
    cliente,
    nome,
    offlineValidUntil: signedLicense ? signedLicense.offlineValidUntil : null,
    signedLicense: signedLicense ? {
      payload: signedLicense.payload,
      signature: signedLicense.signature,
    } : null,
  };
}
async function carregarUsuarioLicenca(uid) {
  const userRecord = await auth.getUser(uid);
  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    return {
      notFound: true,
      userRecord,
      userRef,
      userData: null,
    };
  }

  return {
    notFound: false,
    userRecord,
    userRef,
    userData: userDoc.data(),
  };
}

function extrairDadosLicenca(userData) {
  return {
    licencaAtiva: userData.licenca_ativa ?? false,
    plano: userData.plano ?? null,
    validade: userData.validade ?? null,
    diasOfflinePermitidos: userData.dias_offline_permitidos ?? 7,
    maxDispositivos: userData.max_dispositivos ?? 1,
    cliente: userData.cliente ?? 'default',
    nome: userData.nome ?? '',
  };
}

function normalizarNomeDispositivo(nome) {
  const valor = typeof nome === 'string' ? nome.trim() : '';
  return valor ? valor.substring(0, 80) : '';
}

function isNomeDispositivoGenerico(nome) {
  return /^dispositivo\s+\d+$/i.test(String(nome || '').trim());
}

function normalizarChaveNomeDispositivo(nome) {
  return normalizarNomeDispositivo(nome).toLowerCase();
}

function extrairDispositivos(userData) {
  return Array.isArray(userData.dispositivos)
    ? userData.dispositivos.filter((item) => item && typeof item === 'object' && item.id)
    : [];
}

function encontrarDispositivoPorNome(dispositivos, nomeDispositivo) {
  const nomeChave = normalizarChaveNomeDispositivo(nomeDispositivo);
  if (!nomeChave) return null;

  return dispositivos.find((item) => {
    if (!item || !item.nome || isNomeDispositivoGenerico(item.nome)) return false;
    return normalizarChaveNomeDispositivo(item.nome) === nomeChave;
  }) || null;
}

function anexarIdAnterior(dispositivo, idAnterior) {
  if (!dispositivo || !idAnterior || dispositivo.id === idAnterior) return;
  const anteriores = Array.isArray(dispositivo.ids_anteriores)
    ? dispositivo.ids_anteriores.filter(Boolean)
    : [];
  if (!anteriores.includes(idAnterior)) anteriores.push(idAnterior);
  dispositivo.ids_anteriores = anteriores.slice(-5);
}

function reconciliarDispositivo({
  dispositivos,
  fingerprint,
  nomeDispositivo,
  hoje,
  maxDispositivos,
  permitirCriar,
}) {
  let alterado = false;
  let dispositivoAtual = dispositivos.find((item) => item.id === fingerprint) || null;
  const nomeChave = normalizarChaveNomeDispositivo(nomeDispositivo);

  if (!dispositivoAtual && nomeChave) {
    const dispositivoMesmoNome = encontrarDispositivoPorNome(dispositivos, nomeDispositivo);
    if (dispositivoMesmoNome) {
      anexarIdAnterior(dispositivoMesmoNome, dispositivoMesmoNome.id);
      dispositivoMesmoNome.id = fingerprint;
      dispositivoAtual = dispositivoMesmoNome;
      alterado = true;
    }
  }

  if (dispositivoAtual) {
    if (dispositivoAtual.ultimo_acesso !== hoje) {
      dispositivoAtual.ultimo_acesso = hoje;
      alterado = true;
    }

    if (nomeDispositivo && (!dispositivoAtual.nome || isNomeDispositivoGenerico(dispositivoAtual.nome))) {
      dispositivoAtual.nome = nomeDispositivo;
      alterado = true;
    }

    for (let i = dispositivos.length - 1; i >= 0; i -= 1) {
      const item = dispositivos[i];
      if (!item || item === dispositivoAtual) continue;

      const mesmoId = item.id === fingerprint;
      const mesmoNome = nomeChave && item.nome && !isNomeDispositivoGenerico(item.nome)
        && normalizarChaveNomeDispositivo(item.nome) === nomeChave;

      if (mesmoId || mesmoNome) {
        anexarIdAnterior(dispositivoAtual, item.id);
        if (!dispositivoAtual.registrado_em && item.registrado_em) {
          dispositivoAtual.registrado_em = item.registrado_em;
        }
        dispositivos.splice(i, 1);
        alterado = true;
      }
    }

    return { dispositivoAtual, alterado, limiteAtingido: false };
  }

  if (!permitirCriar) {
    return { dispositivoAtual: null, alterado: false, limiteAtingido: false };
  }

  if (dispositivos.length >= maxDispositivos) {
    return { dispositivoAtual: null, alterado: false, limiteAtingido: true };
  }

  dispositivoAtual = {
    id: fingerprint,
    nome: nomeDispositivo || `Dispositivo ${dispositivos.length + 1}`,
    registrado_em: hoje,
    ultimo_acesso: hoje
  };
  dispositivos.push(dispositivoAtual);

  return { dispositivoAtual, alterado: true, limiteAtingido: false };
}

function isErroConfiguracaoLicenca(error) {
  return error && (
    error.code === 'LICENSE_PRIVATE_KEY_MISSING' ||
    error.code === 'LICENSE_SIGN_FAILED' ||
    /LICENSE_PRIVATE_KEY/i.test(error.message || '') ||
    /PEM|key|decoder|unsupported/i.test(error.message || '')
  );
}

function responderErroAuth(res, error, contexto) {
  const code = error && error.code ? String(error.code) : '';
  const message = error && error.message ? String(error.message) : '';
  console.error(`[auth] ${contexto}:`, code || 'NO_CODE', message || error);

  if (isErroConfiguracaoLicenca(error)) {
    return res.status(503).json({
      success: false,
      message: 'Falha na configuracao da licenca offline. Verifique LICENSE_PRIVATE_KEY no backend.',
      code: 'LICENSE_CONFIG_ERROR'
    });
  }

  if (code.startsWith('auth/') || /Firebase ID token|verifyIdToken|Decoding Firebase/i.test(message)) {
    return res.status(401).json({
      success: false,
      message: 'Sessao Firebase invalida. Verifique se o app e o backend usam o mesmo projeto Firebase.',
      code: 'FIREBASE_TOKEN_ERROR'
    });
  }

  if (/Firestore|deadline|unavailable|credential|service account/i.test(message)) {
    return res.status(503).json({
      success: false,
      message: 'Falha ao acessar Firebase/Firestore no backend.',
      code: 'FIREBASE_BACKEND_ERROR'
    });
  }

  return res.status(500).json({
    success: false,
    message: contexto === 'check' ? 'Erro ao validar licenca' : 'Erro ao validar sessao',
    code: 'AUTH_SESSION_ERROR'
  });
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
    const { idToken, fingerprint, nomeMaquina, deviceName, hostname } = req.body;

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

    const { notFound, userRecord, userRef, userData } = await carregarUsuarioLicenca(uid);

    if (notFound) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado no Firestore'
      });
    }

    const {
      licencaAtiva,
      plano,
      validade,
      diasOfflinePermitidos,
      maxDispositivos,
      cliente,
      nome,
    } = extrairDadosLicenca(userData);

    if (!licencaAtiva) {
      return res.status(403).json({
        success: false,
        message: 'Licença inativa'
      });
    }

    const dispositivos = extrairDispositivos(userData);
    const nomeDispositivo = normalizarNomeDispositivo(nomeMaquina || deviceName || hostname);
    const hoje = getToday();

    const resultadoDispositivo = reconciliarDispositivo({
      dispositivos,
      fingerprint,
      nomeDispositivo,
      hoje,
      maxDispositivos,
      permitirCriar: true,
    });

    if (resultadoDispositivo.limiteAtingido) {
      return res.status(403).json({
        success: false,
        message: `Limite de dispositivos atingido (${maxDispositivos})`
      });
    }

    if (resultadoDispositivo.alterado) {
      await userRef.update({ dispositivos });
    }

    const license = montarRespostaLicenca({
      uid,
      email: userRecord.email || null,
      fingerprint,
      licencaAtiva,
      validade,
      plano,
      diasOfflinePermitidos,
      maxDispositivos,
      dispositivos,
      cliente,
      nome,
    });

    return res.json({
      success: true,
      user: {
        uid: userRecord.uid,
        email: userRecord.email || null,
        displayName: userRecord.displayName || null
      },
      license,
      offline_license: license.signedLicense
    });
  } catch (error) {
    return responderErroAuth(res, error, 'session');
  }
});

router.post('/check', async (req, res) => {
  try {
    const { idToken, fingerprint, nomeMaquina, deviceName, hostname } = req.body;

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

    const { notFound, userRecord, userRef, userData } = await carregarUsuarioLicenca(uid);

    if (notFound) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado no Firestore'
      });
    }

    const {
      licencaAtiva,
      plano,
      validade,
      diasOfflinePermitidos,
      maxDispositivos,
      cliente,
      nome,
    } = extrairDadosLicenca(userData);

    if (!licencaAtiva) {
      return res.status(403).json({
        success: false,
        message: 'Licença inativa'
      });
    }

    const dispositivos = extrairDispositivos(userData);
    const nomeDispositivo = normalizarNomeDispositivo(nomeMaquina || deviceName || hostname);
    const hoje = getToday();
    const resultadoDispositivo = reconciliarDispositivo({
      dispositivos,
      fingerprint,
      nomeDispositivo,
      hoje,
      maxDispositivos,
      permitirCriar: false,
    });

    if (!resultadoDispositivo.dispositivoAtual) {
      return res.status(403).json({
        success: false,
        message: 'Dispositivo não autorizado'
      });
    }

    if (resultadoDispositivo.alterado) {
      await userRef.update({ dispositivos });
    }

    const license = montarRespostaLicenca({
      uid,
      email: userRecord.email || null,
      fingerprint,
      licencaAtiva,
      validade,
      plano,
      diasOfflinePermitidos,
      maxDispositivos,
      dispositivos,
      cliente,
      nome,
    });

    return res.json({
      success: true,
      license
    });
  } catch (error) {
    return responderErroAuth(res, error, 'check');
  }
});

module.exports = router;


