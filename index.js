import 'dotenv/config'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import P from 'pino'
import Groq from "groq-sdk"; 
import { GoogleGenerativeAI } from "@google/generative-ai"
import axios from 'axios'
import express from 'express'
import QRCode from 'qrcode' 

if (!globalThis.crypto) {
    globalThis.crypto = crypto.webcrypto;
}

const BaileysLib = await import('@whiskeysockets/baileys');
const makeWASocket = BaileysLib.default?.default || BaileysLib.default || BaileysLib;
const { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    delay, 
    downloadMediaMessage 
} = BaileysLib;

// --- VARIÁVEIS GLOBAIS PARA O SITE ---
let qrDinamico = null;
let statusConexao = "Iniciando...";

// --- SERVIDOR WEB (COM QR CODE VISUAL) ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', async (req, res) => {
    res.setHeader('Content-Type', 'text/html');

    if (statusConexao === 'Conectado') {
        return res.send(`
            <div style="font-family: sans-serif; text-align: center; padding-top: 50px;">
                <h1 style="color: green;">✅ BCONECTADO!</h1>
                <p>O Bot Financeiro está rodando perfeitamente.</p>
            </div>
        `);
    }

    if (qrDinamico) {
        try {
            
            const urlImagem = await QRCode.toDataURL(qrDinamico);
            return res.send(`
                <div style="font-family: sans-serif; text-align: center; padding-top: 20px;">
                    <meta http-equiv="refresh" content="5"> <h1>Escaneie o QR Code no WhatsApp</h1>
                    <img src="${urlImagem}" style="width: 300px; height: 300px; border: 5px solid #000; border-radius: 10px;">
                    <p style="font-size: 18px;">Atualizando automaticamente...</p>
                    <p>Status: <strong>${statusConexao}</strong></p>
                </div>
            `);
        } catch (err) {
            return res.send("Erro ao gerar imagem do QR Code.");
        }
    }

    return res.send(`
        <div style="font-family: sans-serif; text-align: center; padding-top: 50px;">
            <meta http-equiv="refresh" content="3">
            <h1> Carregando...</h1>
            <p>Aguardando o WhatsApp gerar o QR Code.</p>
        </div>
    `);
});

app.listen(PORT, () => {
    console.log(`Servidor WEB rodando na porta ${PORT}`);
});

const API_KEY_GROQ = process.env.API_KEY_GROQ; 
const API_KEY_GEMINI = process.env.API_KEY_GEMINI; 

const groq = new Groq({ apiKey: API_KEY_GROQ });
const genAI = new GoogleGenerativeAI(API_KEY_GEMINI);

const require = createRequire(import.meta.url)
const qrcodeTerminal = require('qrcode-terminal')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const authFolder = path.resolve(__dirname, 'auth_local')
const dbPath = path.resolve(__dirname, 'banco.json')

async function digitar(sock, de) {
    try { await sock.sendPresenceUpdate('composing', de) } catch(e){}
}

function dataHoraAtual() {
    const now = new Date()
    return now.toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo"})
}

function pegarMesAno(dataString) {
    const partes = dataString.split('/')
    return `${partes[1]}/${partes[2].substring(0, 4)}`
}

function pegarDia(dataString) {
    return parseInt(dataString.split('/')[0])
}


function limparNumero(texto) {
   
    if (texto.includes(',')) {
        
        let num = texto.replace(/\./g, '').replace(',', '.');
        return parseFloat(num) || 0;
    } 
    else {
        let num = texto.replace(/[^\d.]/g, '');
        return parseFloat(num) || 0;
    }
}


function tirarAzul(texto) {
    if (!texto) return "";
    let str = texto.toString();
    return str.replace(/\d/g, '$&\u200B');
}

function lerBanco() {
    if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({}))
    try { return JSON.parse(fs.readFileSync(dbPath)) } catch { return {} }
}

function salvarBanco(dados) {
    fs.writeFileSync(dbPath, JSON.stringify(dados, null, 2))
}

function pegarTextoMensagem(msg) {
    return msg.message?.conversation || 
           msg.message?.extendedTextMessage?.text || 
           msg.message?.imageMessage?.caption ||
           "";
}

