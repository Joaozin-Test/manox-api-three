export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const method = request.method;

        // Configuração de Headers padrão para JSON e CORS
        const jsonResponse = (data, status = 200) => {
            return new Response(JSON.stringify(data), {
                status,
                headers: { 
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*" // Facilita conexões externas (como o Roblox)
                }
            });
        };

        // Helper para ler o corpo da requisição com segurança
        const getBody = async () => {
            try {
                return await request.json();
            } catch {
                return {};
            }
        };

        // Middleware de Autenticação (Chave Admin)
        const checkAdminKey = async () => {
           const adminKey = await env.MANOX_KV.get("ADMIN_API_KEY");
           const clientKey = request.headers.get("x-manox-key");
           return adminKey && clientKey === adminKey;
        };

        // --- ROTAS DA API ---

        // GET /
        if (method === "GET" && url.pathname === "/") {
            return new Response("Manox API online", { headers: { "Content-Type": "text/plain" } });
        }

        // POST /api/manox/register
        if (method === "POST" && url.pathname === "/api/manox/register") {
            const { username, userId } = await getBody();

            if (typeof username !== "string" || username.length < 1) {
                return jsonResponse({ success: false, message: "username inválido" }, 400);
            }

            const key = `user:${username.toLowerCase()}`;
            const userData = {
                username: username,
                userId: userId || null,
                lastSeen: Date.now()
            };

            // Salva no KV com expiração automática de 10 minutos para economizar limpeza manual!
            await env.MANOX_KV.put(key, JSON.stringify(userData), { expirationTtl: 600 });

            return jsonResponse({ success: true });
        }

        // GET /api/manox/users
        if (method === "GET" && url.pathname === "/api/manox/users") {
            const activeUsers = [];
            const list = await env.MANOX_KV.list({ prefix: "user:" });

            for (const key of list.keys) {
                const val = await env.MANOX_KV.get(key.name, "json");
                if (val && (Date.now() - val.lastSeen <= 10 * 60 * 1000)) {
                    activeUsers.push(val.username);
                }
            }

            return jsonResponse({ success: true, users: activeUsers });
        }

        // POST /api/manox/heartbeat
        if (method === "POST" && url.pathname === "/api/manox/heartbeat") {
            const { username } = await getBody();

            if (typeof username !== "string") {
                return jsonResponse({ success: false }, 400);
            }

            const key = `user:${username.toLowerCase()}`;
            const oldData = await env.MANOX_KV.get(key, "json");

            if (oldData) {
                oldData.lastSeen = Date.now();
                await env.MANOX_KV.put(key, JSON.stringify(oldData), { expirationTtl: 600 });
            }

            return jsonResponse({ success: true });
        }

        // POST /api/manox/send-jobid
        if (method === "POST" && url.pathname === "/api/manox/send-jobid") {
            const { username, placeId, jobId } = await getBody();

            if (!username || !placeId || !jobId) {
                return jsonResponse({ error: "Dados incompletos." }, 400);
            }

            const session = { username, placeId, jobId, timestamp: Date.now() };
            await env.MANOX_KV.put("player_session", JSON.stringify(session));

            return jsonResponse({ success: true, message: "Sessão salva com sucesso!" });
        }

        // GET /api/manox/get-jobid
        if (method === "GET" && url.pathname === "/api/manox/get-jobid") {
            const session = await env.MANOX_KV.get("player_session", "json") || {
                username: "Nenhum",
                placeId: null,
                jobId: null,
                timestamp: null
            };
            return jsonResponse(session);
        }

        // GET /api/manox/temp-admins
        if (method === "GET" && url.pathname === "/api/manox/temp-admins") {
            const now = Date.now();
            const admins = [];
            const list = await env.MANOX_KV.list({ prefix: "admin:" });

            for (const key of list.keys) {
                const val = await env.MANOX_KV.get(key.name, "json");
                if (val && now < val.expiresAt) {
                    admins.push({ username: val.username, expiresAt: val.expiresAt });
                }
            }

            return jsonResponse({ success: true, admins });
        }

        // POST /api/manox/temp-admins/add
        if (method === "POST" && url.pathname === "/api/manox/temp-admins/add") {
            if (!checkAdminKey()) return jsonResponse({ success: false, message: "Não autorizado" }, 401);
            
            const { username } = await getBody();
            if (typeof username !== "string" || username.trim() === "") {
                return jsonResponse({ success: false, message: "username inválido" }, 400);
            }

            const ONE_HOUR = 60 * 60 * 1000;
            const expiresAt = Date.now() + ONE_HOUR;
            const key = `admin:${username.toLowerCase()}`;

            await env.MANOX_KV.put(key, JSON.stringify({ username, expiresAt }), { expirationTtl: 3600 });

            return jsonResponse({
                success: true,
                username,
                expiresAt,
                message: "Admin temporário adicionado por 1 hora."
            });
        }

        // POST /api/manox/temp-admins/remove
        if (method === "POST" && url.pathname === "/api/manox/temp-admins/remove") {
            if (!checkAdminKey()) return jsonResponse({ success: false, message: "Não autorizado" }, 401);

            const { username } = await getBody();
            if (typeof username !== "string") return jsonResponse({ success: false }, 400);

            await env.MANOX_KV.delete(`admin:${username.toLowerCase()}`);
            return jsonResponse({ success: true });
        }

        // POST /api/manox/chat
        if (method === "POST" && url.pathname === "/api/manox/chat") {
            const { username, userId, message } = await getBody();

            if (!username || !message || username.trim() === "" || message.trim() === "") {
                return jsonResponse({ success: false, message: "Dados inválidos." }, 400);
            }

            const cleanMessage = message.trim().slice(0, 200);
            const userKey = `ratelimit:${String(userId || username).toLowerCase()}`;
            const now = Date.now();

            // Limitação de Taxa (Rate Limit) usando KV (2 segundos)
            const lastTime = await env.MANOX_KV.get(userKey);
            if (lastTime && (now - parseInt(lastTime) < 2000)) {
                return jsonResponse({ success: false, message: "Espere um pouco antes de enviar outra mensagem." }, 429);
            }
            await env.MANOX_KV.put(userKey, String(now), { expirationTtl: 60 });

            const chatMessage = {
                id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
                username: username.trim(),
                userId: userId || null,
                message: cleanMessage,
                createdAt: now
            };

            // Salva mensagens no array global armazenado no KV
            let globalMessages = await env.MANOX_KV.get("global_messages", "json") || [];
            globalMessages.push(chatMessage);
            
            // Mantém as últimas 100 mensagens para não estourar o tamanho do KV
            if (globalMessages.length > 100) globalMessages.shift(); 
            await env.MANOX_KV.put("global_messages", JSON.stringify(globalMessages));

            return jsonResponse({ success: true, message: chatMessage });
        }

        // GET /api/manox/get-chat
        if (method === "GET" && url.pathname === "/api/manox/get-chat") {
            const messages = await env.MANOX_KV.get("global_messages", "json") || [];
            return jsonResponse({ success: true, messages });
        }

        // POST /api/manox/system-message
        if (method === "POST" && url.pathname === "/api/manox/system-message") {
            if (!checkAdminKey()) return jsonResponse({ success: false, message: "Não autorizado" }, 401);

            const { message } = await getBody();
            if (typeof message !== "string" || message.trim() === "") {
                return jsonResponse({ success: false, message: "Mensagem inválida." }, 400);
            }

            const systemMessage = {
                id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                message: message.trim().slice(0, 250),
                createdAt: Date.now()
            };

            let sysMessages = await env.MANOX_KV.get("system_messages", "json") || [];
            sysMessages.push(systemMessage);
            if (sysMessages.length > 50) sysMessages.shift();
            await env.MANOX_KV.put("system_messages", JSON.stringify(sysMessages));

            return jsonResponse({ success: true, message: systemMessage });
        }

        // GET /api/manox/system-messages
        if (method === "GET" && url.pathname === "/api/manox/system-messages") {
            const messages = await env.MANOX_KV.get("system_messages", "json") || [];
            return jsonResponse({ success: true, messages });
        }

        // POST /api/manox/chat/clear
        if (method === "POST" && url.pathname === "/api/manox/chat/clear") {
            if (!checkAdminKey()) return jsonResponse({ success: false, message: "Não autorizado" }, 401);

            await env.MANOX_KV.put("global_messages", JSON.stringify([]));
            return jsonResponse({ success: true, message: "Chat global limpo." });
        }

        // --- CHAT POR SERVIDOR (SERVER CHAT) ---

        // POST /api/manox/server-chat/presence
        if (method === "POST" && url.pathname === "/api/manox/server-chat/presence") {
            const { serverId, username, userId } = await getBody();

            if (!serverId || !username || serverId.trim() === "" || username.trim() === "") {
                return jsonResponse({ success: false, message: "Dados inválidos." }, 400);
            }

            const cleanServerId = serverId.trim();
            const userKey = String(userId || username).toLowerCase();
            
            // Atualiza presença usando chaves dedicadas com expiração de 30 segundos!
            // Isso substitui o setInterval() original de limpeza, a Cloudflare apaga sozinha.
            await env.MANOX_KV.put(`presence:${cleanServerId}:${userKey}`, String(Date.now()), { expirationTtl: 60 });

            // Conta quantos estão online no momento
            const list = await env.MANOX_KV.list({ prefix: `presence:${cleanServerId}:` });

            return jsonResponse({ success: true, online: list.keys.length });
        }

        // POST /api/manox/server-chat/send
        if (method === "POST" && url.pathname === "/api/manox/server-chat/send") {
            const { serverId, username, userId, message } = await getBody();

            if (!serverId || !username || !message || serverId.trim() === "" || username.trim() === "" || message.trim() === "") {
                return jsonResponse({ success: false, message: "Dados inválidos." }, 400);
            }

            const cleanServerId = serverId.trim();
            const cleanMessage = message.trim().slice(0, 200);
            const userKey = String(userId || username).toLowerCase();

            // Atualiza presença de quem enviou
            await env.MANOX_KV.put(`presence:${cleanServerId}:${userKey}`, String(Date.now()), { expirationTtl: 60 });

            const chatMessage = {
                id: `server-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                username: username.trim(),
                userId: userId || null,
                message: cleanMessage,
                createdAt: Date.now()
            };

            let serverChat = await env.MANOX_KV.get(`chat:${cleanServerId}`, "json") || [];
            serverChat.push(chatMessage);
            if (serverChat.length > 100) serverChat.shift();
            
            // O chat do servidor auto-expira em 30 minutos se ninguém usar
            await env.MANOX_KV.put(`chat:${cleanServerId}`, JSON.stringify(serverChat), { expirationTtl: 1800 });

            return jsonResponse({ success: true, message: chatMessage });
        }

        // GET /api/manox/server-chat/messages
        if (method === "GET" && url.pathname === "/api/manox/server-chat/messages") {
            const serverId = url.searchParams.get("serverId");

            if (!serverId || serverId.trim() === "") {
                return jsonResponse({ success: false, message: "serverId inválido." }, 400);
            }

            const messages = await env.MANOX_KV.get(`chat:${serverId.trim()}`, "json") || [];
            return jsonResponse({ success: true, messages });
        }

        // POST /api/manox/server-chat/clear
        if (method === "POST" && url.pathname === "/api/manox/server-chat/clear") {
            if (!checkAdminKey()) return jsonResponse({ success: false, message: "Não autorizado" }, 401);

            const { serverId } = await getBody();
            if (!serverId || serverId.trim() === "") return jsonResponse({ success: false, message: "serverId inválido." }, 400);

            await env.MANOX_KV.delete(`chat:${serverId.trim()}`);
            return jsonResponse({ success: true, message: "Chat do servidor limpo." });
        }

        // Rota não encontrada
        return jsonResponse({ success: false, message: "Rota não encontrada" }, 404);
    }
};
