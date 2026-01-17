import http from 'http'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import P from 'pino'

global.qrCodeSite = null

const PORT = process.env.PORT || 8080

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })

    if (global.qrCodeSite) {
        const qrImage = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(global.qrCodeSite)}`
        const html = `
            <html>
                <head>
                    <meta http-equiv="refresh" content="5">
                    <style>
                        body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f0f2f5; flex-direction: column; }
                        div { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; }
                    </style>
                </head>
                <body>
                    <div>
                        <h1>Bot Financeiro</h1>
                        <img src="${qrImage}" alt="QR Code" />
                        <p>Atualiza a cada 5 segundos</p>
                    </div>
                </body>
            </html>
        `
        res.end(html)
    } else {
        res.end(`
            <html>
                <head><meta http-equiv="refresh" content="2"></head>
                <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh;">
                    <h2>Aguardando QR Code ou Conectado</h2>
                </body>
            </html>
        `)
    }
})

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
})

if (!globalThis.crypto) {
    globalThis.crypto = crypto.webcrypto
}

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    delay 
} = await import('@whiskeysockets/baileys')

const require = createRequire(import.meta.url)
const qrcodeTerminal = require('qrcode-terminal')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const authFolder = './auth_local'
const dbPath = './banco.json'

function dataHoraAtual() {
    const now = new Date();
    const dataBrasil = new Date(now.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));

    const dia = String(dataBrasil.getDate()).padStart(2, '0');
    const mes = String(dataBrasil.getMonth() + 1).padStart(2, '0');
    const ano = dataBrasil.getFullYear();
    
    const hora = String(dataBrasil.getHours()).padStart(2, '0');
    const min = String(dataBrasil.getMinutes()).padStart(2, '0');

    return `${dia}/${mes}/${ano} ${hora}:${min}`;
}

function lerBanco() {
    if (!fs.existsSync(dbPath)) {
        fs.writeFileSync(dbPath, JSON.stringify({}))
    }
    try {
        return JSON.parse(fs.readFileSync(dbPath))
    } catch {
        return {}
    }
}

function salvarBanco(dados) {
    fs.writeFileSync(dbPath, JSON.stringify(dados, null, 2))
}

function limparNumero(texto) {
    let num = texto.replace(/[^\d,]/g, '').replace(',', '.')
    return parseFloat(num) || 0
}

async function tratarFinanceiro(sock, de, msg, txt) {
    const db = lerBanco()

    if (!db[de]) {
        db[de] = {
            gastos: []
        }
        salvarBanco(db)
    }

    const usuario = db[de]
    if (!Array.isArray(usuario.gastos)) usuario.gastos = [];

    const cmd = txt.trim().toLowerCase()

    if (cmd === '/lista') {
        if (usuario.gastos.length === 0) return sock.sendMessage(de, { text: "Nenhum gasto anotado." })

        const grupos = {}
        usuario.gastos.forEach(g => {
            if (!grupos[g.dataRef]) grupos[g.dataRef] = []
            grupos[g.dataRef].push(g)
        })

        let relatorio = "*SEUS GASTOS RECENTES:*\n"
        let totalGeral = 0

        for (const dia in grupos) {
            relatorio += `\n*${dia}*\n`
            grupos[dia].forEach(g => {
                const hora = g.momento.split(' ')[1] || ''
                const horaCurta = hora.trim();
                const idReal = usuario.gastos.indexOf(g) + 1;

                relatorio += `${idReal}.    ${horaCurta} - ${g.desc}: R$ ${g.valor.toFixed(2)}\n`
                totalGeral += g.valor
            })
        }

        relatorio += `\n*TOTAL GERAL: R$ ${totalGeral.toFixed(2)}*`
        return sock.sendMessage(de, { text: relatorio })
    }

    if (cmd.startsWith('/del ')) {
        const args = txt.split(' ');
        const tipo = args[1].toLowerCase();

        if (tipo === 'dia') {
            let dataAlvo = args[2] ? args[2].trim() : null;
            if (!dataAlvo) return sock.sendMessage(de, { text: "Use: /del dia 17/01" });
            if (dataAlvo.split('/').length === 2) dataAlvo = `${dataAlvo}/${new Date().getFullYear()}`;

            const antes = usuario.gastos.length;
            usuario.gastos = usuario.gastos.filter(g => g.dataRef !== dataAlvo);
            const apagados = antes - usuario.gastos.length;
            
            salvarBanco(db);
            return sock.sendMessage(de, { text: `Apagados ${apagados} itens do dia ${dataAlvo}.` });
        }
        else if (tipo === 'mes') {
            const mesAlvo = args[2] ? args[2].trim() : null;
            if (!mesAlvo) return sock.sendMessage(de, { text: "Use: /del mes 01/2026" });
            const antes = usuario.gastos.length;
            usuario.gastos = usuario.gastos.filter(g => !g.dataRef.includes(mesAlvo));
            const apagados = antes - usuario.gastos.length;
            salvarBanco(db);
            return sock.sendMessage(de, { text: `Apagados ${apagados} itens do mês ${mesAlvo}.` });
        }
        else {
            const id = parseInt(tipo);
            if (isNaN(id)) return sock.sendMessage(de, { text: "ID invalido." });
            const index = id - 1;
            if (index >= 0 && index < usuario.gastos.length) {
                const itemRemovido = usuario.gastos[index];
                usuario.gastos.splice(index, 1);
                salvarBanco(db);
                return sock.sendMessage(de, { text: `Item apagado: ${itemRemovido.desc} (R$ ${itemRemovido.valor})` });
            } else {
                return sock.sendMessage(de, { text: "Item nao encontrado." });
            }
        }
    }

    if (cmd === '/reset') {
        delete db[de]
        salvarBanco(db)
        return sock.sendMessage(de, { text: "Reiniciado" })
    }

    const partes = txt.trim().split(/\s+/)
    if (partes.length >= 2) {
        const valorTexto = partes.pop()
        const valor = limparNumero(valorTexto)
        const desc = partes.join(' ')

        if (desc && valor > 0) {
            const momento = dataHoraAtual(); 
            const apenasData = momento.split(' ')[0] 

            usuario.gastos.push({ 
                momento: momento, 
                dataRef: apenasData, 
                desc, 
                valor 
            })
            salvarBanco(db)
            
            return sock.sendMessage(de, { text: `Anotado: *${desc}*\nValor: R$ ${valor.toFixed(2)}\n${momento}` })
        }
    }
}

async function start() {
    const { state, saveCreds } = await useMultiFileAuthState(authFolder)
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: P({ level: "silent" })
    })

    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update
        
        if (qr) {
            global.qrCodeSite = qr
            qrcodeTerminal.generate(qr, { small: true })
        }

        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode
            if (reason !== DisconnectReason.loggedOut) start()
            else console.log("Fechado.")
        } else if (connection === "open") {
            global.qrCodeSite = null
            console.log("\nBCONECTADO")
        }
    })

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0]
        if (!msg.message || msg.key.fromMe) return
        const de = msg.key.remoteJid
        const txt = msg.message.conversation || msg.message.extendedTextMessage?.text || ""
        if (txt) await tratarFinanceiro(sock, de, msg, txt)
    })
}

start()