async function categorizarTexto(item) {
    try {
        const completion = await groq.chat.completions.create({
            messages: [{
                role: "user",
                content: `Classifique o gasto: "${item}". Responda APENAS uma palavra: "Alimentacao" (EX:tudo que houver COMIDA, SOBREMESA)  , "Transporte" (EX:onibus, uber)  , "Lazer" (ex:sair, role, shopping, barzinho, restaurante,)
                , "Saude" (ex:Academia, hospistal), Casa(ex:geladeira, mesa), Contas (ex: luz, agua, plano, cartao de credito,) , Outros (se voce nao conseguir achar alguma categoria pode colocar aqui), Pet (ex:animal de estimação, banho (NOME DO ANIMAL), ração, brinquedo animal ).`
            }],
            model: "llama-3.1-8b-instant", 
        });
        return completion.choices[0]?.message?.content?.trim() || "Geral";
    } catch { return "Geral" }
}

async function interpretarComandoGroq(textoUsuario) {
    const hoje = dataHoraAtual().split(' ')[0]; 
    const diaHoje = pegarDia(hoje);

    const prompt = `
            ATUE COMO UM INTERPRETADOR DE COMANDOS PARA UM BOT FINANCEIRO.
            SUA ÚNICA FUNÇÃO É RETORNAR A STRING DO COMANDO. NÃO EXPLIQUE NADA.

        --- CONTEXTO ---
        DATA ATUAL: ${hoje}
        DIA DO MÊS: ${diaHoje}

        --- HIERARQUIA DE DECISÃO (Siga nesta ordem) ---

        1. COMANDOS DE AÇÃO:
        - "Apagar/Deletar/Remover o 1" -> /del 1
        - "Apagar/Deletar/Remover Netflix" -> /del Netflix
        - "Apagar/Deletar/Remover dia 20" -> /del dia 20
        - "Ver lista", "Extrato", "Mostrar gastos" -> /lista
        - "Resetar", "Zerar tudo" -> /reset
        - "Menu", "Ajuda", "Opções" -> /menu
        - "Meu perfil", "Quanto eu ganho", "Meus dados" -> /perfil
        - "Falar com consultor", "Ativar IA", "Dicas" -> /consultor
        - "Mudar salário para 5000", "Meu salário é 2000" -> /salario [valor numérico]

        2. RELATÓRIOS E RESUMOS (Calculados com base no DIA DO MÊS: ${diaHoje}):
        - "Resumo do mês", "Quanto gastei esse mês", "Resumo geral" -> /resumo
        - "Resumo de hoje", "Gastos de hoje" -> /resumo ${diaHoje} ${diaHoje}
        - "Resumo até hoje", "Começo do mês até agora" -> /resumo 1 ${diaHoje}
        - "Resumo do dia 5 ao 10" -> /resumo 5 10
        - "Resumo de ontem" -> /resumo ${diaHoje - 1} ${diaHoje - 1}

        3. REGISTRO DE GASTOS (Se não for nenhum dos acima):
        - O usuário disse um item e um valor? Formate como: [Nome do Item] [Valor Numérico]
        - Ex: "Gastei 50 reais no Uber" -> Uber 50
        - Ex: "Coxinha 5 reais" -> Coxinha 5
        - Ex: "Compra mercado 500,00" -> Mercado 500.00

        --- EXEMPLOS DE SAÍDA ---
        Entrada: "Me vê um resumo até hoje"
        Saída: /resumo 1 ${diaHoje}

        Entrada: "Apaga o item 3 por favor"
        Saída: /del 3

        Entrada: "Comprei um mouse de 150 reais"
        Saída: Mouse 150

        Entrada: "Deleta pra mim o dia 27 inteiro"
        Saida: /del dia 27

        --- SUA VEZ ---
        Entrada do usuário: "${textoUsuario}"
        Saída (Apenas o comando):
        `;

    try {
        const completion = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "llama-3.1-8b-instant", 
            temperature: 0
        });

        let resposta = completion.choices[0]?.message?.content?.trim();
        
        if (!resposta.includes('MSG:')) {
            resposta = resposta.replace(/"/g, '').split('\n')[0];
        }
        
        return resposta;
    } catch { return null }
}

