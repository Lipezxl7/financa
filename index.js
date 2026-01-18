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

const { default: axios } = await import('axios')
const require = createRequire(import.meta.url)
const qrcodeTerminal = require('qrcode-terminal')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const authFolder = './auth_local'
const dbPath = './banco.json'

async function digitar(sock, de, segundos = 1) {
    await sock.sendPresenceUpdate('composing', de)
    await delay(segundos * 1000)
}

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

function somarValoresTexto(texto) {
    const numeros = texto.match(/(\d+[.,]?\d*)/g)
    if (!numeros) return 0
    let total = 0
    numeros.forEach(num => {
        let valorLimpo = parseFloat(num.replace(',', '.'))
        if (!isNaN(valorLimpo)) total += valorLimpo
    })
    return total
}

function limparNumero(texto) {
    let num = texto.replace(/[^\d,]/g, '').replace(',', '.')
    return parseFloat(num) || 0
}

async function tratarFinanceiro(sock, de, msg, txt) {
    const db = lerBanco()

    if (!db[de]) {
        db[de] = {
            etapa: 0,
            perfil: { nome: '', salario: 0, fixos: 0, futeis: 0, poupanca_atual: 0 },
            gastos: [],
            conversas: [] 
        }
        salvarBanco(db)
    }

    const usuario = db[de]

    if (usuario.perfil.futeis === undefined) usuario.perfil.futeis = 0;
    if (usuario.perfil.nome === undefined) usuario.perfil.nome = 'Cliente'; 
    if (!Array.isArray(usuario.gastos)) usuario.gastos = [];
    if (!Array.isArray(usuario.conversas)) usuario.conversas = []; 
    
    // Salva msg do usuario
    usuario.conversas.push({ role: 'user', content: txt, time: dataHoraAtual() });
    
    // Limita historico a 50 msgs pra nao pesar
    if (usuario.conversas.length > 50) {
        usuario.conversas = usuario.conversas.slice(-50);
    }
    
    salvarBanco(db);

    const cmd = txt.trim().toLowerCase()

    if (usuario.etapa === 0) {
        usuario.etapa = 1
        salvarBanco(db)
        await digitar(sock, de, 2)

        const texto = "Olá! Sou seu Consultor Financeiro.\nVamos alinhar suas contas?\n\nAntes de tudo: *Como você quer ser chamado?*"
        
        const caminhoFoto = path.join(__dirname, 'saudacao.jpg')
        if (fs.existsSync(caminhoFoto)) {
            return sock.sendMessage(de, { image: fs.readFileSync(caminhoFoto), caption: texto })
        } else {
            return sock.sendMessage(de, { text: texto })
        }
    }

    if (usuario.etapa === 1) {
        const nomeEscolhido = txt.trim();
        if (nomeEscolhido.length < 2) return sock.sendMessage(de, { text: "Nome muito curto. Como quer ser chamado?" });

        usuario.perfil.nome = nomeEscolhido;
        usuario.etapa = 2; 
        salvarBanco(db);

        await digitar(sock, de, 1);
        return sock.sendMessage(de, { text: `Prazer, *${nomeEscolhido}*! 👊🏿\n\n1️⃣ Agora sim: *Qual é sua renda mensal (Salário)?*` });
    }

    if (usuario.etapa === 2) {
        const valor = limparNumero(txt)
        if (valor <= 0) return sock.sendMessage(de, { text: "Por favor, digite um valor válido." })
        
        usuario.perfil.salario = valor
        usuario.etapa = 3
        salvarBanco(db)
        
        await digitar(sock, de, 1)
        return sock.sendMessage(de, { text: "2️⃣ *Agora os Gastos Necessarios (Aluguel, Luz, Net...)*\n\nVocê pode mandar tudo somado ou ir mandando um por um.\n\n_Digite o valor ou mande 'FIM' quando terminar._" })
    }

    if (usuario.etapa === 3) {
        if (['fim', 'ok', 'pronto', 'acabei', 'so', 'só'].includes(cmd)) {
            usuario.etapa = 4
            salvarBanco(db)

            await digitar(sock, de, 1)
            await sock.sendMessage(de, { text: `Fechado em R$ ${usuario.perfil.fixos.toFixed(2)} de fixos.` })
            
            await digitar(sock, de, 1)
            return sock.sendMessage(de, { text: `3️⃣ *Quanto você gasta com coisas FÚTEIS?*\n(Lazer)\n\n_Pode somar ou mandar picado. Digite 'FIM' para acabar._` })
        }

        const valorAdicionado = somarValoresTexto(txt)
        
        if (valorAdicionado > 0) {
            usuario.perfil.fixos += valorAdicionado
            salvarBanco(db)
            return sock.sendMessage(de, { text: `Necessario: R$ ${valorAdicionado.toFixed(2)}.\n*Total Fixos:* R$ ${usuario.perfil.fixos.toFixed(2)}\n\n_Mande mais ou 'FIM'._` })
        } else {
            return sock.sendMessage(de, { text: "Não entendi. Digite o valor ou 'FIM' para avançar." })
        }
    }

    if (usuario.etapa === 4) {
        if (['fim', 'ok', 'pronto', 'acabei', 'so', 'só'].includes(cmd)) {
            usuario.etapa = 5
            salvarBanco(db)

            await digitar(sock, de, 1)
            await sock.sendMessage(de, { text: `Gastos Fúteis fechados em R$ ${usuario.perfil.futeis.toFixed(2)}.` })
            
            await digitar(sock, de, 1)
            return sock.sendMessage(de, { text: `4️⃣ *Quanto você guarda/investe por mês?* (Digite 0 se nada)` })
        }

        const valorAdicionado = somarValoresTexto(txt)
        
        if (valorAdicionado > 0) {
            usuario.perfil.futeis += valorAdicionado
            salvarBanco(db)
            return sock.sendMessage(de, { text: `Fútil: R$ ${valorAdicionado.toFixed(2)}.\n*Total Fúteis:* R$ ${usuario.perfil.futeis.toFixed(2)}\n\n_Mande mais ou 'FIM'._` })
        } else {
            return sock.sendMessage(de, { text: "Não entendi. Digite o valor ou 'FIM' para avançar." })
        }
    }

    if (usuario.etapa === 5) {
        const guardado = limparNumero(txt)
        usuario.perfil.poupanca_atual = guardado
        usuario.etapa = 6 
        salvarBanco(db)

        const salario = usuario.perfil.salario
        const fixos = usuario.perfil.fixos
        const futeis = usuario.perfil.futeis
        const sobraReal = salario - fixos - futeis - guardado 
        const meta = salario * 0.20
        const nome = usuario.perfil.nome
        
        const potencialTotal = guardado + sobraReal;

        const resumo = `*TABELA:*\n\n` +
                       `*Salario*: R$ ${salario.toFixed(2)}\n` +
                       `*Necessario*: R$ ${fixos.toFixed(2)}\n` +
                       `*Futeis*: R$ ${futeis.toFixed(2)}\n` +
                       `*Guardado*: R$ ${guardado.toFixed(2)}\n` +
                       `*Sobra no Bolso*: R$ ${sobraReal.toFixed(2)}\n\n` +
                       `*Meta ideal* (20%): R$ ${meta.toFixed(2)}`;

        let caminhoImagem = ""
        let veredito = ""

        if (potencialTotal >= meta) {
            caminhoImagem = path.join(__dirname, 'bom.jpg');
            
            if (guardado >= meta) {
                veredito = `Boa ${nome}, você bateu a meta! 🏆\n\n${resumo}\n\nContinue investindo assim!`;
            } else {
                const faltaInvestir = meta - guardado;
                veredito = `Boa ${nome},\n\n Mas para de ser Burro ce tem (R$ ${sobraReal.toFixed(2)}) Parado na Conta\n\nInvista pelo menos R$ ${faltaInvestir.toFixed(2)} Pra tu ser o Proximo Elomusk Negro\n\n${resumo}`;
            }

        } else {
            const falta = meta - potencialTotal;
            caminhoImagem = path.join(__dirname, 'ruim.jpg');
            veredito = `Não Sai do clt 📉\n\n${resumo}\n\n*Nem investindo a sobra você bate a meta. Faltam R$ ${falta.toFixed(2)}.*`;
        }

        await digitar(sock, de, 2)

        if (fs.existsSync(caminhoImagem)) {
            await sock.sendMessage(de, { image: fs.readFileSync(caminhoImagem), caption: veredito })
        } else {
            await sock.sendMessage(de, { text: veredito })
        }
        
        await delay(1000)
        return sock.sendMessage(de, { text: `Pronto, ${nome}! \n\nUse */ajuda* para ver os comandos`})
    }

    if (cmd === '/ajuda' || cmd === '/help') {
        const msgAjuda = `*COMANDOS*\n\n` +
            `*/ad [item] [valor]*\n` +
            `> Adiciona um gasto novo.\n` +
            `> Ex: _/ad Pizza 50_\n\n` +
            
            `*/lista*\n` +
            `> Mostra todos os seus gastos.\n\n` +
            
            `*/del [numero]*\n` +
            `> Apaga um gasto específico (veja o nº na lista).\n` +
            `> Ex: _/del 1_\n\n` +
            
            `*/del dia [dia/mes]*\n` +
            `> Apaga tudo de um dia.\n` +
            `> Ex: _/del dia 17/01_\n\n` +

            `*/del mes [mes/ano]*\n` +
            `> Apaga tudo de um mês.\n` +
            `> Ex: _/del mes 01/2026_\n\n` +

            `*/reset*\n` +
            `> Apaga tudo e recomeça o cadastro.`;
            
        return sock.sendMessage(de, { text: msgAjuda });
    }

    if (cmd.startsWith('/ad ')) {
        const partes = txt.slice(4).trim().split(' ')
        const valor = limparNumero(partes.pop())
        const desc = partes.join(' ')
        
        if (!desc || valor <= 0) return sock.sendMessage(de, { text: "Use: /ad Pizza 50" })

        const momento = dataHoraAtual(); 
        const apenasData = momento.split(' ')[0] 

        usuario.gastos.push({ 
            momento: momento, 
            dataRef: apenasData, 
            desc, 
            valor 
        })
        salvarBanco(db)
        
        return sock.sendMessage(de, { text: `✅ Anotado: *${desc}*\n\n*Valor*: R$ ${valor.toFixed(2)}\n${momento}` })
    }

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

                if ((idReal - 1) % 10 === 0) {
                    relatorio += `${idReal}. ${horaCurta} - ${g.desc}: R$ ${g.valor.toFixed(2)}\n`
                } else {
                    relatorio += `   ▪️ ${horaCurta} - ${g.desc}: R$ ${g.valor.toFixed(2)}\n`
                }
                
                totalGeral += g.valor
            })
        }

        relatorio += `\n*TOTAL GERAL: R$ ${totalGeral.toFixed(2)}*`
        return sock.sendMessage(de, { text: relatorio })
    }

    if (cmd.startsWith('/del ')) {
        const args = cmd.split(' ');
        const tipo = args[1];

        if (tipo === 'dia') {
            let dataAlvo = args[2] ? args[2].trim() : null;
            if (!dataAlvo) return sock.sendMessage(de, { text: "Use: /del dia 17/01" });
            if (dataAlvo.split('/').length === 2) dataAlvo = `${dataAlvo}/${new Date().getFullYear()}`;

            const antes = usuario.gastos.length;
            usuario.gastos = usuario.gastos.filter(g => g.dataRef !== dataAlvo);
            const apagados = antes - usuario.gastos.length;
            
            salvarBanco(db);
            return sock.sendMessage(de, { text: `🗑️ Apagados ${apagados} itens do dia ${dataAlvo}.` });
        }
        else if (tipo === 'mes') {
            const mesAlvo = args[2] ? args[2].trim() : null;
            if (!mesAlvo) return sock.sendMessage(de, { text: "Use: /del mes 01/2026" });
            const antes = usuario.gastos.length;
            usuario.gastos = usuario.gastos.filter(g => !g.dataRef.includes(mesAlvo));
            const apagados = antes - usuario.gastos.length;
            salvarBanco(db);
            return sock.sendMessage(de, { text: `🗑️ Apagados ${apagados} itens do mês ${mesAlvo}.` });
        }
        else {
            const id = parseInt(tipo);
            if (isNaN(id)) return sock.sendMessage(de, { text: "ID inválido. Use: /del 1 (ou /del dia 17/01)" });
            const index = id - 1;
            if (index >= 0 && index < usuario.gastos.length) {
                const itemRemovido = usuario.gastos[index];
                usuario.gastos.splice(index, 1);
                salvarBanco(db);
                return sock.sendMessage(de, { text: `🗑️ Item apagado: ${itemRemovido.desc} (R$ ${itemRemovido.valor})` });
            } else {
                return sock.sendMessage(de, { text: "⚠️ Item não encontrado." });
            }
        }
    }

    if (cmd === '/reset') {
        delete db[de]
        salvarBanco(db)
        return sock.sendMessage(de, { text: "Reiniciado" })
    }

    if (usuario.etapa === 6) {
        await digitar(sock, de, 2)

        const historicoMsgs = usuario.conversas.slice(-10).map(c => `${c.role}: ${c.content}`).join('\n');

        const contexto = `
            Aja como um consultor financeiro paciente e extremamente objetivo.
            O nome do cliente é ${usuario.perfil.nome}, chame ele assim sempre.
            
            Dados financeiros: 
            - Salario ${usuario.perfil.salario}
            - Fixos ${usuario.perfil.fixos}
            - Fúteis ${usuario.perfil.futeis}
            - Guarda ${usuario.perfil.poupanca_atual}
            
            Historico recente da conversa:
            ${historicoMsgs}

            Usuario disse: "${txt}".
            
            Instruções:
            1. Responda em no máximo uma frase curta.
            2. Sem palestras.
            3. Vá direto ao ponto mas sempre querendo ajudar o ${usuario.perfil.nome}.
            4. Se o usuário parecer confuso ou perguntar sobre comandos, sugira usar /ajuda.
        `

        try {
            const { data } = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(contexto)}`)
            
            // Salva resposta do bot
            usuario.conversas.push({ role: 'assistant', content: data, time: dataHoraAtual() });
            salvarBanco(db);

            return sock.sendMessage(de, { text: `*Consultor*: ${data}` })
        } catch (e) {
            return 0 
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