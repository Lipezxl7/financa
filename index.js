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
  fetchLatestBaileysVersion,
  delay
} = require('@whiskeysockets/baileys')

const axios = require('axios')
const fs = require('fs')
const P = require('pino')
const path = require('path')

const authFolder = './auth'
const dbPath = './banco.json' 

// Função para Simular Digitação (Delay Humano)
async function digitar(sock, de, segundos = 2) {
    await sock.sendPresenceUpdate('composing', de);
    await delay(segundos * 1000); // Espera X segundos
}

// Função para ler o banco
function lerBanco() {
    if (!fs.existsSync(dbPath)) {
        fs.writeFileSync(dbPath, JSON.stringify({})); 
    }
    try {
        return JSON.parse(fs.readFileSync(dbPath));
    } catch {
        return {};
    }
}

function salvarBanco(dados) {
    fs.writeFileSync(dbPath, JSON.stringify(dados, null, 2));
}

// Função para extrair e somar todos os números de um texto
// Ex: "300 luz e 200 agua" -> Retorna 500
function somarValoresTexto(texto) {
    // Procura todos os números (com ou sem vírgula/ponto)
    const numeros = texto.match(/(\d+[.,]?\d*)/g);
    if (!numeros) return 0;

    let total = 0;
    numeros.forEach(num => {
        // Troca virgula por ponto para o JS entender
        let valorLimpo = parseFloat(num.replace(',', '.'));
        if (!isNaN(valorLimpo)) {
            total += valorLimpo;
        }
    });
    return total;
}

function limparNumero(texto) {
    let num = texto.replace(/[^\d,]/g, '').replace(',', '.');
    return parseFloat(num) || 0;
}