async function consultarConsultorFinanceiro(pergunta, usuario) {
    try {
        const contexto = `
            DADOS DO USUÁRIO:
            - Nome: ${usuario.perfil.nome}
            - Salário Líquido: R$ ${usuario.perfil.salario}
            - Custos Fixos: R$ ${usuario.perfil.fixos}
            - Investimento Mensal: R$ ${usuario.perfil.investe}
            - Gastos variáveis registrados este mês: ${usuario.gastos.length} itens.
        `;

        const messages = [
            {
                role: "system",
                content: `Você é um Consultor Financeiro Pessoal via WhatsApp.
                TONS: Direto, curto e preciso. Use emojis profissionais tipo grafico, dinheiro.
                OBJETIVO: Responder dúvidas financeiras do usuário usando os dados financeiros dele.
                REGRAS:
                1. Não escreva textos longos. Resuma.
                2. Se ele estiver gastando muito, dê um puxão de orelha amigável.
                3. Se ele perguntar se pode comprar algo, calcule com base no salário e fixos dele.
                4. Fale gírias leves se couber.
                5. Ajude dando exemplos.
                6. Se o usuario quiser sair ou demontrar, mostre o comando "/sair" 
                CONTEXTO FINANCEIRO ATUAL: ${contexto}`
            }
        ];

        if (usuario.historico_consultor && usuario.historico_consultor.length > 0) {
            usuario.historico_consultor.forEach(msg => {
                messages.push(msg);
            });
        }

        messages.push({ role: "user", content: pergunta });

        const completion = await groq.chat.completions.create({
            messages: messages,
            model: "llama-3.1-8b-instant", 
        });

        const resposta = completion.choices[0]?.message?.content?.trim();
        return resposta;
    } catch (e) {
        return "Opa, deu um erro na minha mente aqui. Tenta de novo?";
    }
}

async function analisarAudioGroq(caminhoArquivo) {
    try {
        const transkription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(caminhoArquivo),
            model: "whisper-large-v3-turbo", 
            response_format: "json",
            language: "pt"
        });
        const texto = transkription.text;
        const comando = await interpretarComandoGroq(texto); 
        return { texto, comando };
    } catch (e) { return null }
}


async function analisarImagemGemini(buffer) {
    try {
        console.log("Lendo texto da imagem (OCR)...");
        
        const base64Image = `data:image/jpeg;base64,${buffer.toString('base64')}`;

        const form = new URLSearchParams();
        form.append('base64Image', base64Image);
        form.append('language', 'por'); 
        form.append('isOverlayRequired', 'false');

        
        const API_KEY_OCR = process.env.API_KEY_OCR || 'helloworld'; 

        const responseOCR = await axios.post('https://api.ocr.space/parse/image', form, {
            headers: { 'apikey': API_KEY_OCR }
        });

        if (responseOCR.data?.IsErroredOnProcessing) {
            console.error("Erro no OCR:", responseOCR.data.ErrorMessage);
            return null;
        }

        const textoExtraido = responseOCR.data?.ParsedResults?.[0]?.ParsedText;

        if (!textoExtraido) {
            console.log("OCR não encontrou texto na imagem.");
            return null;
        }

        console.log("📄 Texto Bruto:", textoExtraido.substring(0, 50).replace(/\n/g, ' ') + "..."); 

        
        console.log("analisando...");
        const completion = await groq.chat.completions.create({
            messages: [{
                role: "user",
                content: `
                    Analise o texto extraído de uma imagem/nota fiscal.
                    Encontre o item principal e o valor total.
                    TEXTO: "${textoExtraido}"
                    
                    REGRA: Responda APENAS no formato: Nome Valor
                    Exemplo: Pizza 50.00
                    Se tiver "R$", ignore o R$. Use ponto para centavos.
                    Se não tiver preço, não responda nada.
                `
            }],
            model: "llama-3.1-8b-instant",
            temperature: 0
        });

        const resultadoFinal = completion.choices[0]?.message?.content?.trim();
        console.log("✅ Resultado Final:", resultadoFinal);
        
        if(resultadoFinal && resultadoFinal.length > 2) {
            return resultadoFinal;
        } else {
            return null;
        }

    } catch (e) {
        console.error(" Erro Geral Imagem:", e.message);
        return null;
    }
}

