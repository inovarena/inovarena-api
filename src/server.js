const express = require('express');
require('dotenv').config();

const { db } = require('./firebase-admin');
const authRoutes = require('./routes/auth.routes');
const devicesRoutes = require('./routes/devices.routes');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send('InovARENA API online');
});

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'API funcionando',
    timestamp: new Date().toISOString()
  });
});

app.get('/firebase-test', async (req, res) => {
  try {
    const collections = await db.listCollections();
    res.json({
      success: true,
      message: 'Firebase conectado com sucesso',
      collections: collections.map((collection) => collection.id)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Erro ao conectar com Firebase',
      error: error.message
    });
  }
});

app.use('/auth', authRoutes);
app.use('/devices', devicesRoutes);

app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}`);
});