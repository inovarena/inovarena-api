const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

function getDiskSerial() {
  try {
    const result = execSync(
      'powershell -NoProfile -Command "Get-Disk | Select-Object -First 1 -ExpandProperty SerialNumber"',
      { timeout: 4000 }
    )
      .toString()
      .trim();

    if (result && result.length > 2) {
      return result;
    }
  } catch (_) {}

  try {
    const result = execSync('wmic diskdrive get SerialNumber /value', { timeout: 4000 })
      .toString()
      .split('\n')
      .find((line) => line.includes('SerialNumber='));

    if (result) {
      const serial = result.replace('SerialNumber=', '').trim();
      if (serial && serial.length > 2) {
        return serial;
      }
    }
  } catch (_) {}

  return null;
}

function generateFingerprint() {
  const hostname = os.hostname();
  const platform = os.platform();
  const arch = os.arch();
  const cpus = os.cpus();
  const cpuModel = cpus && cpus.length > 0 ? cpus[0].model : 'unknown-cpu';
  const diskSerial = getDiskSerial();

  const rawBase = diskSerial || `${hostname}|${platform}|${arch}|${cpuModel}`;

  const fingerprint = crypto
    .createHash('sha256')
    .update(rawBase)
    .digest('hex')
    .substring(0, 32);

  return {
    fingerprint,
    rawData: {
      diskSerial,
      hostname,
      platform,
      arch,
      cpuModel,
      source: diskSerial ? 'diskSerial' : 'fallback'
    }
  };
}

const result = generateFingerprint();

console.log('\nFINGERPRINT:\n');
console.log(result.fingerprint);

console.log('\nDADOS USADOS:\n');
console.log(JSON.stringify(result.rawData, null, 2));