function gerarRelatorioDetalhado(listaGastos, d1, d2) {
    const mesSistema = pegarMesAno(dataHoraAtual());
    const mesFormatado = mesSistema.split('/')[0]; 
    const anoFormatado = mesSistema.split('/')[1];
    
    const periodo = (d1 && d2) ? `(${d1}/${mesFormatado} → ${d2}/${mesFormatado})` : `(Mês ${mesSistema})`;

    let relMsg = `📊 *Relatório de Gastos*\n${periodo}\n`
    let totalGeral = 0;
    const categorias = {}

    listaGastos.forEach(g => {
        if (!categorias[g.categoria]) categorias[g.categoria] = { total: 0, itens: [] }
        categorias[g.categoria].total += g.valor
        categorias[g.categoria].itens.push(g)
        totalGeral += g.valor
    })

    for (const [cat, dados] of Object.entries(categorias)) {
        relMsg += `\n*${cat}* → R$${tirarAzul(dados.total.toFixed(2))}\n`
        dados.itens.forEach(item => {
            relMsg += `• ${item.desc}: R$${tirarAzul(item.valor.toFixed(2))}\n`
        })
    }

    relMsg += `\n═════════════════\n💰 *TOTAL GERAL: R$ ${tirarAzul(totalGeral.toFixed(2))}*`
    
    return relMsg;
}

