// Node.js 22+. Run with LANTALK_URL and LANTALK_BOT_TOKEN environment variables.
// Poll offset is saved locally; the server also remembers acknowledged progress.
import { readFile, writeFile } from 'node:fs/promises';
const base = (process.env.LANTALK_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const token = process.env.LANTALK_BOT_TOKEN;
if (!token) throw new Error('Set LANTALK_BOT_TOKEN to the token displayed when creating the Bot.');
const cursorFile = process.env.LANTALK_BOT_CURSOR || '.lantalk-bot-cursor.json';
let offset;
try { offset = JSON.parse(await readFile(cursorFile, 'utf8')).offset; } catch (error) { if (error.code !== 'ENOENT') throw error; }
async function api(route, body) {
    const response = await fetch(base + '/api/bot/v1' + route, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error); error.status = response.status; error.nextOffset = data.nextOffset; throw error; }
    return data;
}
console.log('Running as', (await api('/me')).username);
while (true) {
    try {
        const query = new URLSearchParams({ timeout: '30', ...(offset === undefined ? {} : { offset: String(offset) }) });
        const batch = await api('/updates?' + query);
        for (const update of batch.updates) {
            const message = update.data;
            // Reply only to an explicit /ping command, to avoid bot-to-bot loops.
            if (update.type === 'message' && message.senderKind !== 'bot' && message.content?.trim() === '/ping') {
                await api('/rooms/' + encodeURIComponent(message.room) + '/messages', { content: 'pong', replyToId: message.id });
            }
            // Only acknowledge messages that finished processing.
            offset = update.updateId; await writeFile(cursorFile, JSON.stringify({ offset }));
        }
        offset = batch.nextOffset; await writeFile(cursorFile, JSON.stringify({ offset }));
    } catch (error) {
        if ([401, 409].includes(error.status)) throw error;
        if (error.status === 410) { offset = error.nextOffset; await writeFile(cursorFile, JSON.stringify({ offset })); }
        console.error(error.message); await new Promise(resolve => setTimeout(resolve, 2000));
    }
}
