import { startServer } from './server.js';

const portArgument = process.argv.indexOf('--port');
const port = portArgument >= 0 ? Number(process.argv[portArgument + 1]) : undefined;
const dataDirArgument = process.argv.indexOf('--data-dir');
const dataDir = dataDirArgument >= 0 ? process.argv[dataDirArgument + 1] : undefined;

startServer({ port, dataDir }).then((running) => {
  console.log(`Bech32 后端已启动: http://127.0.0.1:${running.port}`);
  console.log(`数据目录: ${dataDir ?? 'data'}`);
});