async function tratarFinanceiro(sock, de, msg, txtOriginal) {
    const db = lerBanco()
    let txt = txtOriginal || ""

    if (!db[de]) {
        db[de] = {
            etapa: 0,
            modo_consultor: false,
            historico_consultor: [],
            perfil: { nome: '', salario: 0, fixos: 0, investe: 0 },
            gastos: [],
            ultimoMesRelatorio: pegarMesAno(dataHoraAtual())
        }
        salvarBanco(db)
    }

    const usuario = db[de]

    
    if (txtOriginal.trim().toLowerCase() === '/dev') {
        usuario.etapa = 5;
        usuario.perfil = {
            nome: 'Admin',
            salario: 10000, 
            fixos: 2000,
            investe: 1000
        };
        salvarBanco(db);
        return sock.sendMessage(de, { text: "*Modo Dev*" });
    }
   

    const mesAtual = pegarMesAno(dataHoraAtual())

    if (usuario.etapa === 5 && usuario.ultimoMesRelatorio !== mesAtual) {
        const mesAnterior = usuario.ultimoMesRelatorio
        const gastosAnt = usuario.gastos.filter(g => pegarMesAno(g.data) === mesAnterior)
        
        if (gastosAnt.length > 0) {
            const relatorioFechamento = gerarRelatorioDetalhado(gastosAnt, null, null);
            await sock.sendMessage(de, { text: `📅 *FECHAMENTO MENSAL AUTOMÁTICO*\n` + relatorioFechamento })
        }
        usuario.ultimoMesRelatorio = mesAtual
        salvarBanco(db)
    }

    if (usuario.etapa >= 5 && msg.message.audioMessage) {
        try {
            await sock.sendPresenceUpdate('recording', de)
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { 
                logger: P({ level: 'silent' }),
                reuploadRequest: sock.updateMediaMessage
            })
            const caminhoAudio = path.join(__dirname, `temp_${Date.now()}.ogg`)
            fs.writeFileSync(caminhoAudio, buffer)
            
            const resultadoAudio = await analisarAudioGroq(caminhoAudio)
            
            try { fs.unlinkSync(caminhoAudio) } catch(e){}

            if (resultadoAudio) {
                if (usuario.modo_consultor) {
                    txt = resultadoAudio.texto
                } 
                else {
                    txt = resultadoAudio.comando
                    if(txt && txt.startsWith('MSG:')) {
                        return sock.sendMessage(de, { text: txt.replace('MSG:', '').trim() })
                    }
                }
            }
        } catch (e) { }
    }
    
    if (usuario.etapa >= 5 && msg.message.imageMessage) {
        try {
            await sock.sendPresenceUpdate('composing', de)
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { 
                logger: P({ level: 'silent' }),
                reuploadRequest: sock.updateMediaMessage
            })
            
            const resultadoImagem = await analisarImagemGemini(buffer)
            
            if (resultadoImagem) {
                txt = resultadoImagem
                await sock.sendMessage(de, { text: `*Imagem:* ${txt}` })
            }
        } catch (e) { }
    }
    
    else if (usuario.etapa === 5 && !usuario.modo_consultor && txtOriginal.length > 0) {
        const t = txtOriginal.toLowerCase();
        if (!txtOriginal.startsWith('/') && (t.includes('ajuda') || t.includes('como') || t.includes('resum') || t.includes('relatori') || t.includes('apag') || t.includes('tir') || t.includes('lista') || t.includes('ver') || t.includes('gast') || t.includes('ate') || t.includes('ola') || t.includes('oi'))) {
             const cmdInteligente = await interpretarComandoGroq(txtOriginal);
             if (cmdInteligente) {
                 if (cmdInteligente.startsWith('MSG:')) {
                    return sock.sendMessage(de, { text: cmdInteligente.replace('MSG:', '').trim() })
                 }
                 if(cmdInteligente.startsWith('/') || cmdInteligente.startsWith('resumo')) {
                     txt = cmdInteligente.startsWith('/') ? cmdInteligente : `/${cmdInteligente}`;
                 }
             }
        }
    }

    const cmd = txt.trim().toLowerCase().replace(/\s+/g, ' '); 

    // --- CADASTRO ---
    if (usuario.etapa === 0) {
        usuario.etapa = 1; salvarBanco(db)
        await digitar(sock, de)
        return sock.sendMessage(de, { text: "Olá! Sou seu Assistente Financeiro📈\n\nPara começar, qual é o seu *nome*?" })
    }
    if (usuario.etapa === 1) {
        
        let nomeLimpo = txt.replace(/^(o )?(meu )?nome (é|eh) /i, '')
                           .replace(/^(eu )?sou (o |a )?/i, '')
                           .replace(/^(eu )?me chamo /i, '')
                           .replace(/prazer,?/i, '')
                           .trim();
        
        
        if(nomeLimpo.length > 0) {
            nomeLimpo = nomeLimpo.charAt(0).toUpperCase() + nomeLimpo.slice(1);
        } else {
            nomeLimpo = txt; 
        }

        usuario.perfil.nome = nomeLimpo; 
        usuario.etapa = 2; 
        salvarBanco(db)
        await digitar(sock, de)
        return sock.sendMessage(de, { text: `Prazer, ${nomeLimpo}!👊🏻\nQual é o seu *Salário Líquido Mensal*?` })
    }
    if (usuario.etapa === 2) {
        const valor = limparNumero(txt)
        if (valor <= 0) return sock.sendMessage(de, { text: "Valor inválido." })
        usuario.perfil.salario = valor; usuario.etapa = 3; salvarBanco(db)
        await digitar(sock, de)
        return sock.sendMessage(de, { text: "Quanto você gasta com *Contas Fixas*💸? (Digite 0 se nada)" })
    }
    if (usuario.etapa === 3) {
        usuario.perfil.fixos = limparNumero(txt); usuario.etapa = 4; salvarBanco(db)
        await digitar(sock, de)
        return sock.sendMessage(de, { text: "Quanto você *Investe*📈 por mês? (Digite 0 se nada)" })
    }
    if (usuario.etapa === 4) {
        usuario.perfil.investe = limparNumero(txt); usuario.etapa = 5; salvarBanco(db)
        const sobra = usuario.perfil.salario - usuario.perfil.fixos - usuario.perfil.investe
        let menu = `✅ *Tudo Pronto!* Saldo Livre: R$ ${tirarAzul(sobra.toFixed(2))}\n\n`
        menu += `📌 *COMANDOS:*\n📄 /lista\n📊 /resumo\n👤 /perfil\n🧠 /consultor\n🗑️ /del 1\n🔄 /reset`
        await digitar(sock, de)
        return sock.sendMessage(de, { text: menu })
    }

    if (usuario.etapa === 5) {
        
        if (usuario.modo_consultor) {
            if (cmd === '/sair' || cmd === 'sair') {
                usuario.modo_consultor = false;
                usuario.historico_consultor = []; 
                salvarBanco(db);
                return sock.sendMessage(de, { text: "Saiu do *modo Consultor.*" });
            }
            
            await digitar(sock, de);
            const respostaIA = await consultarConsultorFinanceiro(txt, usuario);
            
            usuario.historico_consultor.push({ role: "user", content: txt });
            usuario.historico_consultor.push({ role: "assistant", content: respostaIA });
            if (usuario.historico_consultor.length > 20) usuario.historico_consultor = usuario.historico_consultor.slice(-20);
            
            salvarBanco(db);
            return sock.sendMessage(de, { text: `*Consultor:* ${respostaIA}` });
        }

        if (txtOriginal.length > 0 && !msg.message.audioMessage && !msg.message.imageMessage) await digitar(sock, de);

        if (cmd === '/consultor') {
            usuario.modo_consultor = true;
            usuario.historico_consultor = []; 
            salvarBanco(db);
            return sock.sendMessage(de, { text: "*Consultor Ativo*\n\nPode me perguntar qualquer coisa sobre suas finanças.\n\n_Digite /sair para voltar._" });
        }

        if (cmd === '/menu' || cmd === '/ajuda') {
            return sock.sendMessage(de, { text: `📌 *MENU:*\nItem Valor (Gasto)\n/perfil (Ver tudo)\n/consultor (Conversar com IA)\n/lista\n/resumo (Categorias)\n/salario [valor]\n/del [n]\n/reset` })
        }

        if (cmd.startsWith('/salario')) {
            const valor = limparNumero(cmd.replace('/salario', ''));
            if (valor > 0) {
                usuario.perfil.salario = valor;
                salvarBanco(db);
                return sock.sendMessage(de, { text: `✅ Salário atualizado para: R$ ${tirarAzul(valor.toFixed(2))}` });
            } else {
                return sock.sendMessage(de, { text: " Use: /salario 3000" });
            }
        }

        if (cmd === '/perfil') {
            const mesAtual = pegarMesAno(dataHoraAtual());
            const gastosMes = usuario.gastos.filter(g => pegarMesAno(g.data) === mesAtual).reduce((acc, cur) => acc + cur.valor, 0);
            
            const pSalario = usuario.perfil.salario;
            const pFixos = usuario.perfil.fixos;
            const pInveste = usuario.perfil.investe;
            
            const meta20Porcento = pSalario * 0.20;
            const saldoLivreTeorico = pSalario - pFixos - pInveste;
            const saldoAtualReal = saldoLivreTeorico - gastosMes;

            let msgPerfil = `👤 *SEU PERFIL FINANCEIRO*\n\n`;
            msgPerfil += `💰 Salário: R$ ${tirarAzul(pSalario.toFixed(2))}\n`;
            msgPerfil += `🏠 Fixos: - R$ ${tirarAzul(pFixos.toFixed(2))}\n`;
            msgPerfil += `📈 Investe: - R$ ${tirarAzul(pInveste.toFixed(2))}\n`;
            msgPerfil += `🛒 Gastos Var. (${mesAtual}): - R$ ${tirarAzul(gastosMes.toFixed(2))}\n`;
            msgPerfil += `-----------------------------\n`;
            msgPerfil += `💵 *SALDO ATUAL: R$ ${tirarAzul(saldoAtualReal.toFixed(2))}*\n\n`;

            if (pInveste >= meta20Porcento) {
                msgPerfil += `🏆 Parabéns! Você já investe ${tirarAzul(((pInveste/pSalario)*100).toFixed(1))}% do seu salário.`;
            } else {
                msgPerfil += `⚠️ *Dica:* Tente guardar R$ ${tirarAzul((meta20Porcento - pInveste).toFixed(2))} a mais para atingir 20%.`;
            }
            return sock.sendMessage(de, { text: msgPerfil });
        }

        if (cmd === '/reset') {
            delete db[de]; salvarBanco(db)
            return sock.sendMessage(de, { text: "Dados apagados. Digite 'oi' para recomeçar." })
        }

        if (cmd.startsWith('/lista')) {
            const args = cmd.split(' ')
            const anoAtual = new Date().getFullYear()
            const mesAlvo = args[1] ? `${args[1]}/${anoAtual}` : pegarMesAno(dataHoraAtual())
            
            const gastosMes = usuario.gastos.filter(g => pegarMesAno(g.data) === mesAlvo)
            
            let total = 0
            let msgLista = `📝 *LISTA (${mesAlvo})*\n`
            
            if (gastosMes.length === 0) {
                msgLista += "\n_Nenhum gasto encontrado._\n"
            } else {
                let ultimaDataImpressa = ""
                gastosMes.forEach((g, i) => {
                    const partesData = g.data.split(' ') 
                    const dataApenas = partesData[0] 
                    const horaApenas = partesData[1] ? partesData[1].substring(0, 5) : "--:--"

                    if (dataApenas !== ultimaDataImpressa) {
                        msgLista += `\n*${tirarAzul(dataApenas)}*\n`
                        ultimaDataImpressa = dataApenas
                    }
                    msgLista += `${tirarAzul(i+1)}.    ${tirarAzul(horaApenas)} - ${g.desc}: R$ ${tirarAzul(g.valor.toFixed(2))}\n`
                    total += g.valor
                })
            }

            const orcamento = usuario.perfil.salario - usuario.perfil.fixos - usuario.perfil.investe
            const saldo = orcamento - total
            msgLista += `\n📉 Total Mês: R$ ${tirarAzul(total.toFixed(2))}`
            if (mesAlvo === pegarMesAno(dataHoraAtual())) {
                msgLista += `\n💰 Saldo Atual: R$ ${tirarAzul(saldo.toFixed(2))}`
            }
            return sock.sendMessage(de, { text: msgLista })
        }
        
        if (cmd === '/resumo') {
            const mesSistema = pegarMesAno(dataHoraAtual())
            const filtrados = usuario.gastos.filter(g => pegarMesAno(g.data) === mesSistema)
            
            const relatorio = gerarRelatorioDetalhado(filtrados, null, null);
            return sock.sendMessage(de, { text: relatorio })
        }

        const matchResumo = cmd.match(/(?:resumo|relatorio).*?(\d+).*?(\d+)/)
        if (matchResumo) {
            const d1 = parseInt(matchResumo[1])
            const d2 = parseInt(matchResumo[2])
            const mesSistema = pegarMesAno(dataHoraAtual())
            
            const filtrados = usuario.gastos.filter(g => {
                const dia = pegarDia(g.data)
                return pegarMesAno(g.data) === mesSistema && dia >= d1 && dia <= d2
            })
            
            const relatorio = gerarRelatorioDetalhado(filtrados, d1, d2);
            return sock.sendMessage(de, { text: relatorio })
        }

        
        
        if (cmd.startsWith('/del')) {
            const parametro = cmd.replace('/del', '').trim();
            const args = parametro.split(/\s+/); 

            
            if (args[0].toLowerCase() === 'dia') {
                const diaAlvo = parseInt(args[1]);
                if (!isNaN(diaAlvo)) {
                    const mesAtual = pegarMesAno(dataHoraAtual());
                    const totalAntes = usuario.gastos.length;
                    usuario.gastos = usuario.gastos.filter(g => {
                        const diaGasto = parseInt(g.data.split('/')[0]);
                        const mesGasto = pegarMesAno(g.data);
                        return !(diaGasto === diaAlvo && mesGasto === mesAtual);
                    });
                    const apagados = totalAntes - usuario.gastos.length;
                    salvarBanco(db);
                    return sock.sendMessage(de, { text: `🗑️ Apaguei *${apagados}* gastos do dia ${diaAlvo}.` });
                }
            }

            
            const idsParaApagar = args.map(n => parseInt(n)).filter(n => !isNaN(n));
            
            if (idsParaApagar.length > 0) {
                const totalAntes = usuario.gastos.length;
                usuario.gastos = usuario.gastos.filter((_, index) => !idsParaApagar.includes(index + 1));
                const apagados = totalAntes - usuario.gastos.length;
                salvarBanco(db);
                if (apagados > 0) return sock.sendMessage(de, { text: `🗑️ *${apagados}* itens apagados pelo ID!` });
            }

            
            const nomesParaApagar = args.filter(a => a.toLowerCase() !== 'dia' && isNaN(parseInt(a)));

            if (nomesParaApagar.length > 0) {
                const totalAntes = usuario.gastos.length;
                
                
                usuario.gastos = usuario.gastos.filter(g => {
                    const descricaoItem = g.desc.toLowerCase();
                    
                    const temPalavraProibida = nomesParaApagar.some(nome => descricaoItem.includes(nome.toLowerCase()));
                    return !temPalavraProibida; 
                });

                const apagados = totalAntes - usuario.gastos.length;
                salvarBanco(db);

                if (apagados > 0) {
                    return sock.sendMessage(de, { text: `🗑️ Apaguei *${apagados}* itens contendo: ${nomesParaApagar.join(', ')}.` });
                }
            }
            
            
            if (idsParaApagar.length === 0 && nomesParaApagar.length === 0) {
                 return sock.sendMessage(de, { text: "⚠️ Use: /del [id], /del [nome] ou /del dia [n]" });
            }
        }

        if (!cmd.startsWith('/')) {
            const partes = txt.split(/\s+/)
            const valorTexto = partes.pop()
            const valor = limparNumero(valorTexto)
            const desc = partes.join(' ')

            if (desc && valor > 0) {
                const cat = await categorizarTexto(desc) 
                const dataRegistro = dataHoraAtual() 
                
                usuario.gastos.push({ desc, valor, categoria: cat, data: dataRegistro })
                salvarBanco(db)
                
                return sock.sendMessage(de, { 
                    text: `✅ Gasto Registrado!\n📝 ${desc} (${cat})\n💸 R$${tirarAzul(valor.toFixed(2))}\n📅 ${dataRegistro.split(' ')[0]}` 
                })
            } else {
                 if (txt.length < 50) return sock.sendMessage(de, { text: " Não entendi.\n\nSe foi um gasto, digite: *Nome Valor* (ex: Coxinha 5).\nOu digite */menu* para ajuda." })
            }
        }
    }
}

