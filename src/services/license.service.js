const jwt = require('jsonwebtoken');

const SECRET = process.env.LICENSE_SECRET || 'inovarena_licenca_secreta_2026';
const DIAS_OFFLINE_PADRAO = 7;

function gerarLicencaOffline({ uid, email, plano, validade, fingerprint, diasOfflinePermitidos, cliente, nome }) {
  const agora = Date.now();
  const dias = diasOfflinePermitidos ?? DIAS_OFFLINE_PADRAO;
  const offlineUntil = agora + dias * 24 * 60 * 60 * 1000;

  const payload = {
    uid,
    email,
    plano,
    validade,
    fingerprint,
    cliente,
    nome,
    issued_at: agora,
    offline_until: offlineUntil
  };

  const token = jwt.sign(payload, SECRET, { expiresIn: `${dias}d` });

  return {
    token,
    offline_until: new Date(offlineUntil).toISOString(),
    dias_offline_permitidos: dias
  };
}

function validarLicencaOffline(token, fingerprint) {
  try {
    const decoded = jwt.verify(token, SECRET);

    if (decoded.fingerprint !== fingerprint) {
      return { valida: false, motivo: 'Máquina não autorizada' };
    }

    if (Date.now() > decoded.offline_until) {
      return { valida: false, motivo: 'Licença offline expirada' };
    }

    return { valida: true, dados: decoded };
  } catch (error) {
    return { valida: false, motivo: 'Licença inválida ou corrompida' };
  }
}

module.exports = { gerarLicencaOffline, validarLicencaOffline };