const express = require('express');
const app = express();
const qrcode = require('qrcode');
let qrCodeImagem = null;

// --- CONFIGURAÇÃO DO SITE 24H ---
app.get("/", (request, response) => {
  const ping = new Date();
  ping.setHours(ping.getHours() - 3);
  console.log(`Ping recebido às ${ping.getUTCHours()}:${ping.getUTCMinutes()}:${ping.getUTCSeconds()}`);
  
  if (qrCodeImagem) {
      response.send(`
        <html>
          <meta http-equiv="refresh" content="5">
          <body style="display:flex; justify-content:center; align-items:center; background:#121212; height:100vh;">
            <div style="text-align:center; color:white; font-family:sans-serif;">
                <h1>Escaneie para conectar</h1>
                <img src="${qrCodeImagem}" style="border:5px solid white; border-radius:10px;">
                <p>Atualizando automaticamente...</p>
            </div>
          </body>
        </html>
      `);
  } else {
      response.send('<h1 style="text-align:center; margin-top:20%; font-family:sans-serif;">Bot Financeiro Online! 💰<br>Aguarde ou já conectado.</h1>');
  }
});
app.listen(process.env.PORT || 5000);

// --- INÍCIO DO BOT ---
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys')

const axios = require('axios')
const fs = require('fs')
const P = require('pino')
const path = require('path')

const authFolder = './auth'
const dbPath = './banco.json' // Arquivo onde ficam os dados

// Função para ler o banco de dados
function lerBanco() {
    if (!fs.existsSync(dbPath)) {
        fs.writeFileSync(dbPath, JSON.stringify({})); // Cria se não existir
    }
    try {
        return JSON.parse(fs.readFileSync(dbPath));
    } catch {
        return {};
    }
}

// Função para salvar no banco
function salvarBanco(dados) {
    fs.writeFileSync(dbPath, JSON.stringify(dados, null, 2));
}

// Função auxiliar para limpar números (ex: "R$ 1.200,50" vira 1200.50)
function limparNumero(texto) {
    let num = texto.replace(/[^\d,]/g, '').replace(',', '.');
    return parseFloat(num) || 0;
}