async function start() {
    const { state, saveCreds } = await useMultiFileAuthState(authFolder)
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, 
        browser: ["FinanceiroBot", "Chrome", "1.0.0"], 
        version,
        logger: P({ level: "silent" }),
        defaultQueryTimeoutMs: 60000, 
        connectTimeoutMs: 60000
    })

    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update
        
        if (qr) {
            console.log("qrcode\n")
            qrcodeTerminal.generate(qr, { small: true });
        }
        
        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode
            if (reason !== DisconnectReason.loggedOut) {
                console.log("Reconectando..."); 
                start()
            } else {
                console.log("Sessão expirada. Apague a pasta 'auth_local'.")
            }
        } else if (connection === "open") {
            console.log("BCONECTADO\n"); 
        }
    })

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0]; 
        if (!msg.message || msg.key.fromMe) return
        if (msg.key.remoteJid?.endsWith("@newsletter")) return
        if (msg.key.remoteJid === "status@broadcast") return
        
        const de = msg.key.remoteJid
        const txt = pegarTextoMensagem(msg)
        
        try {
            await tratarFinanceiro(sock, de, msg, txt)
        } catch (erroBot) {
            console.error("Erro ao processar mensagem:", erroBot.message)
        }
    })
}

console.log("iniciando bot...")
start()