async function tratarFinanceiro(sock, de, msg, txt) {
    const db = lerBanco();
    
    if (!db[de]) {
        db[de] = {
            etapa: 0, // 0=Novo, 1=Salario, 2=Fixos, 3=Guarda, 4=Concluido
            perfil: {
                salario: 0,
                fixos: 0,
                poupanca_atual: 0
            },
            gastos: [] 
        };
        salvarBanco(db);
    }

    const usuario = db[de];
    const cmd = txt.trim().toLowerCase();

    // --- LÓGICA DO QUESTIONÁRIO ---

    // Etapa 0: Boas vindas + Pergunta Salário
    if (usuario.etapa === 0) {
        usuario.etapa = 1;
        salvarBanco(db);

        await digitar(sock, de, 2); // Finge que digita por 2s

        const textoBoasVindas = "Olá! Sou seu Assistente Financeiro IA 🤖💰.\n" +
            "Para eu te ajudar, preciso entender sua vida financeira.\n\n" +
            "1️⃣ *Qual é a sua renda mensal (Salário)?*\n(Digite apenas o valor. Ex: 2500)";

        // Tenta mandar com imagem se existir 'saudacao.jpg'
        const caminhoFoto = path.join(__dirname, 'saudacao.jpg');
        if (fs.existsSync(caminhoFoto)) {
            return sock.sendMessage(de, { image: fs.readFileSync(caminhoFoto), caption: textoBoasVindas });
        } else {
            return sock.sendMessage(de, { text: textoBoasVindas });
        }
    }

    // Etapa 1: Recebe Salário -> Pergunta Fixos
    if (usuario.etapa === 1) {
        const valor = limparNumero(txt);
        if (valor <= 0) {
            await digitar(sock, de, 1);
            return sock.sendMessage(de, { text: "⚠️ Por favor, digite um valor válido." });
        }
        
        usuario.perfil.salario = valor;
        usuario.etapa = 2;
        salvarBanco(db);

        await digitar(sock, de, 2);
        return sock.sendMessage(de, { text: "Certo! 📝\n\n2️⃣ *Quais são seus gastos FIXOS mensais?*\n(Pode escrever tudo junto, eu somo pra você!)\n\nExemplo: _300 de agua 250 luz 800 aluguel_" });
    }

    // Etapa 2: Recebe Fixos (Soma Inteligente) -> Pergunta Poupança
    if (usuario.etapa === 2) {
        const totalFixos = somarValoresTexto(txt);
        
        if (totalFixos <= 0) {
            await digitar(sock, de, 1);
            return sock.sendMessage(de, { text: "Não identifiquei nenhum valor. Tente digitar números, tipo: '500 aluguel'" });
        }

        usuario.perfil.fixos = totalFixos;
        usuario.etapa = 3;
        salvarBanco(db);

        await digitar(sock, de, 2);
        return sock.sendMessage(de, { text: `Entendi, seus fixos somam *R$ ${totalFixos.toFixed(2)}*.\n\n3️⃣ *Você já guarda dinheiro mensalmente?*\nSe sim, digite quanto. Se não, digite 0.` });
    }

    // Etapa 3: Recebe Poupança -> Finaliza e Analisa
    if (usuario.etapa === 3) {
        const valorPoupanca = limparNumero(txt);
        usuario.perfil.poupanca_atual = valorPoupanca;
        usuario.etapa = 4; // Fim do cadastro
        salvarBanco(db);

        await digitar(sock, de, 3); // Demora um pouco mais pra "pensar"

        // CÁLCULOS
        const meta20 = usuario.perfil.salario * 0.20; // Meta de 20%
        const sobraReal = usuario.perfil.salario - usuario.perfil.fixos;
        
        let analise = `✅ *CADASTRO CONCLUÍDO!*\n\n` +
                      `💵 Salário: R$ ${usuario.perfil.salario.toFixed(2)}\n` +
                      `📉 Gastos Fixos: R$ ${usuario.perfil.fixos.toFixed(2)}\n` +
                      `💰 Sobra (Antes de gastar com besteira): R$ ${sobraReal.toFixed(2)}\n\n`;

        // Lógica dos 20%
        if (valorPoupanca >= meta20) {
            analise += `🏆 *PARABÉNS!* Você guarda R$ ${valorPoupanca.toFixed(2)}, que é mais de 20% do seu salário (R$ ${meta20.toFixed(2)}). Continue assim, seu futuro agradece! 🚀`;
        } else {
            const diferenca = meta20 - valorPoupanca;
            analise += `⚠️ *ATENÇÃO AOS 20%*\n` +
                       `Sua meta ideal seria guardar *R$ ${meta20.toFixed(2)}* por mês.\n` +
                       `Atualmente você guarda R$ ${valorPoupanca.toFixed(2)}.\n` +
                       `Faltam *R$ ${diferenca.toFixed(2)}* para atingir a meta saudável. Tente cortar gastos variáveis!`;
        }

        analise += `\n\n-----------------------------\n` +
                   `💡 *COMANDOS:*\n` +
                   `➕ */ad [item] [valor]* -> Adicionar gasto\n` +
                   `📜 */lista* -> Ver gastos\n` +
                   `🔄 */reset* -> Recomeçar cadastro\n` +
                   `🤖 *Pode conversar comigo que te ajudo a economizar!*`;

        return sock.sendMessage(de, { text: analise });
    }

    // --- COMANDOS PARA USUÁRIOS CADASTRADOS (ETAPA 4) ---

    // Comando /ad
    if (cmd.startsWith('/ad ')) {
        const partes = txt.slice(4).trim().split(' ');
        const valorString = partes.pop();
        const descricao = partes.join(' ');
        const valor = limparNumero(valorString);

        if (!descricao || valor <= 0) {
            await digitar(sock, de, 1);
            return sock.sendMessage(de, { text: "⚠️ Use: */ad Pizza 50*" });
        }

        const dataHoje = new Date().toLocaleDateString('pt-BR');
        usuario.gastos.push({ data: dataHoje, desc: descricao, valor: valor });
        salvarBanco(db);

        await digitar(sock, de, 1);
        return sock.sendMessage(de, { text: `✅ Gasto anotado: *${descricao}* (R$ ${valor.toFixed(2)})` });
    }

    // Comando /lista
    if (cmd === '/lista') {
        if (usuario.gastos.length === 0) return sock.sendMessage(de, { text: "Nenhum gasto anotado." });

        let relatorio = "*📝 SEUS GASTOS:*\n\n";
        let total = 0;
        usuario.gastos.forEach(g => {
            relatorio += `📅 ${g.data} - ${g.desc}: R$ ${g.valor.toFixed(2)}\n`;
            total += g.valor;
        });
        relatorio += `\n💸 *TOTAL:* R$ ${total.toFixed(2)}`;
        
        await digitar(sock, de, 2);
        return sock.sendMessage(de, { text: relatorio });
    }

    if (cmd === '/reset') {
        delete db[de];
        salvarBanco(db);
        return sock.sendMessage(de, { text: "Dados apagados. Mande um 'oi' para recomeçar." });
    }

    // --- IA COM DELAY ---
    
    await digitar(sock, de, 3); // IA demora 3 segundos fingindo pensar

    const contextoFinanceiro = `
        Você é um consultor financeiro.
        Dados do usuário:
        - Salário: R$ ${usuario.perfil.salario}
        - Fixos: R$ ${usuario.perfil.fixos}
        - Guarda: R$ ${usuario.perfil.poupanca_atual}
        
        O usuário disse: "${txt}"
        Responda de forma curta e ajude ele a bater a meta de 20% de economia.
    `;

    try {
        const { data } = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(contextoFinanceiro)}`);
        return sock.sendMessage(de, { text: `🤖 ${data}` });
    } catch (e) {
        return sock.sendMessage(de, { text: "A IA está descansando..." });
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
      if (reason !== DisconnectReason.loggedOut) start();
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