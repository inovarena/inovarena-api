const express = require('express');
const { db } = require('../firebase-admin');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Lista os dispositivos do usuário autenticado
router.get('/list', verifyToken, async (req, res) => {
  try {
    const uid = req.uid;

    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    const userData = userDoc.data();
    const dispositivos = Array.isArray(userData.dispositivos)
      ? userData.dispositivos.filter((d) => d && d.id)
      : [];

    return res.json({
      success: true,
      dispositivos
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao listar dispositivos',
      error: error.message
    });
  }
});

// Remove um dispositivo pelo ID (fingerprint)
router.post('/remove', verifyToken, async (req, res) => {
  try {
    const uid = req.uid;
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: 'deviceId é obrigatório'
      });
    }

    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    const userData = userDoc.data();
    const dispositivosAtuais = Array.isArray(userData.dispositivos)
      ? userData.dispositivos
      : [];

    const dispositivoExiste = dispositivosAtuais.some((d) => d.id === deviceId);

    if (!dispositivoExiste) {
      return res.status(404).json({
        success: false,
        message: 'Dispositivo não encontrado'
      });
    }

    const dispositivosAtualizados = dispositivosAtuais.filter(
      (d) => d.id !== deviceId
    );

    await userRef.update({ dispositivos: dispositivosAtualizados });

    return res.json({
      success: true,
      message: 'Dispositivo removido com sucesso',
      dispositivos: dispositivosAtualizados
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao remover dispositivo',
      error: error.message
    });
  }
});

module.exports = router;