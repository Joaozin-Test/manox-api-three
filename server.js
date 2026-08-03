export default {
    async fetch(request, env) {
        const SUPABASE_URL = env.SUPABASE_URL;
        const SUPABASE_KEY = env.SUPABASE_KEY;

        const headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json"
        };

        const url = new URL(request.url);
        const method = request.method;

        const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
            status,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });

        const getBody = async () => { try { return await request.json(); } catch { return {}; } };

        const checkAdminKey = () => {
            const clientKey = request.headers.get("x-manox-key");
            return clientKey && clientKey === env.ADMIN_API_KEY;
        };

        const now = Date.now();

        // --- JOB ID ---
        if (method === "POST" && url.pathname === "/api/manox/send-jobid") {
            const { username, placeId, jobId } = await getBody();
            if (!username || !placeId || !jobId) return jsonResponse({ error: "Dados incompletos." }, 400);

            await fetch(`${SUPABASE_URL}/rest/v1/player_sessions`, {
                method: "POST",
                headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
                body: JSON.stringify({ id: "current", username, place_id: String(placeId), job_id: String(jobId), timestamp: now })
            });

            return jsonResponse({ success: true, message: "Sessão salva no Supabase com sucesso!" });
        }

        if (method === "GET" && url.pathname === "/api/manox/get-jobid") {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/player_sessions?id=eq.current`, { headers });
            const data = await res.json();
            
            if (data && data.length > 0) {
                return jsonResponse({
                    username: data[0].username,
                    placeId: data[0].place_id,
                    jobId: data[0].job_id,
                    timestamp: data[0].timestamp
                });
            }

            return jsonResponse({ username: "Nenhum", placeId: null, jobId: null, timestamp: null });
        }

        // --- ADMINS TEMPORÁRIOS ---
        if (method === "GET" && url.pathname === "/api/manox/temp-admins") {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/temp_admins?expires_at=gt.${now}`, { headers });
            const admins = await res.json();
            return jsonResponse({ success: true, admins: Array.isArray(admins) ? admins : [] });
        }

        if (method === "POST" && url.pathname === "/api/manox/temp-admins/add") {
            if (!checkAdminKey()) return jsonResponse({ success: false, message: "Não autorizado" }, 401);
            const { username } = await getBody();
            if (!username) return jsonResponse({ success: false }, 400);

            const expiresAt = now + (60 * 60 * 1000);
            await fetch(`${SUPABASE_URL}/rest/v1/temp_admins`, {
                method: "POST",
                headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
                body: JSON.stringify({ username: username.trim(), expires_at: expiresAt })
            });

            return jsonResponse({ success: true, username, expiresAt });
        }

        if (method === "POST" && url.pathname === "/api/manox/temp-admins/remove") {
            if (!checkAdminKey()) return jsonResponse({ success: false, message: "Não autorizado" }, 401);
            const { username } = await getBody();
            if (!username) return jsonResponse({ success: false }, 400);

            await fetch(`${SUPABASE_URL}/rest/v1/temp_admins?username=eq.${encodeURIComponent(username.trim())}`, {
                method: "DELETE",
                headers
            });

            return jsonResponse({ success: true });
        }

        // --- MENSAGENS DE SISTEMA & LIMPEZA DE CHAT ---
        if (method === "POST" && url.pathname === "/api/manox/system-message") {
            if (!checkAdminKey()) return jsonResponse({ success: false, message: "Não autorizado" }, 401);
            const { message } = await getBody();
            if (!message) return jsonResponse({ success: false }, 400);

            const sysMsg = { id: `system-${now}`, message: message.trim().slice(0, 250), created_at: now };
            await fetch(`${SUPABASE_URL}/rest/v1/system_messages`, { method: "POST", headers, body: JSON.stringify(sysMsg) });

            return jsonResponse({ success: true, message: sysMsg });
        }

        if (method === "GET" && url.pathname === "/api/manox/system-messages") {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/system_messages?select=*&order=created_at.desc&limit=50`, { headers });
            const messages = await res.json();
            return jsonResponse({ success: true, messages: Array.isArray(messages) ? messages.reverse() : [] });
        }

        if (method === "POST" && url.pathname === "/api/manox/chat/clear") {
            if (!checkAdminKey()) return jsonResponse({ success: false, message: "Não autorizado" }, 401);
            await fetch(`${SUPABASE_URL}/rest/v1/global_messages?id=neq.0`, { method: "DELETE", headers });
            return jsonResponse({ success: true, message: "Chat global limpo." });
        }

        if (method === "POST" && url.pathname === "/api/manox/server-chat/clear") {
            if (!checkAdminKey()) return jsonResponse({ success: false, message: "Não autorizado" }, 401);
            const { serverId } = await getBody();
            if (!serverId) return jsonResponse({ success: false }, 400);

            await fetch(`${SUPABASE_URL}/rest/v1/server_messages?server_id=eq.${encodeURIComponent(serverId.trim())}`, { method: "DELETE", headers });
            return jsonResponse({ success: true, message: "Chat do servidor limpo." });
        }

        return jsonResponse({ success: false, message: "Rota não encontrada" }, 404);
    }
};
