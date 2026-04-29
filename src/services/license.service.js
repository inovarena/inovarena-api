const crypto = require('crypto');

const DIAS_OFFLINE_PADRAO = 7;

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function parseDateOnlyLocal(dateStr, fimDoDia = false) {
  if (!dateStr || typeof dateStr !== 'string') return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return null;

  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);

  return fimDoDia
    ? new Date(ano, mes - 1, dia, 23, 59, 59, 999)
    : new Date(ano, mes - 1, dia, 0, 0, 0, 0);
}

function buildOfflineValidUntil({ validade, diasOfflinePermitidos = DIAS_OFFLINE_PADRAO, now = new Date() }) {
  const byOfflineWindow = new Date(now.getTime() + diasOfflinePermitidos * 24 * 60 * 60 * 1000);
  const byLicenseExpiry = validade ? parseDateOnlyLocal(validade, true) : null;

  if (byLicenseExpiry) {
    return new Date(Math.min(byOfflineWindow.getTime(), byLicenseExpiry.getTime())).toISOString();
  }

  return byOfflineWindow.toISOString();
}

function getPrivateKey() {
  const privateKey = process.env.LICENSE_PRIVATE_KEY;
  if (!privateKey || !privateKey.trim()) {
    throw new Error('LICENSE_PRIVATE_KEY não configurada no ambiente.');
  }
  return privateKey.trim();
}

function signPayload(payload) {
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(stableStringify(payload), 'utf8'),
    getPrivateKey()
  );

  return {
    payload,
    signature: signature.toString('base64'),
  };
}

function buildLicensePayload({
  uid,
  email,
  plano,
  validade,
  fingerprint,
  diasOfflinePermitidos,
  cliente,
  nome,
  licencaAtiva = true,
  maxDispositivos = 1,
  now = new Date(),
}) {
  const dias = diasOfflinePermitidos ?? DIAS_OFFLINE_PADRAO;

  return {
    uid,
    email: email || null,
    plano: plano || null,
    validade: validade || null,
    fingerprint,
    cliente: cliente || 'default',
    nome: nome || '',
    licenca_ativa: !!licencaAtiva,
    dias_offline_permitidos: dias,
    max_dispositivos: maxDispositivos ?? 1,
    issuedAt: now.toISOString(),
    offlineValidUntil: buildOfflineValidUntil({
      validade: validade || null,
      diasOfflinePermitidos: dias,
      now,
    }),
  };
}

function gerarLicencaOffline(params) {
  const payload = buildLicensePayload(params);
  const signedLicense = signPayload(payload);

  return {
    ...signedLicense,
    offlineValidUntil: payload.offlineValidUntil,
    dias_offline_permitidos: payload.dias_offline_permitidos,
  };
}

module.exports = {
  gerarLicencaOffline,
  buildLicensePayload,
  buildOfflineValidUntil,
};