async function tratarFinanceiro(sock, de, msg, txt) {
    const db = lerBanco();
    
    // Se o usuário não existe, cria o cadastro inicial
    if (!db[de]) {
        db[de] = {
            etapa: 0, // 0 = Novo, 1 = Salario, 2 = Fixos, 3 = Besteira, 4 = Guarda, 5 = Concluido
            perfil: {
                salario: 0,
                fixos: 0,
                besteira: 0,
                poupanca_atual: 0
            },
            gastos: [] // Lista de gastos
        };
        salvarBanco(db);
    }

    const usuario = db[de];
    const cmd = txt.trim().toLowerCase();

    // --- LÓGICA DO QUESTIONÁRIO ---

    // Etapa 0: Boas vindas
    if (usuario.etapa === 0) {
        usuario.etapa = 1;
        salvarBanco(db);
        return sock.sendMessage(de, { text: 
            "Olá! Sou seu Assistente Financeiro IA 🤖💰.\n" +
            "Para começar e eu te ajudar de verdade, preciso te conhecer.\n\n" +
            "1️⃣ Qual é a sua renda mensal (Salário)?\n(Digite apenas o valor. Ex: 2500)" 
        });
    }

    // Etapa 1: Recebe Salário -> Pergunta Fixos
    if (usuario.etapa === 1) {
        const valor = limparNumero(txt);
        if (valor <= 0) return sock.sendMessage(de, { text: "Por favor, digite um valor válido." });
        
        usuario.perfil.salario = valor;
        usuario.etapa = 2;
        salvarBanco(db);
        return sock.sendMessage(de, { text: "Certo! 📝\n\n2️⃣ Quanto você gasta com contas FIXAS todo mês? (Luz, água, aluguel, internet...)\nSome tudo e me diga o valor." });
    }

    // Etapa 2: Recebe Fixos -> Pergunta Besteiras
    if (usuario.etapa === 2) {
        const valor = limparNumero(txt);
        usuario.perfil.fixos = valor;
        usuario.etapa = 3;
        salvarBanco(db);
        return sock.sendMessage(de, { text: "Entendido.\n\n3️⃣ E com 'besteiras' ou lazer? (Ifood, Uber desnecessário, comprinhas...)\nChute uma média mensal:" });
    }

    // Etapa 3: Recebe Besteiras -> Pergunta Poupança
    if (usuario.etapa === 3) {
        const valor = limparNumero(txt);
        usuario.perfil.besteira = valor;
        usuario.etapa = 4;
        salvarBanco(db);
        return sock.sendMessage(de, { text: "Última pergunta do cadastro:\n\n4️⃣ Você já guarda dinheiro mensalmente? Se sim, quanto?\n(Se não guarda, digite 0)" });
    }

    // Etapa 4: Finaliza e Calcula
    if (usuario.etapa === 4) {
        const valor = limparNumero(txt);
        usuario.perfil.poupanca_atual = valor;
        usuario.etapa = 5; // Cadastro finalizado
        salvarBanco(db);

        // CÁLCULO FINANCEIRO
        const totalGastos = usuario.perfil.fixos + usuario.perfil.besteira;
        const sobraReal = usuario.perfil.salario - totalGastos;
        const meta20 = usuario.perfil.salario * 0.20; // 20% do salário
        
        let analise = `✅ *CADASTRO CONCLUÍDO!*\n\n` +
                      `💵 Renda: R$ ${usuario.perfil.salario.toFixed(2)}\n` +
                      `📉 Gastos Totais: R$ ${totalGastos.toFixed(2)}\n` +
                      `💰 *Sobra Teórica: R$ ${sobraReal.toFixed(2)}*\n\n` +
                      `🎯 *META DE OURO (20%):* Você deveria guardar pelo menos *R$ ${meta20.toFixed(2)}* todo mês.\n\n`;

        if (sobraReal < meta20) {
            analise += "⚠️ *Alerta:* Seus gastos estão altos! Você não está conseguindo guardar os 20% ideais. Vamos precisar cortar as 'besteiras' ou economizar nos fixos.";
        } else {
            analise += "🏆 *Parabéns!* Suas finanças parecem saudáveis. Mantenha o foco!";
        }

        analise += `\n\n-----------------------------\n` +
                   `💡 *COMANDOS DISPONÍVEIS:*\n` +
                   `➕ */ad [item] [valor]* -> Adicionar um gasto novo\n` +
                   `📜 */lista* -> Ver o que gastou\n` +
                   `    *Pode conversar normalmente que a IA te dá dicas!*`;

        return sock.sendMessage(de, { text: analise });
    }

    /

    // Comando /ad (Adicionar Gasto)
    if (cmd.startsWith('/ad ')) {
        
        const partes = txt.slice(4).trim().split(' ');
        const valorString = partes.pop(); // Pega o último item (o valor)
        const descricao = partes.join(' '); // O resto é a descrição
        const valor = limparNumero(valorString);

        if (!descricao || valor <= 0) {
            return sock.sendMessage(de, { text: "Formato errado\nUse: */ad Nome do Gasto Valor*\nEx: /ad Ifood 35.00" });
        }

        const dataHoje = new Date().toLocaleDateString('pt-BR');
        
        usuario.gastos.push({
            data: dataHoje,
            desc: descricao,
            valor: valor
        });
        salvarBanco(db);

        return sock.sendMessage(de, { text: `✅ Gasto anotado: *${descricao}* (R$ ${valor.toFixed(2)})` });
    }

    if (cmd === '/lista') {
        if (usuario.gastos.length === 0) {
            return sock.sendMessage(de, { text: "Você ainda não anotou nenhum gasto." });
        }

        let relatorio = "*📝 SEUS GASTOS RECENTES:*\n\n";
        let total = 0;

        usuario.gastos.forEach((g, i) => {
            relatorio += `📅 ${g.data} - ${g.desc}: R$ ${g.valor.toFixed(2)}\n`;
            total += g.valor;
        });

        relatorio += `\n💸 *TOTAL GASTO:* R$ ${total.toFixed(2)}`;
        return sock.sendMessage(de, { text: relatorio });
    }
    if (cmd === '/reset') {
        delete db[de];
        salvarBanco(db);
        return sock.sendMessage(de, { text: "Seus dados foram apagados. Mande um 'oi' para começar de novo." });
    }
    await sock.sendPresenceUpdate('composing', de);

    const contextoFinanceiro = `
        Você é um consultor financeiro especialista e rigoroso.
        O perfil do usuário é:
        - Ganha: R$ ${usuario.perfil.salario}
        - Custos Fixos: R$ ${usuario.perfil.fixos}
        - Gasta com besteira: R$ ${usuario.perfil.besteira}
        - Guarda atualmente: R$ ${usuario.perfil.poupanca_atual}
        
        O usuário disse: "${txt}"
        
        Dê um conselho curto e direto baseado nos números dele. Se ele estiver gastando muito com besteira, dê uma bronca leve.
    `;

    try {
        const { data } = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(contextoFinanceiro)}`);
        return sock.sendMessage(de, { text: ` *Consultor:* ${data}` });
    } catch (e) {
        return sock.sendMessage(de, { text: "A IA está dormindo um pouco, tente já já." });
    }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ["FinanceBot", "Chrome", "1.0"],
    version,
    logger: P({ level: "silent" })
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
        console.log("QR Code gerado");
        qrCodeImagem = await qrcode.toDataURL(qr);
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        start();
      } else {
        console.log("Sessão expirada.");
      }
    } else if (connection === "open") {
      console.log("BOT CONECTADO 🚀");
      qrCodeImagem = null;
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const de = msg.key.remoteJid;
    const txt = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

    if (!txt) return;

    await tratarFinanceiro(sock, de, msg, txt);
  });
}

start();